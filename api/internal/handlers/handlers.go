package handlers

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"energychain/dex/api/internal/cosmos"
	"energychain/dex/api/internal/metrics"
	"energychain/dex/api/internal/routing"
)

type API struct {
	Pool    *pgxpool.Pool
	Redis   *redis.Client
	Router  *routing.Router
	ChainID int
	WECY    string

	// Native Cosmos layer (nil when DEX_COSMOS_ENABLED=false).
	Cosmos         *cosmos.Client
	CosmosChainID  string
	Bech32Prefix   string
	NativeDenom    string
	NativeDecimals int
}

// ---------- common helpers ----------

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func parseAddr(s string) ([]byte, error) {
	s = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(s)), "0x")
	if len(s) != 40 {
		return nil, errors.New("invalid address")
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, err
	}
	return b, nil
}

func hexAddr(b []byte) string { return "0x" + hex.EncodeToString(b) }

func intParam(r *http.Request, k string, def, max int) int {
	v := r.URL.Query().Get(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// cached looks up a Redis cache by key, populating it via `loader` on miss.
// The TTL is short (5–30s) to keep dashboards lively while still saving
// repeated heavy queries when many clients view the same page.
func (a *API) cached(r *http.Request, key string, ttl time.Duration, loader func() (any, error)) (any, error) {
	ctx := r.Context()
	if a.Redis != nil {
		if v, err := a.Redis.Get(ctx, key).Bytes(); err == nil {
			metrics.CacheHits.WithLabelValues("redis", "hit").Inc()
			var out json.RawMessage = v
			return out, nil
		}
	}
	metrics.CacheHits.WithLabelValues("redis", "miss").Inc()
	v, err := loader()
	if err != nil {
		return nil, err
	}
	if a.Redis != nil {
		buf, err := json.Marshal(v)
		if err == nil {
			_ = a.Redis.Set(ctx, key, buf, ttl).Err()
		}
	}
	return v, nil
}

// ---------- /api/v1/overview ----------

type overviewResponse struct {
	ChainID    int     `json:"chain_id"`
	Pairs      int     `json:"pairs"`
	Tokens     int     `json:"tokens"`
	Volume24h  string  `json:"volume_usd_24h"`
	TVL        string  `json:"tvl_usd"`
	Trades24h  int     `json:"trades_24h"`
	Updated    int64   `json:"updated_at"`
}

func (a *API) Overview(w http.ResponseWriter, r *http.Request) {
	out, err := a.cached(r, fmt.Sprintf("ov:%d", a.ChainID), 15*time.Second, func() (any, error) {
		ctx := r.Context()
		var resp overviewResponse
		resp.ChainID = a.ChainID
		_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM pairs WHERE chain_id=$1`, a.ChainID).Scan(&resp.Pairs)
		_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM tokens WHERE chain_id=$1`, a.ChainID).Scan(&resp.Tokens)
		_ = a.Pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_usd),0)::text, COUNT(*)
			  FROM swaps WHERE chain_id=$1 AND block_time > NOW() - INTERVAL '24 hours'`,
			a.ChainID).Scan(&resp.Volume24h, &resp.Trades24h)
		_ = a.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(tvl_usd),0)::text FROM pairs WHERE chain_id=$1`, a.ChainID).Scan(&resp.TVL)
		resp.Updated = time.Now().Unix()
		return resp, nil
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, out)
}

// ---------- /api/v1/pairs ----------

type pairRow struct {
	Address       string `json:"address"`
	Token0        string `json:"token0"`
	Token1        string `json:"token1"`
	Symbol0       string `json:"symbol0"`
	Symbol1       string `json:"symbol1"`
	Reserve0      string `json:"reserve0"`
	Reserve1      string `json:"reserve1"`
	Volume24h     string `json:"volume_usd_24h"`
	Fees24h       string `json:"fees_usd_24h"`
	TVL           string `json:"tvl_usd"`
	APR           string `json:"apr_24h"`
	Price0USD     string `json:"price0_usd"`
	Price1USD     string `json:"price1_usd"`
	CreatedHeight int64  `json:"created_height"`
	CreatedAt     int64  `json:"created_at"`
}

func (a *API) ListPairs(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50, 200)
	offset := intParam(r, "offset", 0, 100000)
	sort := r.URL.Query().Get("sort")
	orderBy := "p.tvl_usd DESC"
	switch sort {
	case "volume":
		orderBy = "p.volume_usd_24h DESC"
	case "new":
		orderBy = "p.created_height DESC"
	case "apr":
		orderBy = "p.apr_24h DESC"
	}

	ctx := r.Context()
	rows, err := a.Pool.Query(ctx, fmt.Sprintf(`
		SELECT p.address, p.token0, p.token1,
		       COALESCE(t0.symbol,''), COALESCE(t1.symbol,''),
		       p.reserve0, p.reserve1,
		       p.volume_usd_24h, p.fees_usd_24h, p.tvl_usd, p.apr_24h,
		       p.price0_usd, p.price1_usd,
		       p.created_height, EXTRACT(EPOCH FROM p.created_at)
		  FROM pairs p
		  LEFT JOIN tokens t0 ON t0.chain_id=p.chain_id AND t0.address=p.token0
		  LEFT JOIN tokens t1 ON t1.chain_id=p.chain_id AND t1.address=p.token1
		 WHERE p.chain_id=$1
		 ORDER BY %s
		 LIMIT $2 OFFSET $3`, orderBy),
		a.ChainID, limit, offset)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var out []pairRow
	for rows.Next() {
		var p pairRow
		var addr, t0, t1 []byte
		var ts float64
		if err := rows.Scan(&addr, &t0, &t1, &p.Symbol0, &p.Symbol1,
			&p.Reserve0, &p.Reserve1, &p.Volume24h, &p.Fees24h, &p.TVL, &p.APR,
			&p.Price0USD, &p.Price1USD, &p.CreatedHeight, &ts); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		p.Address = hexAddr(addr)
		p.Token0 = hexAddr(t0)
		p.Token1 = hexAddr(t1)
		p.CreatedAt = int64(ts)
		out = append(out, p)
	}
	writeJSON(w, 200, map[string]any{"items": out, "limit": limit, "offset": offset})
}

func (a *API) GetPair(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddr(chi.URLParam(r, "address"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var p pairRow
	var addrB, t0, t1 []byte
	var ts float64
	err = a.Pool.QueryRow(r.Context(), `
		SELECT p.address, p.token0, p.token1,
		       COALESCE(t0.symbol,''), COALESCE(t1.symbol,''),
		       p.reserve0, p.reserve1,
		       p.volume_usd_24h, p.fees_usd_24h, p.tvl_usd, p.apr_24h,
		       p.price0_usd, p.price1_usd,
		       p.created_height, EXTRACT(EPOCH FROM p.created_at)
		  FROM pairs p
		  LEFT JOIN tokens t0 ON t0.chain_id=p.chain_id AND t0.address=p.token0
		  LEFT JOIN tokens t1 ON t1.chain_id=p.chain_id AND t1.address=p.token1
		 WHERE p.chain_id=$1 AND p.address=$2`, a.ChainID, addr).
		Scan(&addrB, &t0, &t1, &p.Symbol0, &p.Symbol1, &p.Reserve0, &p.Reserve1,
			&p.Volume24h, &p.Fees24h, &p.TVL, &p.APR, &p.Price0USD, &p.Price1USD,
			&p.CreatedHeight, &ts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, 404, "pair not found")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	p.Address = hexAddr(addrB)
	p.Token0 = hexAddr(t0)
	p.Token1 = hexAddr(t1)
	p.CreatedAt = int64(ts)
	writeJSON(w, 200, p)
}

// ---------- /api/v1/pairs/{address}/candles ----------

type candle struct {
	T    int64  `json:"t"`
	O    string `json:"o"`
	H    string `json:"h"`
	L    string `json:"l"`
	C    string `json:"c"`
	V    string `json:"v"`     // volume in token0 (raw integer)
	VUSD string `json:"v_usd"`
	N    int    `json:"n"`
}

func (a *API) Candles(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddr(chi.URLParam(r, "address"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	g := r.URL.Query().Get("granularity")
	if g == "" {
		g = "5m"
	}
	switch g {
	case "1m", "5m", "15m", "1h", "4h", "1d", "1w":
	default:
		writeErr(w, 400, "granularity must be 1m|5m|15m|1h|4h|1d|1w")
		return
	}
	limit := intParam(r, "limit", 500, 2000)

	ctx := r.Context()
	rows, err := a.Pool.Query(ctx, `
		SELECT EXTRACT(EPOCH FROM bucket)::bigint, open, high, low, close, volume0, volume_usd, trades
		  FROM ohlcv WHERE chain_id=$1 AND pair=$2 AND granularity=$3
		 ORDER BY bucket DESC LIMIT $4`,
		a.ChainID, addr, g, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []candle
	for rows.Next() {
		var c candle
		if err := rows.Scan(&c.T, &c.O, &c.H, &c.L, &c.C, &c.V, &c.VUSD, &c.N); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, c)
	}
	// Reverse to chronological order (oldest first) for charts.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	writeJSON(w, 200, map[string]any{"items": out, "granularity": g})
}

// ---------- /api/v1/pairs/{address}/swaps ----------

type swapRow struct {
	BlockTime  int64  `json:"block_time"`
	Height     int64  `json:"height"`
	Tx         string `json:"tx"`
	Sender     string `json:"sender"`
	Recipient  string `json:"recipient"`
	Amount0In  string `json:"amount0_in"`
	Amount1In  string `json:"amount1_in"`
	Amount0Out string `json:"amount0_out"`
	Amount1Out string `json:"amount1_out"`
	Side       int    `json:"side"`
	Price      string `json:"price"`
	AmountUSD  string `json:"amount_usd"`
}

func (a *API) PairSwaps(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddr(chi.URLParam(r, "address"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	limit := intParam(r, "limit", 50, 500)
	rows, err := a.Pool.Query(r.Context(), `
		SELECT EXTRACT(EPOCH FROM block_time)::bigint, height, tx_hash, sender, recipient,
		       amount0_in, amount1_in, amount0_out, amount1_out, side, price, amount_usd
		  FROM swaps WHERE chain_id=$1 AND pair=$2
		 ORDER BY block_time DESC, log_index DESC
		 LIMIT $3`, a.ChainID, addr, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []swapRow
	for rows.Next() {
		var s swapRow
		var tx, sender, recip []byte
		if err := rows.Scan(&s.BlockTime, &s.Height, &tx, &sender, &recip,
			&s.Amount0In, &s.Amount1In, &s.Amount0Out, &s.Amount1Out,
			&s.Side, &s.Price, &s.AmountUSD); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		s.Tx = hexAddr(tx)
		s.Sender = hexAddr(sender)
		s.Recipient = hexAddr(recip)
		out = append(out, s)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

// ---------- /api/v1/swaps (firehose, last N across all pairs) ----------

func (a *API) RecentSwaps(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50, 200)
	rows, err := a.Pool.Query(r.Context(), `
		SELECT EXTRACT(EPOCH FROM s.block_time)::bigint, s.height, s.tx_hash, s.pair,
		       COALESCE(t0.symbol,''), COALESCE(t1.symbol,''),
		       s.amount0_in, s.amount1_in, s.amount0_out, s.amount1_out, s.side, s.price, s.amount_usd
		  FROM swaps s
		  JOIN pairs p ON p.chain_id=s.chain_id AND p.address=s.pair
		  LEFT JOIN tokens t0 ON t0.chain_id=p.chain_id AND t0.address=p.token0
		  LEFT JOIN tokens t1 ON t1.chain_id=p.chain_id AND t1.address=p.token1
		 WHERE s.chain_id=$1
		 ORDER BY s.block_time DESC, s.log_index DESC
		 LIMIT $2`, a.ChainID, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var bt, height int64
		var tx, pair []byte
		var s0, s1, a0i, a1i, a0o, a1o, price, usd string
		var side int
		if err := rows.Scan(&bt, &height, &tx, &pair, &s0, &s1, &a0i, &a1i, &a0o, &a1o, &side, &price, &usd); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"block_time":  bt,
			"height":      height,
			"tx":          hexAddr(tx),
			"pair":        hexAddr(pair),
			"symbol0":     s0,
			"symbol1":     s1,
			"amount0_in":  a0i,
			"amount1_in":  a1i,
			"amount0_out": a0o,
			"amount1_out": a1o,
			"side":        side,
			"price":       price,
			"amount_usd":  usd,
		})
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

// ---------- /api/v1/quote ----------

type quoteRequest struct {
	TokenIn  string `json:"token_in"`
	TokenOut string `json:"token_out"`
	AmountIn string `json:"amount_in"`
	MaxHops  int    `json:"max_hops"`
}

type quoteResponse struct {
	TokenIn      string   `json:"token_in"`
	TokenOut     string   `json:"token_out"`
	AmountIn     string   `json:"amount_in"`
	AmountOut    string   `json:"amount_out"`
	PriceImpact  string   `json:"price_impact"`
	Path         []string `json:"path"`
	PairsPath    []string `json:"pairs"`
	Hops         int      `json:"hops"`
	FeeBpsTotal  int      `json:"fee_bps_total"`
}

func (a *API) Quote(w http.ResponseWriter, r *http.Request) {
	var req quoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	in, err := parseAddr(req.TokenIn)
	if err != nil {
		writeErr(w, 400, "token_in: "+err.Error())
		return
	}
	out, err := parseAddr(req.TokenOut)
	if err != nil {
		writeErr(w, 400, "token_out: "+err.Error())
		return
	}
	amt, ok := new(big.Int).SetString(req.AmountIn, 10)
	if !ok || amt.Sign() <= 0 {
		writeErr(w, 400, "amount_in must be positive integer")
		return
	}
	hops := req.MaxHops
	if hops == 0 {
		hops = 3
	}
	// Bound the search wall-time so a malformed request (or a graph blow-up
	// after a major liquidity migration) can't tie up an API worker.
	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()
	p, err := a.Router.QuoteExactInCtx(ctx, in, out, amt, hops)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	impact := a.Router.PriceImpact(p)
	tokens := make([]string, len(p.Tokens))
	for i, t := range p.Tokens {
		tokens[i] = hexAddr(t)
	}
	pairs := make([]string, len(p.Pairs))
	for i, x := range p.Pairs {
		pairs[i] = hexAddr(x)
	}
	writeJSON(w, 200, quoteResponse{
		TokenIn:     hexAddr(in),
		TokenOut:    hexAddr(out),
		AmountIn:    p.AmountIn.String(),
		AmountOut:   p.AmountOut.String(),
		PriceImpact: impact.Text('f', 6),
		Path:        tokens,
		PairsPath:   pairs,
		Hops:        p.Hops,
		FeeBpsTotal: p.Hops * 30,
	})
}

// ---------- /api/v1/tokens ----------

type tokenRow struct {
	Address       string `json:"address"`
	Symbol        string `json:"symbol"`
	Name          string `json:"name"`
	Decimals      int    `json:"decimals"`
	TotalSupply   string `json:"total_supply"`
	WrappedNative bool   `json:"wrapped_native"`
	Stablecoin    bool   `json:"stablecoin"`
	TrustScore    int    `json:"trust_score"`
	LogoURL       string `json:"logo_url"`
	PriceUSD      string `json:"price_usd"`
	Volume24h     string `json:"volume_usd_24h"`
}

func (a *API) ListTokens(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 100, 500)
	// `verified=1` filters to trust_score>=2 (curated). The default is to
	// show everything because the listing page itself wants to expose new
	// auto-discovered tokens; the swap token-picker overrides this so users
	// don't accidentally trade arbitrary phishing assets.
	verifiedOnly := r.URL.Query().Get("verified") == "1"
	minTrust := 0
	if verifiedOnly {
		minTrust = 2
	}
	rows, err := a.Pool.Query(r.Context(), `
		SELECT t.address, t.symbol, t.name, t.decimals, t.total_supply,
		       t.is_wrapped_native, t.is_stablecoin, t.trust_score, t.logo_uri,
		       COALESCE((
		         SELECT MAX(price) FROM (
		           SELECT price0_usd AS price FROM pairs WHERE chain_id=t.chain_id AND token0=t.address
		           UNION ALL
		           SELECT price1_usd AS price FROM pairs WHERE chain_id=t.chain_id AND token1=t.address
		         ) p WHERE price > 0
		       ), 0)::text,
		       COALESCE((SELECT volume_usd FROM token_stats
		                  WHERE chain_id=t.chain_id AND token=t.address
		                  ORDER BY bucket DESC LIMIT 1), 0)::text
		  FROM tokens t WHERE t.chain_id=$1 AND t.trust_score >= $3
		 ORDER BY t.trust_score DESC, t.symbol ASC
		 LIMIT $2`, a.ChainID, limit, minTrust)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []tokenRow
	for rows.Next() {
		var t tokenRow
		var addr []byte
		var dec int16
		if err := rows.Scan(&addr, &t.Symbol, &t.Name, &dec, &t.TotalSupply,
			&t.WrappedNative, &t.Stablecoin, &t.TrustScore, &t.LogoURL, &t.PriceUSD, &t.Volume24h); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		t.Address = hexAddr(addr)
		t.Decimals = int(dec)
		out = append(out, t)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func (a *API) GetToken(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddr(chi.URLParam(r, "address"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var t tokenRow
	var addrB []byte
	var dec int16
	err = a.Pool.QueryRow(r.Context(), `
		SELECT t.address, t.symbol, t.name, t.decimals, t.total_supply,
		       t.is_wrapped_native, t.is_stablecoin, t.trust_score, t.logo_uri,
		       COALESCE((
		         SELECT MAX(price) FROM (
		           SELECT price0_usd AS price FROM pairs WHERE chain_id=t.chain_id AND token0=t.address
		           UNION ALL
		           SELECT price1_usd AS price FROM pairs WHERE chain_id=t.chain_id AND token1=t.address
		         ) p WHERE price > 0
		       ), 0)::text,
		       COALESCE((SELECT volume_usd FROM token_stats
		                  WHERE chain_id=t.chain_id AND token=t.address
		                  ORDER BY bucket DESC LIMIT 1), 0)::text
		  FROM tokens t WHERE t.chain_id=$1 AND t.address=$2`,
		a.ChainID, addr).Scan(&addrB, &t.Symbol, &t.Name, &dec, &t.TotalSupply,
		&t.WrappedNative, &t.Stablecoin, &t.TrustScore, &t.LogoURL, &t.PriceUSD, &t.Volume24h)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	t.Address = hexAddr(addrB)
	t.Decimals = int(dec)
	writeJSON(w, 200, t)
}

// ---------- /api/v1/portfolio/{owner} ----------

func (a *API) Portfolio(w http.ResponseWriter, r *http.Request) {
	owner, err := parseAddr(chi.URLParam(r, "owner"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ctx := r.Context()
	// LP positions
	prows, err := a.Pool.Query(ctx, `
		SELECT lp.pair, lp.liquidity::text, p.token0, p.token1,
		       COALESCE(t0.symbol,''), COALESCE(t1.symbol,''),
		       p.reserve0::text, p.reserve1::text, p.tvl_usd::text
		  FROM lp_positions lp
		  JOIN pairs p ON p.chain_id=lp.chain_id AND p.address=lp.pair
		  LEFT JOIN tokens t0 ON t0.chain_id=p.chain_id AND t0.address=p.token0
		  LEFT JOIN tokens t1 ON t1.chain_id=p.chain_id AND t1.address=p.token1
		 WHERE lp.chain_id=$1 AND lp.owner=$2 AND lp.liquidity > 0
		 ORDER BY lp.updated_height DESC`, a.ChainID, owner)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer prows.Close()
	var positions []map[string]any
	for prows.Next() {
		var pair, t0, t1 []byte
		var liq, r0, r1, tvl, sym0, sym1 string
		if err := prows.Scan(&pair, &liq, &t0, &t1, &sym0, &sym1, &r0, &r1, &tvl); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		positions = append(positions, map[string]any{
			"pair":     hexAddr(pair),
			"token0":   hexAddr(t0),
			"token1":   hexAddr(t1),
			"symbol0":  sym0,
			"symbol1":  sym1,
			"liquidity": liq,
			"reserve0": r0,
			"reserve1": r1,
			"tvl_usd":  tvl,
		})
	}

	// Recent trade history for this address (across all pairs). Uniswap V2 routes
	// the user's address through `recipient`; some integrators set `sender` too.
	// We match either side so the wallet view is meaningful for normal users.
	srows, err := a.Pool.Query(ctx, `
		SELECT EXTRACT(EPOCH FROM s.block_time)::bigint, s.tx_hash, s.pair,
		       COALESCE(t0.symbol,''), COALESCE(t1.symbol,''),
		       s.amount0_in, s.amount1_in, s.amount0_out, s.amount1_out, s.side, s.amount_usd
		  FROM swaps s
		  JOIN pairs p ON p.chain_id=s.chain_id AND p.address=s.pair
		  LEFT JOIN tokens t0 ON t0.chain_id=p.chain_id AND t0.address=p.token0
		  LEFT JOIN tokens t1 ON t1.chain_id=p.chain_id AND t1.address=p.token1
		 WHERE s.chain_id=$1 AND (s.sender=$2 OR s.recipient=$2)
		 ORDER BY s.block_time DESC LIMIT 100`, a.ChainID, owner)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer srows.Close()
	var swaps []map[string]any
	for srows.Next() {
		var bt int64
		var tx, pair []byte
		var s0, s1, a0i, a1i, a0o, a1o, usd string
		var side int
		if err := srows.Scan(&bt, &tx, &pair, &s0, &s1, &a0i, &a1i, &a0o, &a1o, &side, &usd); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		swaps = append(swaps, map[string]any{
			"block_time":  bt,
			"tx":          hexAddr(tx),
			"pair":        hexAddr(pair),
			"symbol0":     s0,
			"symbol1":     s1,
			"amount0_in":  a0i,
			"amount1_in":  a1i,
			"amount0_out": a0o,
			"amount1_out": a1o,
			"side":        side,
			"amount_usd":  usd,
		})
	}

	writeJSON(w, 200, map[string]any{
		"owner":     hexAddr(owner),
		"positions": positions,
		"swaps":     swaps,
	})
}

// ---------- /api/v1/pairs/{address}/liquidity ----------

func (a *API) PairLiquidityEvents(w http.ResponseWriter, r *http.Request) {
	addr, err := parseAddr(chi.URLParam(r, "address"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	limit := intParam(r, "limit", 50, 500)
	rows, err := a.Pool.Query(r.Context(), `
		SELECT EXTRACT(EPOCH FROM block_time)::bigint, height, tx_hash,
		       kind::text, provider, amount0::text, amount1::text, liquidity::text, amount_usd::text
		  FROM liquidity_events WHERE chain_id=$1 AND pair=$2
		 ORDER BY block_time DESC, log_index DESC LIMIT $3`, a.ChainID, addr, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var bt, h int64
		var tx, prov []byte
		var kind, a0, a1, liq, usd string
		if err := rows.Scan(&bt, &h, &tx, &kind, &prov, &a0, &a1, &liq, &usd); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"block_time": bt,
			"height":     h,
			"tx":         hexAddr(tx),
			"kind":       kind,
			"provider":   hexAddr(prov),
			"amount0":    a0,
			"amount1":    a1,
			"liquidity":  liq,
			"amount_usd": usd,
		})
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

// ---------- /api/v1/search?q=... ----------

func (a *API) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeJSON(w, 200, map[string]any{"items": []any{}})
		return
	}
	out := []map[string]any{}

	// Heuristic: 0x-prefixed 64-hex string → tx hash. Look it up in swaps.
	bare := strings.ToLower(strings.TrimPrefix(q, "0x"))
	if len(bare) == 64 {
		if hashB, err := hex.DecodeString(bare); err == nil {
			var pair []byte
			var bt int64
			err := a.Pool.QueryRow(r.Context(),
				`SELECT pair, EXTRACT(EPOCH FROM block_time)::bigint
				   FROM swaps WHERE chain_id=$1 AND tx_hash=$2 LIMIT 1`,
				a.ChainID, hashB).Scan(&pair, &bt)
			if err == nil {
				out = append(out, map[string]any{
					"kind":     "tx",
					"id":       "0x" + bare,
					"title":    "Swap " + bare[:10] + "…",
					"subtitle": hexAddr(pair),
					"rank":     10,
				})
			}
		}
	}

	rows, err := a.Pool.Query(r.Context(), `
		SELECT kind, id, title, subtitle, rank
		  FROM search_index
		 WHERE chain_id=$1
		   AND (title ILIKE '%' || $2 || '%' OR id ILIKE '%' || $3 || '%')
		 ORDER BY rank DESC, title ASC
		 LIMIT 20`, a.ChainID, q, bare)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var kind, id, title, subtitle string
		var rank int
		if err := rows.Scan(&kind, &id, &title, &subtitle, &rank); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"kind": kind, "id": "0x" + id, "title": title, "subtitle": subtitle, "rank": rank,
		})
	}
	writeJSON(w, 200, map[string]any{"items": out})
}
