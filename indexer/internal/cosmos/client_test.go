package cosmos

import (
	"encoding/base64"
	"testing"
)

func TestDecodeAttr(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain word", "place", "place"},
		{"plain enum", "ORDER_STATUS_OPEN", "ORDER_STATUS_OPEN"},
		{"empty", "", ""},
		{"numeric string", "12345", "12345"},
		{"base64 of action", base64.StdEncoding.EncodeToString([]byte("place")), "place"},
		{"base64 of market_id key", base64.StdEncoding.EncodeToString([]byte("market_id")), "market_id"},
		{"bech32 address stays", "energy1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq000000", "energy1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq000000"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := DecodeAttr(c.in); got != c.want {
				t.Fatalf("DecodeAttr(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestLooksBase64(t *testing.T) {
	if looksBase64("place") {
		// len 5 not multiple of 4 -> false
		t.Fatalf("expected 'place' not to look base64")
	}
	if !looksBase64(base64.StdEncoding.EncodeToString([]byte("market_id"))) {
		t.Fatalf("expected base64 of market_id to look base64")
	}
}

func TestTxHash(t *testing.T) {
	// SHA-256 of empty bytes, uppercased hex.
	raw := base64.StdEncoding.EncodeToString([]byte{})
	got := txHash(raw)
	const want = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
	if got != want {
		t.Fatalf("txHash(empty) = %q, want %q", got, want)
	}
}

func TestFlatten(t *testing.T) {
	ev := flatten("market_order", []Attribute{
		{Key: "action", Value: "place"},
		{Key: "market_id", Value: "7"},
		{Key: "price", Value: "100"},
	})
	if ev.Type != "market_order" {
		t.Fatalf("type = %q", ev.Type)
	}
	if ev.Attrs["action"] != "place" || ev.Attrs["market_id"] != "7" || ev.Attrs["price"] != "100" {
		t.Fatalf("attrs = %+v", ev.Attrs)
	}
}
