package routing

import (
	"math/big"
	"testing"
)

// getAmountOut should match Uniswap V2's reference math:
//   amountInWithFee = amountIn * 997
//   numerator       = amountInWithFee * reserveOut
//   denominator     = reserveIn * 1000 + amountInWithFee
//   out             = numerator / denominator
//
// We test against a hand-computed value so any drift in the formula is caught.
func TestGetAmountOut_Reference(t *testing.T) {
	feeN := big.NewInt(997)
	feeD := big.NewInt(1000)
	in := big.NewInt(1_000)         // 1000 wei in
	rIn := big.NewInt(1_000_000)
	rOut := big.NewInt(2_000_000)
	got := getAmountOut(in, rIn, rOut, feeN, feeD)
	// numerator = 997000 * 2_000_000 = 1_994_000_000_000
	// denom     = 1_000_000 * 1000 + 997_000 = 1_000_997_000
	// out       = 1_994_000_000_000 / 1_000_997_000 = 1992
	want := big.NewInt(1992)
	if got.Cmp(want) != 0 {
		t.Fatalf("getAmountOut = %s, want %s", got, want)
	}
}

func TestGetAmountOut_ZeroReserve(t *testing.T) {
	out := getAmountOut(big.NewInt(100), big.NewInt(0), big.NewInt(1000), big.NewInt(997), big.NewInt(1000))
	if out.Sign() != 0 {
		t.Fatalf("expected 0 for empty reserve, got %s", out)
	}
}

// QuoteExactIn over a manually-built two-edge graph A→B→C verifies that the
// router actually finds the multi-hop path and that the output amount equals
// applying getAmountOut twice in sequence.
func TestQuoteExactIn_TwoHops(t *testing.T) {
	r := New(nil, 9001)
	a := []byte{0xa1}
	b := []byte{0xb2}
	c := []byte{0xc3}
	pairAB := []byte{0x10}
	pairBC := []byte{0x20}

	rAB_in := big.NewInt(1_000_000)
	rAB_out := big.NewInt(2_000_000)
	rBC_in := big.NewInt(5_000_000)
	rBC_out := big.NewInt(1_500_000)

	r.graph[hexLower(a)] = []edge{{pair: pairAB, other: b, reserveIn: rAB_in, reserveOut: rAB_out}}
	r.graph[hexLower(b)] = []edge{
		{pair: pairAB, other: a, reserveIn: rAB_out, reserveOut: rAB_in},
		{pair: pairBC, other: c, reserveIn: rBC_in, reserveOut: rBC_out},
	}
	r.graph[hexLower(c)] = []edge{{pair: pairBC, other: b, reserveIn: rBC_out, reserveOut: rBC_in}}

	in := big.NewInt(10_000)
	p, err := r.QuoteExactIn(a, c, in, 3)
	if err != nil {
		t.Fatalf("QuoteExactIn error: %v", err)
	}
	if p.Hops != 2 {
		t.Fatalf("expected 2 hops, got %d (path %x)", p.Hops, p.Pairs)
	}

	// Reference: hop 1 (A→B), hop 2 (B→C)
	mid := getAmountOut(in, rAB_in, rAB_out, r.feeNum, r.feeDen)
	want := getAmountOut(mid, rBC_in, rBC_out, r.feeNum, r.feeDen)
	if p.AmountOut.Cmp(want) != 0 {
		t.Fatalf("AmountOut = %s, want %s", p.AmountOut, want)
	}
}

func TestQuoteExactIn_NoRoute(t *testing.T) {
	r := New(nil, 9001)
	a := []byte{0xa1}
	b := []byte{0xb2}
	if _, err := r.QuoteExactIn(a, b, big.NewInt(1), 3); err != ErrNoRoute {
		t.Fatalf("expected ErrNoRoute, got %v", err)
	}
}
