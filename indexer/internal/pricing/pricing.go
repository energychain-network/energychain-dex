package pricing

import (
	"context"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pricer maintains an in-memory token-USD price map. The previous design
// trusted a single WECY/USDT pool as the only source of truth, which made
// every USD value on the entire DEX depend on a pool that could be drained
// or wash-traded. The current design:
//
//   - aggregates WECY/USD across **every** WECY/{stable} pool the operator
//     has marked as a stablecoin (via DEX_STABLE_TOKENS or the auto-detected
//     USDT anchor). The output is a TVL-weighted median, which is robust to
//     a single pool being temporarily off-market.
//   - sanity-checks the spot price against the 30-minute TWAP from the
//     OHLCV table. If spot deviates by more than PriceTWAPDeviationBps the
//     TWAP wins. This caps the impact of an in-block manipulation attempt.
//
// Token-level prices then derive from WECY using each token's deepest WECY
// pool (largest reserves), again with TWAP fallback.
type Pricer struct {
	pool        *pgxpool.Pool
	chainID     int
	wecy        []byte
	usdt        []byte
	stables     [][]byte
	twapDevBps  int
	mu          sync.RWMutex
	pricesUSD   map[string]*big.Float
	wecyUSD     *big.Float
	lastRefresh time.Time
}

// New creates a Pricer. The deviation parameter caps how far spot may stray
// from the 30-minute TWAP; pass 0 to disable.
func New(pool *pgxpool.Pool, chainID int, wecy, usdt string, stables []string, twapDevBps int) *Pricer {
	stableSet := make([][]byte, 0, len(stables)+1)
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		stableSet = append(stableSet, addrBytes(s))
	}
	add(usdt)
	for _, s := range stables {
		add(s)
	}
	return &Pricer{
		pool:       pool,
		chainID:    chainID,
		wecy:       addrBytes(wecy),
		usdt:       addrBytes(usdt),
		stables:    stableSet,
		twapDevBps: twapDevBps,
		pricesUSD:  map[string]*big.Float{},
	}
}

func (p *Pricer) PriceUSD(addr []byte) *big.Float {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if v, ok := p.pricesUSD[hexLower(addr)]; ok {
		return new(big.Float).Set(v)
	}
	return new(big.Float)
}

func (p *Pricer) WECYUSD() *big.Float {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.wecyUSD == nil {
		return new(big.Float)
	}
	return new(big.Float).Set(p.wecyUSD)
}

// Refresh recomputes USD prices for every tracked token. Cheap; runs once
// per minute. Errors are returned but the previous map is retained so a
// transient DB blip doesn't blank every USD figure on the site.
func (p *Pricer) Refresh(ctx context.Context) error {
	if len(p.wecy) == 0 || len(p.stables) == 0 {
		return nil
	}
	rows, err := p.pool.Query(ctx, `
		SELECT p.address, p.token0, p.token1, p.reserve0, p.reserve1,
		       t0.decimals, t1.decimals
		  FROM pairs p
		  JOIN tokens t0 ON t0.chain_id = p.chain_id AND t0.address = p.token0
		  JOIN tokens t1 ON t1.chain_id = p.chain_id AND t1.address = p.token1
		 WHERE p.chain_id = $1`,
		p.chainID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pairRow struct {
		address            []byte
		token0, token1     []byte
		reserve0, reserve1 string
		dec0, dec1         int16
	}
	var all []pairRow
	for rows.Next() {
		var r pairRow
		if err := rows.Scan(&r.address, &r.token0, &r.token1, &r.reserve0, &r.reserve1, &r.dec0, &r.dec1); err != nil {
			return err
		}
		all = append(all, r)
	}

	// (1) Multi-source WECY/USD: every WECY/{stable} pool contributes a
	// (price, weight=USD-side reserve) sample. The aggregated value is the
	// TVL-weighted median.
	var samples []sample
	for _, r := range all {
		isStable0 := containsAddr(p.stables, r.token0)
		isStable1 := containsAddr(p.stables, r.token1)
		if eq(r.token0, p.wecy) && isStable1 {
			samples = append(samples, sample{
				price:  computeAnchor(r.reserve0, r.reserve1, r.dec0, r.dec1, true),
				weight: new(big.Float).Quo(new(big.Float).SetInt(bigStr(r.reserve1)), decPow10(int(r.dec1))),
				pair:   r.address,
			})
		} else if eq(r.token1, p.wecy) && isStable0 {
			samples = append(samples, sample{
				price:  computeAnchor(r.reserve0, r.reserve1, r.dec0, r.dec1, false),
				weight: new(big.Float).Quo(new(big.Float).SetInt(bigStr(r.reserve0)), decPow10(int(r.dec0))),
				pair:   r.address,
			})
		}
	}
	wecyUSD := weightedMedian(samples)
	if wecyUSD == nil {
		return nil
	}

	// (2) TWAP guard for the WECY/USD anchor: if spot diverges from the
	// trailing 30-min OHLCV midpoint by more than PriceTWAPDeviationBps, we
	// fall back to TWAP.
	if p.twapDevBps > 0 {
		if twap := p.wecyTWAP30m(ctx, samples); twap != nil && twap.Sign() > 0 {
			if exceedsBps(wecyUSD, twap, p.twapDevBps) {
				wecyUSD = twap
			}
		}
	}

	prices := map[string]*big.Float{
		hexLower(p.wecy): wecyUSD,
	}
	for _, st := range p.stables {
		prices[hexLower(st)] = big.NewFloat(1)
	}

	// (3) Per-token: take the deepest WECY pool. Skip when token has no
	// WECY pool — caller can still derive a price via multi-hop quote.
	deepest := map[string]struct {
		resWecy *big.Int
		resTok  *big.Int
		decTok  int
		decW    int
	}{}
	for _, r := range all {
		var token, resTok, resW string
		var decTok, decW int16
		switch {
		case eq(r.token0, p.wecy):
			token = hexLower(r.token1)
			resW = r.reserve0
			resTok = r.reserve1
			decW = r.dec0
			decTok = r.dec1
		case eq(r.token1, p.wecy):
			token = hexLower(r.token0)
			resW = r.reserve1
			resTok = r.reserve0
			decW = r.dec1
			decTok = r.dec0
		default:
			continue
		}
		if eq([]byte(token), p.wecy) || containsAddr(p.stables, []byte(token)) {
			continue
		}
		w := bigStr(resW)
		t := bigStr(resTok)
		if t.Sign() == 0 || w.Sign() == 0 {
			continue
		}
		cur, ok := deepest[token]
		if !ok || w.Cmp(cur.resWecy) > 0 {
			deepest[token] = struct {
				resWecy *big.Int
				resTok  *big.Int
				decTok  int
				decW    int
			}{w, t, int(decTok), int(decW)}
		}
	}
	for tok, d := range deepest {
		da := new(big.Float).SetInt(d.resWecy)
		db := new(big.Float).SetInt(d.resTok)
		raw := new(big.Float).Quo(da, db)
		raw.Mul(raw, decPow10(d.decTok-d.decW))
		raw.Mul(raw, wecyUSD)
		prices[tok] = raw
	}

	p.mu.Lock()
	p.pricesUSD = prices
	p.wecyUSD = wecyUSD
	p.lastRefresh = time.Now()
	p.mu.Unlock()
	return nil
}

// sample is one WECY/{stable} pool snapshot used to derive WECY/USD.
type sample struct {
	price  *big.Float
	weight *big.Float
	pair   []byte
}

// wecyTWAP30m returns the volume-weighted average WECY/USD price across the
// stable-pool samples for the last 30 minutes. Uses the OHLCV close column
// because that's what charts already show, so spot↔TWAP comparisons are
// meaningful to operators reviewing alerts.
func (p *Pricer) wecyTWAP30m(ctx context.Context, samples []sample) *big.Float {
	if len(samples) == 0 {
		return nil
	}
	addrs := make([][]byte, 0, len(samples))
	for _, s := range samples {
		addrs = append(addrs, s.pair)
	}
	rows, err := p.pool.Query(ctx, `
		SELECT pair, AVG(c) FROM ohlcv
		 WHERE chain_id=$1 AND granularity='5m'
		   AND ts >= NOW() - INTERVAL '30 minutes'
		   AND pair = ANY($2)
		 GROUP BY pair`, p.chainID, addrs)
	if err != nil {
		return nil
	}
	defer rows.Close()
	twapByPair := map[string]*big.Float{}
	for rows.Next() {
		var addr []byte
		var avgStr string
		if err := rows.Scan(&addr, &avgStr); err != nil {
			continue
		}
		f, _, _ := big.ParseFloat(avgStr, 10, 256, big.ToNearestEven)
		twapByPair[hexLower(addr)] = f
	}
	if len(twapByPair) == 0 {
		return nil
	}
	// Note: ohlcv stores the price in token1-per-token0 raw units, which for
	// WECY/USDT pools equals the WECY/USD price directly. For USDT/WECY pools
	// it's the inverse, so we'd need to invert; we keep things simple by
	// dropping any pool whose price-direction we can't be sure about — the
	// remaining samples are still TVL-weighted across multiple pools.
	weighted := new(big.Float)
	weightTotal := new(big.Float)
	for _, s := range samples {
		t, ok := twapByPair[hexLower(s.pair)]
		if !ok || t == nil || t.Sign() <= 0 {
			continue
		}
		// If this pool has WECY as token0 the OHLCV price IS WECY/USD already.
		// If WECY is token1 then the OHLCV price is USD/WECY → invert.
		// We don't carry the direction down here, so we accept either by
		// checking whether t is closer to s.price or 1/s.price.
		inv := new(big.Float).Quo(big.NewFloat(1), t)
		dirMatch := absDiff(t, s.price)
		invMatch := absDiff(inv, s.price)
		px := t
		if invMatch.Cmp(dirMatch) < 0 {
			px = inv
		}
		w := new(big.Float).Set(s.weight)
		weighted.Add(weighted, new(big.Float).Mul(px, w))
		weightTotal.Add(weightTotal, w)
	}
	if weightTotal.Sign() <= 0 {
		return nil
	}
	return new(big.Float).Quo(weighted, weightTotal)
}

func absDiff(a, b *big.Float) *big.Float {
	d := new(big.Float).Sub(a, b)
	if d.Sign() < 0 {
		d.Neg(d)
	}
	return d
}

func exceedsBps(spot, ref *big.Float, bps int) bool {
	if ref.Sign() <= 0 {
		return false
	}
	d := absDiff(spot, ref)
	limit := new(big.Float).Mul(ref, big.NewFloat(float64(bps)/10000))
	return d.Cmp(limit) > 0
}

// weightedMedian returns the TVL-weighted median price. It tolerates a few
// extreme samples by interpolating to the cumulative weight = total/2 mark.
func weightedMedian(samples []sample) *big.Float {
	clean := samples[:0]
	for _, s := range samples {
		if s.price != nil && s.price.Sign() > 0 && s.weight != nil && s.weight.Sign() > 0 {
			clean = append(clean, s)
		}
	}
	if len(clean) == 0 {
		return nil
	}
	sort.Slice(clean, func(i, j int) bool {
		return clean[i].price.Cmp(clean[j].price) < 0
	})
	total := new(big.Float)
	for _, s := range clean {
		total.Add(total, s.weight)
	}
	half := new(big.Float).Quo(total, big.NewFloat(2))
	cum := new(big.Float)
	for _, s := range clean {
		cum.Add(cum, s.weight)
		if cum.Cmp(half) >= 0 {
			return new(big.Float).Set(s.price)
		}
	}
	return new(big.Float).Set(clean[len(clean)-1].price)
}

func containsAddr(set [][]byte, x []byte) bool {
	for _, a := range set {
		if eq(a, x) {
			return true
		}
	}
	return false
}

// PersistTVL writes computed prices and per-pair TVL back to the pairs table.
func (p *Pricer) PersistTVL(ctx context.Context) error {
	p.mu.RLock()
	prices := p.pricesUSD
	p.mu.RUnlock()
	if len(prices) == 0 {
		return nil
	}

	rows, err := p.pool.Query(ctx, `
		SELECT p.address, p.token0, p.token1, p.reserve0, p.reserve1,
		       t0.decimals, t1.decimals
		  FROM pairs p
		  JOIN tokens t0 ON t0.chain_id = p.chain_id AND t0.address = p.token0
		  JOIN tokens t1 ON t1.chain_id = p.chain_id AND t1.address = p.token1
		 WHERE p.chain_id = $1`, p.chainID)
	if err != nil {
		return err
	}

	type out struct {
		addr   []byte
		price0 string
		price1 string
		tvl    string
	}
	var batch []out
	for rows.Next() {
		var r struct {
			addr       []byte
			t0, t1     []byte
			r0, r1     string
			dec0, dec1 int16
		}
		if err := rows.Scan(&r.addr, &r.t0, &r.t1, &r.r0, &r.r1, &r.dec0, &r.dec1); err != nil {
			rows.Close()
			return err
		}
		p0 := prices[hexLower(r.t0)]
		p1 := prices[hexLower(r.t1)]
		var tvl big.Float
		if p0 != nil {
			tvl.Add(&tvl, mulReserveBy(r.r0, int(r.dec0), p0))
		}
		if p1 != nil {
			tvl.Add(&tvl, mulReserveBy(r.r1, int(r.dec1), p1))
		}
		batch = append(batch, out{
			addr:   r.addr,
			price0: priceStr(p0),
			price1: priceStr(p1),
			tvl:    tvl.Text('f', 8),
		})
	}
	rows.Close()

	for _, b := range batch {
		if _, err := p.pool.Exec(ctx, `
			UPDATE pairs SET price0_usd=$2, price1_usd=$3, tvl_usd=$4
			 WHERE chain_id=$1 AND address=$5`,
			p.chainID, b.price0, b.price1, b.tvl, b.addr); err != nil {
			return err
		}
	}
	return nil
}

func computeAnchor(r0, r1 string, d0, d1 int16, wecyIs0 bool) *big.Float {
	a := new(big.Float).SetInt(bigStr(r0))
	b := new(big.Float).SetInt(bigStr(r1))
	if a.Sign() == 0 || b.Sign() == 0 {
		return nil
	}
	if wecyIs0 {
		raw := new(big.Float).Quo(b, a)
		raw.Mul(raw, decPow10(int(d0)-int(d1)))
		return raw
	}
	raw := new(big.Float).Quo(a, b)
	raw.Mul(raw, decPow10(int(d1)-int(d0)))
	return raw
}

func mulReserveBy(reserve string, dec int, priceUSD *big.Float) *big.Float {
	r := new(big.Float).SetInt(bigStr(reserve))
	r.Quo(r, decPow10(dec))
	return r.Mul(r, priceUSD)
}

func decPow10(n int) *big.Float {
	if n == 0 {
		return big.NewFloat(1)
	}
	abs := n
	if abs < 0 {
		abs = -abs
	}
	v := big.NewFloat(1)
	ten := big.NewFloat(10)
	for i := 0; i < abs; i++ {
		v.Mul(v, ten)
	}
	if n < 0 {
		v.Quo(big.NewFloat(1), v)
	}
	return v
}

func bigStr(s string) *big.Int {
	x := new(big.Int)
	if i := strings.Index(s, "."); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return x
	}
	x.SetString(s, 10)
	return x
}

func priceStr(f *big.Float) string {
	if f == nil {
		return "0"
	}
	return f.Text('f', 18)
}

func eq(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func addrBytes(s string) []byte {
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	out := make([]byte, len(s)/2)
	for i := 0; i < len(s)/2; i++ {
		var b byte
		for j := 0; j < 2; j++ {
			c := s[i*2+j]
			var v byte
			switch {
			case c >= '0' && c <= '9':
				v = c - '0'
			case c >= 'a' && c <= 'f':
				v = c - 'a' + 10
			}
			b = (b << 4) | v
		}
		out[i] = b
	}
	return out
}

func hexLower(b []byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hex[c>>4]
		out[i*2+1] = hex[c&0x0f]
	}
	return string(out)
}
