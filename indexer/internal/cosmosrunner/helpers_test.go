package cosmosrunner

import (
	"testing"

	"energychain/dex/indexer/internal/cosmos"
)

func TestNumDefaults(t *testing.T) {
	ev := cosmos.Event{Type: "market_clear", Attrs: map[string]string{"price": "1000000000000000000"}}
	if got := num(ev, "price"); got != "1000000000000000000" {
		t.Fatalf("num price = %q", got)
	}
	// Missing key defaults to "0" so it slots into a NUMERIC column.
	if got := num(ev, "qty"); got != "0" {
		t.Fatalf("num missing = %q, want 0", got)
	}
	// Empty value also defaults to "0".
	ev.Attrs["empty"] = ""
	if got := num(ev, "empty"); got != "0" {
		t.Fatalf("num empty = %q, want 0", got)
	}
}

func TestU64(t *testing.T) {
	ev := cosmos.Event{Attrs: map[string]string{"market_id": "42", "bad": "x"}}
	if got := u64(ev, "market_id"); got != 42 {
		t.Fatalf("u64 = %d", got)
	}
	if got := u64(ev, "bad"); got != 0 {
		t.Fatalf("u64 bad = %d, want 0", got)
	}
	if got := u64(ev, "missing"); got != 0 {
		t.Fatalf("u64 missing = %d, want 0", got)
	}
}

func TestParseUAndNum0(t *testing.T) {
	// uint64 beyond int64 range must round-trip (overflow guard for ids/amounts).
	const big = "18446744073709551615" // max uint64
	if got := parseU(big); got != 18446744073709551615 {
		t.Fatalf("parseU big = %d", got)
	}
	if got := parseU(""); got != 0 {
		t.Fatalf("parseU empty = %d", got)
	}
	if got := num0(""); got != "0" {
		t.Fatalf("num0 empty = %q", got)
	}
	if got := num0("123"); got != "123" {
		t.Fatalf("num0 123 = %q", got)
	}
}
