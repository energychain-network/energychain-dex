package aggregator

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RefreshPairRollups recomputes 24h volume / TVL / fees per pair. Called once
// every minute by the runner — cheap because the aggregations operate on the
// recent hypertable chunks only.
func RefreshPairRollups(ctx context.Context, pool *pgxpool.Pool, chainID int) error {
	_, err := pool.Exec(ctx, `
		WITH win AS (
			SELECT pair,
			       SUM(amount_usd) AS vol_usd,
			       COUNT(*)        AS trades
			  FROM swaps
			 WHERE chain_id = $1
			   AND block_time > NOW() - INTERVAL '24 hours'
			 GROUP BY pair
		)
		UPDATE pairs p
		   SET volume_usd_24h = COALESCE(w.vol_usd, 0),
		       fees_usd_24h   = COALESCE(w.vol_usd, 0) * (p.fee_bps::numeric / 10000),
		       apr_24h = CASE WHEN p.tvl_usd > 0
		                      THEN COALESCE(w.vol_usd, 0) * (p.fee_bps::numeric / 10000) * 365 / p.tvl_usd * 100
		                      ELSE 0
		                 END
		  FROM win w
		 WHERE w.pair = p.address
		   AND p.chain_id = $1`,
		chainID)
	return err
}

// RefreshTokenStats fills token_stats for the most recent day. Token stats are
// derived purely from already-stored swaps + reserves, so this runs in the
// indexer to keep the API stateless.
func RefreshTokenStats(ctx context.Context, pool *pgxpool.Pool, chainID int) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO token_stats (chain_id, token, bucket, volume_usd, trades, unique_traders)
		SELECT $1,
		       t.token,
		       date_trunc('day', NOW())::date,
		       SUM(t.vol_usd),
		       SUM(t.trades),
		       COUNT(DISTINCT t.sender)
		  FROM (
			SELECT s.sender, p.token0 AS token,
			       SUM(s.amount_usd) AS vol_usd,
			       COUNT(*)          AS trades
			  FROM swaps s JOIN pairs p ON p.address = s.pair AND p.chain_id = s.chain_id
			 WHERE s.chain_id = $1 AND s.block_time >= date_trunc('day', NOW())
			 GROUP BY s.sender, p.token0
			UNION ALL
			SELECT s.sender, p.token1,
			       SUM(s.amount_usd),
			       COUNT(*)
			  FROM swaps s JOIN pairs p ON p.address = s.pair AND p.chain_id = s.chain_id
			 WHERE s.chain_id = $1 AND s.block_time >= date_trunc('day', NOW())
			 GROUP BY s.sender, p.token1
		  ) t
		 GROUP BY t.token
		ON CONFLICT (chain_id, token, bucket)
		DO UPDATE SET
			volume_usd = EXCLUDED.volume_usd,
			trades     = EXCLUDED.trades,
			unique_traders = EXCLUDED.unique_traders`,
		chainID)
	return err
}
