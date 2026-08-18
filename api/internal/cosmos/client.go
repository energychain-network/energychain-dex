// Package cosmos is a thin REST client the dex-api uses to reach the
// EnergyChain native layer for the few operations that must be live rather
// than served from the indexed Postgres mirror:
//
//   - authoritative per-account balances (free balance excludes order escrow),
//   - identity.EvaluateTransfer compliance pre-checks, and
//   - mincast.Quote mint/melt previews,
//   - transaction simulate / broadcast proxying (the browser signs with
//     Keplr/CosmJS and POSTs the signed tx bytes here).
package cosmos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	rpc  string
	rest string
	hc   *http.Client
}

func New(rpc, rest string) *Client {
	return &Client{
		rpc:  strings.TrimRight(rpc, "/"),
		rest: strings.TrimRight(rest, "/"),
		hc:   &http.Client{Timeout: 15 * time.Second},
	}
}

// Query POSTs a gRPC-gateway unbound method (e.g.
// "energychain.mincast.v1.Query/Quote") and decodes the JSON response.
func (c *Client) Query(ctx context.Context, fullMethod string, req any, out any) error {
	var body io.Reader = bytes.NewReader([]byte("{}"))
	if req != nil {
		b, err := json.Marshal(req)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	url := c.rest + "/" + strings.TrimLeft(fullMethod, "/")
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return err
	}
	r.Header.Set("content-type", "application/json")
	resp, err := c.hc.Do(r)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("cosmos query %s: status %d: %s", fullMethod, resp.StatusCode, string(rb))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(rb, out)
}

// BroadcastRaw proxies a Cosmos REST POST to an arbitrary fully-qualified
// service method, forwarding the request body verbatim and returning the raw
// response body + status. Used for cosmos.tx.v1beta1.Service/{Simulate,
// BroadcastTx} so the browser never needs to reach the node directly.
func (c *Client) BroadcastRaw(ctx context.Context, fullMethod string, reqBody []byte) (int, []byte, error) {
	url := c.rest + "/" + strings.TrimLeft(fullMethod, "/")
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return 0, nil, err
	}
	r.Header.Set("content-type", "application/json")
	resp, err := c.hc.Do(r)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	return resp.StatusCode, rb, nil
}
