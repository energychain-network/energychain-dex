package routing

import (
	"context"
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Router computes multi-hop swap quotes against the indexed pair graph using
// constant-product math (UniV2 with 0.30% fee). The graph is rebuilt every 30s
// from Postgres so newly-created pairs are picked up automatically without
// any cache invalidation hooks.
//
// Safety guards (P0 audit):
//   - MaxHops is hard-capped at MaxHopsCeiling regardless of input
//   - dust pools (where either reserve is below MinReserveDust in raw units)
//     are excluded from the graph at load time so quote searches don't get
//     stuck in zombie liquidity
//   - QuoteExactInCtx accepts a context so the caller's deadline propagates
//     into the search loop and aborts before chewing through CPU
type Router struct {
	pool      *pgxpool.Pool
	chainID   int
	feeNum    *big.Int // 997
	feeDen    *big.Int // 1000

	mu        sync.RWMutex
	graph     map[string][]edge   // tokenHex -> outgoing edges
	tokenDec  map[string]uint8
	loaded    time.Time
}

const (
	// MaxHopsCeiling is the hard upper bound on quote search depth. Each
	// hop multiplies the branching factor by the average pair degree (~5 in
	// production), so 4 keeps worst-case O(5^4)=625 path expansions.
	MaxHopsCeiling = 4
	// MinReserveDust filters out pairs whose either side has fewer than this
	// many raw units in reserve. 10^9 is generous enough to keep cents-scale
	// 18-decimal liquidity and 6-decimal stablecoin pools in the graph,
	// while pruning empty placeholder LPs that survived a withdrawal.
	MinReserveDust = "1000000000"
)

type edge struct {
	pair     []byte
	other    []byte // the partner token
	reserveIn *big.Int // reserve of `from` token
	reserveOut *big.Int // reserve of `to` token
}

func New(pool *pgxpool.Pool, chainID int) *Router {
	return &Router{
		pool:    pool,
		chainID: chainID,
		feeNum:  big.NewInt(997),
		feeDen:  big.NewInt(1000),
		graph:   map[string][]edge{},
		tokenDec: map[string]uint8{},
	}
}

// Load (re)builds the in-memory graph. Cheap; pairs are usually < 10k.
func (r *Router) Load(ctx context.Context) error {
	rows, err := r.pool.Query(ctx, `
		SELECT p.token0, p.token1, p.address, p.reserve0, p.reserve1,
		       t0.decimals, t1.decimals
		  FROM pairs p
		  JOIN tokens t0 ON t0.chain_id = p.chain_id AND t0.address = p.token0
		  JOIN tokens t1 ON t1.chain_id = p.chain_id AND t1.address = p.token1
		 WHERE p.chain_id = $1`, r.chainID)
	if err != nil {
		return err
	}
	defer rows.Close()

	graph := map[string][]edge{}
	tokenDec := map[string]uint8{}
	dust, _ := new(big.Int).SetString(MinReserveDust, 10)
	for rows.Next() {
		var t0, t1, addr []byte
		var r0, r1 string
		var d0, d1 int16
		if err := rows.Scan(&t0, &t1, &addr, &r0, &r1, &d0, &d1); err != nil {
			return err
		}
		ri0 := bigStr(r0)
		ri1 := bigStr(r1)
		tokenDec[hexLower(t0)] = uint8(d0)
		tokenDec[hexLower(t1)] = uint8(d1)
		// Skip dust pools: empty / drained pairs would otherwise survive in
		// the search graph and waste CPU on guaranteed-zero paths.
		if ri0.Cmp(dust) < 0 || ri1.Cmp(dust) < 0 {
			continue
		}
		graph[hexLower(t0)] = append(graph[hexLower(t0)], edge{pair: addr, other: t1, reserveIn: ri0, reserveOut: ri1})
		graph[hexLower(t1)] = append(graph[hexLower(t1)], edge{pair: addr, other: t0, reserveIn: ri1, reserveOut: ri0})
	}
	r.mu.Lock()
	r.graph = graph
	r.tokenDec = tokenDec
	r.loaded = time.Now()
	r.mu.Unlock()
	return nil
}

func (r *Router) Decimals(token []byte) uint8 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tokenDec[hexLower(token)]
}

// Quote performs an exact-input quote across paths up to `maxHops`.
// Returns the best path (token addresses including both endpoints) and the
// final amount-out, or an error if no path is reachable.
type Path struct {
	Tokens   [][]byte
	Pairs    [][]byte
	AmountIn *big.Int
	AmountOut *big.Int
	Hops     int
}

var ErrNoRoute = errors.New("no route")

// QuoteExactIn keeps the legacy signature; new callers should prefer
// QuoteExactInCtx so a slow search is cancellable.
func (r *Router) QuoteExactIn(tokenIn, tokenOut []byte, amountIn *big.Int, maxHops int) (*Path, error) {
	return r.QuoteExactInCtx(context.Background(), tokenIn, tokenOut, amountIn, maxHops)
}

func (r *Router) QuoteExactInCtx(ctx context.Context, tokenIn, tokenOut []byte, amountIn *big.Int, maxHops int) (*Path, error) {
	if maxHops < 1 {
		maxHops = 1
	}
	if maxHops > MaxHopsCeiling {
		maxHops = MaxHopsCeiling
	}
	if amountIn == nil || amountIn.Sign() <= 0 {
		return nil, ErrNoRoute
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	type frame struct {
		tokens    [][]byte
		pairs     [][]byte
		amount    *big.Int
		current   []byte
	}
	best := (*Path)(nil)
	visit := func(f frame) {
		if eq(f.current, tokenOut) {
			if best == nil || f.amount.Cmp(best.AmountOut) > 0 {
				best = &Path{
					Tokens:    append([][]byte{}, f.tokens...),
					Pairs:     append([][]byte{}, f.pairs...),
					AmountIn:  amountIn,
					AmountOut: new(big.Int).Set(f.amount),
					Hops:      len(f.pairs),
				}
			}
		}
	}

	stack := []frame{{
		tokens:  [][]byte{tokenIn},
		pairs:   nil,
		amount:  amountIn,
		current: tokenIn,
	}}
	// Hard expansion cap: even with MaxHopsCeiling=4 a pathological dense
	// graph (many overlapping pairs around USDT/WECY) can blow up the stack.
	// We cap total visited frames at 5000 — way more than the worst real
	// graph, but a hard ceiling so a quote can never DOS the API.
	const maxFrames = 5000
	frames := 0
	for len(stack) > 0 {
		select {
		case <-ctx.Done():
			if best != nil {
				return best, nil
			}
			return nil, ctx.Err()
		default:
		}
		frames++
		if frames > maxFrames {
			break
		}
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if len(f.pairs) >= maxHops {
			visit(f)
			continue
		}
		visit(f)
		for _, e := range r.graph[hexLower(f.current)] {
			if containsToken(f.tokens, e.other) {
				continue
			}
			out := getAmountOut(f.amount, e.reserveIn, e.reserveOut, r.feeNum, r.feeDen)
			if out.Sign() <= 0 {
				continue
			}
			stack = append(stack, frame{
				tokens:  append(append([][]byte{}, f.tokens...), e.other),
				pairs:   append(append([][]byte{}, f.pairs...), e.pair),
				amount:  out,
				current: e.other,
			})
		}
	}
	if best == nil {
		return nil, ErrNoRoute
	}
	return best, nil
}

// PriceImpact returns the difference between the spot price and the executed
// price as a fraction (e.g. 0.0123 = 1.23%). Computed off the first hop's
// reserves; multi-hop impact compounds along the path.
func (r *Router) PriceImpact(p *Path) *big.Float {
	if p == nil || len(p.Pairs) == 0 {
		return big.NewFloat(0)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	current := p.Tokens[0]
	totalSpot := big.NewFloat(1)
	for i, pairAddr := range p.Pairs {
		var ed *edge
		for _, e := range r.graph[hexLower(current)] {
			if eq(e.pair, pairAddr) {
				ec := e
				ed = &ec
				break
			}
		}
		if ed == nil || ed.reserveIn.Sign() == 0 {
			return big.NewFloat(0)
		}
		spot := new(big.Float).Quo(new(big.Float).SetInt(ed.reserveOut), new(big.Float).SetInt(ed.reserveIn))
		totalSpot.Mul(totalSpot, spot)
		current = p.Tokens[i+1]
	}
	executed := new(big.Float).Quo(new(big.Float).SetInt(p.AmountOut), new(big.Float).SetInt(p.AmountIn))
	if totalSpot.Sign() == 0 {
		return big.NewFloat(0)
	}
	delta := new(big.Float).Sub(totalSpot, executed)
	return new(big.Float).Quo(delta, totalSpot)
}

func getAmountOut(amountIn, reserveIn, reserveOut, feeNum, feeDen *big.Int) *big.Int {
	if amountIn.Sign() <= 0 || reserveIn.Sign() == 0 || reserveOut.Sign() == 0 {
		return new(big.Int)
	}
	amountInWithFee := new(big.Int).Mul(amountIn, feeNum)
	num := new(big.Int).Mul(amountInWithFee, reserveOut)
	denom := new(big.Int).Add(new(big.Int).Mul(reserveIn, feeDen), amountInWithFee)
	if denom.Sign() == 0 {
		return new(big.Int)
	}
	return new(big.Int).Quo(num, denom)
}

func containsToken(xs [][]byte, t []byte) bool {
	for _, x := range xs {
		if eq(x, t) {
			return true
		}
	}
	return false
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

func bigStr(s string) *big.Int {
	x := new(big.Int)
	if i := indexDot(s); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return x
	}
	x.SetString(s, 10)
	return x
}

func indexDot(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			return i
		}
	}
	return -1
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
