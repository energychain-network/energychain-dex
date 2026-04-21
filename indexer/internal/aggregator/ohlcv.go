package aggregator

import (
	"context"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// Granularity bucketing. We materialize 1m candles synchronously on each swap;
// coarser buckets are derived in a background sweep.
type bucketSpec struct {
	name string
	d    time.Duration
}

var Buckets = []bucketSpec{
	{"1m", time.Minute},
	{"5m", 5 * time.Minute},
	{"15m", 15 * time.Minute},
	{"1h", time.Hour},
	{"4h", 4 * time.Hour},
	{"1d", 24 * time.Hour},
	{"1w", 7 * 24 * time.Hour},
}

// Floor truncates t to the spec interval. We treat "1w" as ISO week starting
// Monday in UTC for stability across deployments.
func (b bucketSpec) Floor(t time.Time) time.Time {
	t = t.UTC()
	if b.name == "1w" {
		offset := (int(t.Weekday()) + 6) % 7 // Monday = 0
		base := time.Date(t.Year(), t.Month(), t.Day()-offset, 0, 0, 0, 0, time.UTC)
		return base
	}
	if b.name == "1d" {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	return t.Truncate(b.d)
}

// UpsertCandleAtPrice merges a single trade (price, volume) into all relevant
// candle buckets. This runs inside the swap insertion transaction so the
// candle and the swap row commit atomically.
func UpsertCandleAtPrice(ctx context.Context, tx pgx.Tx, chainID int, pair []byte, t time.Time, price *big.Float, vol0, vol1 *big.Int, volUSD *big.Float) error {
	priceStr := bigFloatStr(price, 18)
	vol0Str := vol0.String()
	vol1Str := vol1.String()
	volUSDStr := bigFloatStr(volUSD, 8)

	for _, b := range Buckets {
		bucket := b.Floor(t)
		if _, err := tx.Exec(ctx, `
			INSERT INTO ohlcv (chain_id, pair, granularity, bucket, open, high, low, close, volume0, volume1, volume_usd, trades)
			VALUES ($1,$2,$3,$4,$5,$5,$5,$5,$6,$7,$8,1)
			ON CONFLICT (chain_id, pair, granularity, bucket)
			DO UPDATE SET
				high       = GREATEST(ohlcv.high, EXCLUDED.high),
				low        = LEAST(ohlcv.low, EXCLUDED.low),
				close      = EXCLUDED.close,
				volume0    = (ohlcv.volume0::numeric + EXCLUDED.volume0::numeric),
				volume1    = (ohlcv.volume1::numeric + EXCLUDED.volume1::numeric),
				volume_usd = (ohlcv.volume_usd + EXCLUDED.volume_usd),
				trades     = ohlcv.trades + 1`,
			chainID, pair, b.name, bucket, priceStr, vol0Str, vol1Str, volUSDStr); err != nil {
			return err
		}
	}
	return nil
}

// bigFloatStr formats a big.Float to a decimal string with `prec` digits after
// the dot — enough precision for NUMERIC(38, prec) without scientific notation.
func bigFloatStr(f *big.Float, prec int) string {
	if f == nil {
		return "0"
	}
	return f.Text('f', prec)
}
