package evm

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Client is a minimal EVM JSON-RPC client. We deliberately avoid go-ethereum
// to keep the binary small; only the calls we use here are implemented.
type Client struct {
	url string
	hc  *http.Client
	id  atomic.Uint64
}

func New(url string) *Client {
	return &Client{
		url: url,
		hc: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type rpcReq struct {
	Jsonrpc string `json:"jsonrpc"`
	ID      uint64 `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

type rpcResp struct {
	Jsonrpc string          `json:"jsonrpc"`
	ID      uint64          `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) call(ctx context.Context, method string, params any, out any) error {
	body, _ := json.Marshal(rpcReq{
		Jsonrpc: "2.0",
		ID:      c.id.Add(1),
		Method:  method,
		Params:  params,
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", c.url, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	var r rpcResp
	if err := json.Unmarshal(raw, &r); err != nil {
		return fmt.Errorf("decode rpc response: %w (body=%s)", err, string(raw))
	}
	if r.Error != nil {
		return fmt.Errorf("rpc %s: %d %s", method, r.Error.Code, r.Error.Message)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(r.Result, out)
}

// BlockNumber returns the current chain head.
func (c *Client) BlockNumber(ctx context.Context) (int64, error) {
	var hex string
	if err := c.call(ctx, "eth_blockNumber", []any{}, &hex); err != nil {
		return 0, err
	}
	return parseHexInt(hex)
}

type Block struct {
	Number     int64
	Hash       []byte
	ParentHash []byte
	Time       time.Time
}

type rawBlock struct {
	Number     string `json:"number"`
	Hash       string `json:"hash"`
	ParentHash string `json:"parentHash"`
	Timestamp  string `json:"timestamp"`
}

func (c *Client) BlockByNumber(ctx context.Context, n int64) (*Block, error) {
	tag := "0x" + strconv.FormatInt(n, 16)
	var rb rawBlock
	if err := c.call(ctx, "eth_getBlockByNumber", []any{tag, false}, &rb); err != nil {
		return nil, err
	}
	if rb.Hash == "" {
		return nil, nil
	}
	num, _ := parseHexInt(rb.Number)
	ts, _ := parseHexInt(rb.Timestamp)
	return &Block{
		Number:     num,
		Hash:       hexBytes(rb.Hash),
		ParentHash: hexBytes(rb.ParentHash),
		Time:       time.Unix(ts, 0).UTC(),
	}, nil
}

type Log struct {
	Address  []byte
	Topics   [][]byte
	Data     []byte
	Height   int64
	TxHash   []byte
	LogIndex uint64
}

type rawLog struct {
	Address          string   `json:"address"`
	Topics           []string `json:"topics"`
	Data             string   `json:"data"`
	BlockNumber      string   `json:"blockNumber"`
	TransactionHash  string   `json:"transactionHash"`
	LogIndex         string   `json:"logIndex"`
	Removed          bool     `json:"removed"`
}

type FilterQuery struct {
	FromBlock int64
	ToBlock   int64
	Addresses []string // 0x-prefixed
	Topics    [][]string
}

func (c *Client) GetLogs(ctx context.Context, q FilterQuery) ([]Log, error) {
	body := map[string]any{
		"fromBlock": "0x" + strconv.FormatInt(q.FromBlock, 16),
		"toBlock":   "0x" + strconv.FormatInt(q.ToBlock, 16),
	}
	if len(q.Addresses) > 0 {
		body["address"] = q.Addresses
	}
	if len(q.Topics) > 0 {
		body["topics"] = q.Topics
	}
	var raws []rawLog
	if err := c.call(ctx, "eth_getLogs", []any{body}, &raws); err != nil {
		return nil, err
	}
	out := make([]Log, 0, len(raws))
	for _, r := range raws {
		if r.Removed {
			continue
		}
		bn, _ := parseHexInt(r.BlockNumber)
		li, _ := parseHexInt(r.LogIndex)
		topics := make([][]byte, len(r.Topics))
		for i, t := range r.Topics {
			topics[i] = hexBytes(t)
		}
		out = append(out, Log{
			Address:  hexBytes(r.Address),
			Topics:   topics,
			Data:     hexBytes(r.Data),
			Height:   bn,
			TxHash:   hexBytes(r.TransactionHash),
			LogIndex: uint64(li),
		})
	}
	return out, nil
}

// EthCall (read-only). Used to fetch token metadata + reserves on demand.
func (c *Client) EthCall(ctx context.Context, to string, data []byte, blockTag string) ([]byte, error) {
	if blockTag == "" {
		blockTag = "latest"
	}
	args := map[string]any{
		"to":   to,
		"data": "0x" + hex.EncodeToString(data),
	}
	var hexOut string
	if err := c.call(ctx, "eth_call", []any{args, blockTag}, &hexOut); err != nil {
		return nil, err
	}
	return hexBytes(hexOut), nil
}

func parseHexInt(s string) (int64, error) {
	s = strings.TrimPrefix(s, "0x")
	if s == "" {
		return 0, nil
	}
	v, err := strconv.ParseInt(s, 16, 64)
	return v, err
}

func hexBytes(s string) []byte {
	s = strings.TrimPrefix(s, "0x")
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b, _ := hex.DecodeString(s)
	return b
}
