package evm

import (
	"context"
	"encoding/binary"
	"math/big"
	"strings"
	"unicode/utf8"
)

// ERC20Meta is the bare minimum we cache for tokens. Decimals defaults to 18
// when the token doesn't expose the function (some non-standard tokens).
type ERC20Meta struct {
	Symbol      string
	Name        string
	Decimals    uint8
	TotalSupply *big.Int
}

var (
	selSymbol      = methodID("symbol()")
	selName        = methodID("name()")
	selDecimals    = methodID("decimals()")
	selTotalSupply = methodID("totalSupply()")
	selBalanceOf   = methodID("balanceOf(address)")
	selGetReserves = methodID("getReserves()")
)

// BalanceOfAt returns ERC20.balanceOf(owner) at the given block tag.
// Returns zero on call failure (treats unknown owners as zero balance).
func (c *Client) BalanceOfAt(ctx context.Context, token, owner, blockTag string) *big.Int {
	owner = strings.TrimPrefix(strings.ToLower(owner), "0x")
	data := make([]byte, 4+32)
	copy(data[:4], selBalanceOf)
	addr := make([]byte, 32)
	for i := 0; i < 20 && i*2+1 < len(owner); i++ {
		hi := hexNibble(owner[i*2])
		lo := hexNibble(owner[i*2+1])
		addr[12+i] = (hi << 4) | lo
	}
	copy(data[4:], addr)
	out, err := c.EthCall(ctx, token, data, blockTag)
	if err != nil || len(out) < 32 {
		return new(big.Int)
	}
	return new(big.Int).SetBytes(out[:32])
}

// GetReservesAt returns (reserve0, reserve1) for a Uniswap V2 pair at the
// given block tag. Returns nil when the call fails.
func (c *Client) GetReservesAt(ctx context.Context, pair, blockTag string) (*big.Int, *big.Int) {
	out, err := c.EthCall(ctx, pair, selGetReserves, blockTag)
	if err != nil || len(out) < 64 {
		return nil, nil
	}
	r0 := new(big.Int).SetBytes(out[0:32])
	r1 := new(big.Int).SetBytes(out[32:64])
	return r0, r1
}

func hexNibble(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	return 0
}

func methodID(sig string) []byte { return keccak256([]byte(sig))[:4] }

// FetchERC20 reads the four standard view functions sequentially. Any failures
// degrade gracefully (empty string / 18 decimals / zero supply) so that
// non-standard tokens don't block indexing.
func (c *Client) FetchERC20(ctx context.Context, addr string) (*ERC20Meta, error) {
	m := &ERC20Meta{Decimals: 18, TotalSupply: new(big.Int)}

	if out, err := c.EthCall(ctx, addr, selSymbol, "latest"); err == nil {
		m.Symbol = decodeString(out)
	}
	if out, err := c.EthCall(ctx, addr, selName, "latest"); err == nil {
		m.Name = decodeString(out)
	}
	if out, err := c.EthCall(ctx, addr, selDecimals, "latest"); err == nil && len(out) >= 32 {
		m.Decimals = uint8(out[31])
	}
	if out, err := c.EthCall(ctx, addr, selTotalSupply, "latest"); err == nil && len(out) >= 32 {
		m.TotalSupply = new(big.Int).SetBytes(out[:32])
	}
	return m, nil
}

// decodeString accepts either an ABI-encoded `string` (offset-length-data) or
// a 32-byte fixed-size string (some old tokens like MKR).
func decodeString(out []byte) string {
	if len(out) == 0 {
		return ""
	}
	// Standard `string`: first 32 bytes = offset, then 32 bytes = length.
	if len(out) >= 64 {
		off := int(binary.BigEndian.Uint64(out[24:32]))
		if off+32 <= len(out) {
			ln := int(binary.BigEndian.Uint64(out[off+24 : off+32]))
			start := off + 32
			if start+ln <= len(out) && ln > 0 && ln < 1024 {
				s := strings.TrimRight(string(out[start:start+ln]), "\x00")
				if utf8.ValidString(s) {
					return s
				}
			}
		}
	}
	// bytes32 fallback.
	s := strings.TrimRight(string(out[:min(32, len(out))]), "\x00")
	if utf8.ValidString(s) {
		return s
	}
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
