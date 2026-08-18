// Package cosmos is a dependency-light client for the EnergyChain native
// Cosmos layer. It talks to:
//
//   - CometBFT RPC  (:26657)  for per-height block events + block time
//     (the source for time-series: market clears, mincast trades, order
//     activity, token transfers used to maintain balances), and
//   - the gRPC-gateway REST API (:1317) for authoritative entity state
//     snapshots (denoms, tokens, markets, order books, offerings, ...).
//
// We deliberately avoid importing the chain's Go module: REST query routes
// are the auto-generated unbound methods
//
//	POST /energychain.<module>.v1.Query/<Method>
//
// with a JSON request body and a snake_case JSON response (Cosmos SDK
// gateway marshals uint64/int64 as quoted strings and enums as their proto
// names), so plain net/http + encoding/json is sufficient and keeps the
// indexer decoupled from chain releases.
package cosmos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Client is safe for concurrent use.
type Client struct {
	rpc  string // CometBFT RPC base, e.g. http://localhost:26657
	rest string // gRPC-gateway REST base, e.g. http://localhost:1317
	hc   *http.Client
}

func New(rpc, rest string) *Client {
	return &Client{
		rpc:  strings.TrimRight(rpc, "/"),
		rest: strings.TrimRight(rest, "/"),
		hc:   &http.Client{Timeout: 20 * time.Second},
	}
}

// ---------------------------------------------------------------------------
// CometBFT RPC
// ---------------------------------------------------------------------------

// Attribute is one event attribute. CometBFT >= 0.38 returns plain strings;
// older nodes base64-encode them, which DecodeAttr transparently handles.
type Attribute struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Event is a typed ABCI event with its attributes flattened into a map for
// convenient lookup. Duplicate keys keep the last value (events here never
// repeat a key).
type Event struct {
	Type  string
	Attrs map[string]string
}

// BlockResults holds the decoded events for one block: transaction events
// (paired with their tx hash) and the finalize-block (BeginBlock/EndBlock)
// events where module EndBlockers emit, e.g. market_clear.
type BlockResults struct {
	Height        int64
	Time          time.Time
	TxEvents      []TxEvents
	FinalizeBlock []Event
}

type TxEvents struct {
	TxHash string
	Code   int
	Events []Event
}

type rpcEnvelope struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
		Data    string `json:"data"`
	} `json:"error"`
}

func (c *Client) rpcGet(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.rpc+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("rpc %s: status %d: %s", path, resp.StatusCode, truncate(body))
	}
	var env rpcEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("rpc %s: decode: %w", path, err)
	}
	if env.Error != nil {
		return fmt.Errorf("rpc %s: %s %s", path, env.Error.Message, env.Error.Data)
	}
	return json.Unmarshal(env.Result, out)
}

// LatestHeight returns the chain tip height.
func (c *Client) LatestHeight(ctx context.Context) (int64, error) {
	var res struct {
		SyncInfo struct {
			LatestBlockHeight string `json:"latest_block_height"`
		} `json:"sync_info"`
	}
	if err := c.rpcGet(ctx, "/status", &res); err != nil {
		return 0, err
	}
	return parseInt(res.SyncInfo.LatestBlockHeight), nil
}

// BlockResults fetches and decodes the events of one block plus its time and
// per-tx hashes.
func (c *Client) BlockResults(ctx context.Context, height int64) (*BlockResults, error) {
	out := &BlockResults{Height: height}

	// Block: header time + raw txs (for hashes).
	var blk struct {
		Block struct {
			Header struct {
				Time string `json:"time"`
			} `json:"header"`
			Data struct {
				Txs []string `json:"txs"`
			} `json:"data"`
		} `json:"block"`
	}
	if err := c.rpcGet(ctx, "/block?height="+strconv.FormatInt(height, 10), &blk); err != nil {
		return nil, err
	}
	t, err := time.Parse(time.RFC3339Nano, blk.Block.Header.Time)
	if err != nil {
		t = time.Now().UTC()
	}
	out.Time = t
	txHashes := make([]string, len(blk.Block.Data.Txs))
	for i, raw := range blk.Block.Data.Txs {
		txHashes[i] = txHash(raw)
	}

	// Block results: events.
	var br struct {
		TxsResults []struct {
			Code   int `json:"code"`
			Events []struct {
				Type       string      `json:"type"`
				Attributes []Attribute `json:"attributes"`
			} `json:"events"`
		} `json:"txs_results"`
		FinalizeBlockEvents []struct {
			Type       string      `json:"type"`
			Attributes []Attribute `json:"attributes"`
		} `json:"finalize_block_events"`
		// Fallback fields for pre-0.38 nodes.
		BeginBlockEvents []struct {
			Type       string      `json:"type"`
			Attributes []Attribute `json:"attributes"`
		} `json:"begin_block_events"`
		EndBlockEvents []struct {
			Type       string      `json:"type"`
			Attributes []Attribute `json:"attributes"`
		} `json:"end_block_events"`
	}
	if err := c.rpcGet(ctx, "/block_results?height="+strconv.FormatInt(height, 10), &br); err != nil {
		return nil, err
	}

	for i, tx := range br.TxsResults {
		te := TxEvents{Code: tx.Code}
		if i < len(txHashes) {
			te.TxHash = txHashes[i]
		}
		for _, ev := range tx.Events {
			te.Events = append(te.Events, flatten(ev.Type, ev.Attributes))
		}
		out.TxEvents = append(out.TxEvents, te)
	}
	collect := func(typ string, attrs []Attribute) {
		out.FinalizeBlock = append(out.FinalizeBlock, flatten(typ, attrs))
	}
	for _, ev := range br.FinalizeBlockEvents {
		collect(ev.Type, ev.Attributes)
	}
	for _, ev := range br.BeginBlockEvents {
		collect(ev.Type, ev.Attributes)
	}
	for _, ev := range br.EndBlockEvents {
		collect(ev.Type, ev.Attributes)
	}
	return out, nil
}

func flatten(typ string, attrs []Attribute) Event {
	m := make(map[string]string, len(attrs))
	for _, a := range attrs {
		// Some attribute values carry raw (non-UTF8) bytes; strip invalid
		// sequences so Postgres text columns (UTF8) accept them.
		m[strings.ToValidUTF8(DecodeAttr(a.Key), "")] = strings.ToValidUTF8(DecodeAttr(a.Value), "")
	}
	return Event{Type: typ, Attrs: m}
}

// DecodeAttr returns the plain attribute text, transparently base64-decoding
// values produced by CometBFT < 0.38.
func DecodeAttr(s string) string {
	if s == "" {
		return s
	}
	// Heuristic: pre-0.38 base64 strings only contain the base64 alphabet and
	// decode cleanly. Plain values like "place" also decode under StdEncoding
	// only when length%4==0 and charset matches, so we additionally require the
	// decoded bytes to be valid UTF-8 different from the input.
	if dec, err := base64.StdEncoding.DecodeString(s); err == nil && len(dec) > 0 {
		ds := string(dec)
		if isPrintable(ds) && ds != s && looksBase64(s) {
			return ds
		}
	}
	return s
}

func looksBase64(s string) bool {
	if len(s)%4 != 0 {
		return false
	}
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '+' || r == '/' || r == '=' {
			continue
		}
		return false
	}
	return true
}

func isPrintable(s string) bool {
	// Reject anything that is not valid UTF-8: ranging over a string with
	// invalid bytes yields U+FFFD (which would otherwise look "printable"),
	// so plain numeric values like "20000000" must not be mistaken for
	// base64 that decodes to binary.
	if !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if r == '\t' || r == '\n' || r == '\r' {
			continue
		}
		if !unicode.IsPrint(r) {
			return false
		}
	}
	return true
}

func txHash(rawBase64 string) string {
	b, err := base64.StdEncoding.DecodeString(rawBase64)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// ---------------------------------------------------------------------------
// REST gRPC-gateway query
// ---------------------------------------------------------------------------

// Query POSTs to /<fullMethod> (e.g. "energychain.market.v1.Query/Markets")
// with `req` as the JSON body and decodes the JSON response into `out`.
func (c *Client) Query(ctx context.Context, fullMethod string, req any, out any) error {
	var body io.Reader
	if req != nil {
		b, err := json.Marshal(req)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	} else {
		body = bytes.NewReader([]byte("{}"))
	}
	url := c.rest + "/" + strings.TrimLeft(fullMethod, "/")
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return err
	}
	httpReq.Header.Set("content-type", "application/json")
	resp, err := c.hc.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	rb, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("query %s: status %d: %s", fullMethod, resp.StatusCode, truncate(rb))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(rb, out)
}

// REST returns the configured REST base URL (for the API tx-broadcast proxy).
func (c *Client) REST() string { return c.rest }

// HTTP exposes the shared client for the broadcast proxy.
func (c *Client) HTTP() *http.Client { return c.hc }

// ---------------------------------------------------------------------------

func truncate(b []byte) string {
	const max = 512
	if len(b) > max {
		return string(b[:max]) + "..."
	}
	return string(b)
}

func parseInt(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
