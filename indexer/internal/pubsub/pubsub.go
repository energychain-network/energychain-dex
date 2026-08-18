package pubsub

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"
)

// Channel naming. Keep them stable; the API and SDK both subscribe.
const (
	ChPairs       = "dex:pairs"           // new pair created or reserves changed
	ChSwaps       = "dex:swaps"           // every swap (firehose)
	ChLiquidity   = "dex:liquidity"       // mint/burn events
	ChCandlesAll  = "dex:candles"         // all candles, JSON includes pair+granularity

	// Native Cosmos module streams.
	ChOrders      = "dex:orders"          // market order place/cancel
	ChClears      = "dex:clears"          // market batch clearing prints
	ChTrades      = "dex:trades"          // mincast mint/melt trades
	ChIssuance    = "dex:issuance"        // stableusd/rwatoken/offering issuance
	ChRedemptions = "dex:redemptions"     // stableusd/rwatoken redemptions
)

type Publisher struct {
	r *redis.Client
}

func New(addr string, db int) *Publisher {
	return &Publisher{r: redis.NewClient(&redis.Options{Addr: addr, DB: db})}
}

func (p *Publisher) Publish(ctx context.Context, channel string, payload any) {
	if p == nil || p.r == nil {
		return
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = p.r.Publish(ctx, channel, b).Err()
}

func (p *Publisher) Close() error {
	if p == nil || p.r == nil {
		return nil
	}
	return p.r.Close()
}

func (p *Publisher) Client() *redis.Client { return p.r }
