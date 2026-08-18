// Package cosmosrunner indexes the EnergyChain native Cosmos modules into
// Postgres for the DEX. It combines two sources:
//
//   - REST entity snapshots (authoritative current state): denoms, RWA
//     tokens, order-book markets + open orders, offerings + subscriptions,
//     mincast markets, identity accounts/policies, assethub providers /
//     devices / readings / oracle topics. Pulled on a slow ticker.
//
//   - CometBFT per-height events (time-series + balance discovery): market
//     batch clears, order placement/cancellation, mincast trades, and the
//     stableusd / rwatoken / mincast supply+transfer events used to maintain
//     a holder-balance cache. Pulled every block.
//
// Cosmos blocks are final, so the cursor is a simple high-water height with
// no reorg rewind.
package cosmosrunner

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"energychain/dex/indexer/internal/config"
	"energychain/dex/indexer/internal/cosmos"
	"energychain/dex/indexer/internal/metrics"
	"energychain/dex/indexer/internal/pubsub"
	"energychain/dex/indexer/internal/storage"
)

const cursorStream = "cosmos"

type Runner struct {
	cfg   *config.Config
	pool  *pgxpool.Pool
	cl    *cosmos.Client
	pub   *pubsub.Publisher
	log   zerolog.Logger
}

func New(cfg *config.Config, store *storage.Store, log zerolog.Logger) *Runner {
	return &Runner{
		cfg:  cfg,
		pool: store.Pool(),
		cl:   cosmos.New(cfg.CosmosRPC, cfg.CosmosREST),
		pub:  pubsub.New(cfg.RedisAddr, cfg.RedisDB),
		log:  log.With().Str("indexer", "cosmos").Logger(),
	}
}

func (r *Runner) Run(ctx context.Context) error {
	// Initial snapshot so the UI has data before the first block tick.
	if err := r.snapshotAll(ctx); err != nil {
		r.log.Warn().Err(err).Msg("initial snapshot")
	}

	blockTk := time.NewTicker(2 * time.Second)
	defer blockTk.Stop()
	snapTk := time.NewTicker(r.cfg.CosmosSnapshotInterval)
	defer snapTk.Stop()

	r.log.Info().Str("rpc", r.cfg.CosmosRPC).Str("rest", r.cfg.CosmosREST).Msg("cosmos indexer started")
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-snapTk.C:
			if err := r.snapshotAll(ctx); err != nil {
				r.log.Warn().Err(err).Msg("snapshot")
			}
		case <-blockTk.C:
			if err := r.processBlocks(ctx); err != nil {
				r.log.Error().Err(err).Msg("process blocks")
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

func (r *Runner) cursor(ctx context.Context) (int64, error) {
	var h int64
	err := r.pool.QueryRow(ctx,
		`SELECT height FROM cosmos_cursor WHERE stream=$1`, cursorStream).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return h, err
}

// ---------------------------------------------------------------------------
// Block processing
// ---------------------------------------------------------------------------

func (r *Runner) processBlocks(ctx context.Context) error {
	head, err := r.cl.LatestHeight(ctx)
	if err != nil {
		return fmt.Errorf("latest height: %w", err)
	}
	metrics.ChainHead.Set(float64(head))

	cur, err := r.cursor(ctx)
	if err != nil {
		return err
	}
	from := cur + 1
	if cur == 0 && r.cfg.CosmosStartHeight > 0 {
		from = r.cfg.CosmosStartHeight
	}
	if from > head {
		return nil
	}
	to := from + int64(r.cfg.CosmosBatchSize) - 1
	if to > head {
		to = head
	}

	for h := from; h <= to; h++ {
		br, err := r.cl.BlockResults(ctx, h)
		if err != nil {
			return fmt.Errorf("block %d: %w", h, err)
		}
		if err := r.applyBlock(ctx, br); err != nil {
			return fmt.Errorf("apply %d: %w", h, err)
		}
		metrics.LastBlockTime.Set(float64(br.Time.Unix()))
	}
	metrics.CosmosHeight.Set(float64(to))
	return nil
}

func (r *Runner) applyBlock(ctx context.Context, br *cosmos.BlockResults) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Transaction events carry a tx hash; finalize-block events (EndBlocker)
	// do not. Both are dispatched through the same handler.
	for _, te := range br.TxEvents {
		if te.Code != 0 {
			continue // failed tx: state not committed, skip its events
		}
		for _, ev := range te.Events {
			if err := r.handle(ctx, tx, ev, br, te.TxHash); err != nil {
				return err
			}
		}
	}
	for _, ev := range br.FinalizeBlock {
		if err := r.handle(ctx, tx, ev, br, ""); err != nil {
			return err
		}
	}

	if err := txSaveCursor(ctx, tx, br.Height); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func txSaveCursor(ctx context.Context, tx pgx.Tx, h int64) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO cosmos_cursor (stream, height, updated_at)
		VALUES ($1,$2, now())
		ON CONFLICT (stream) DO UPDATE SET height=EXCLUDED.height, updated_at=now()`,
		cursorStream, h)
	return err
}

// handle dispatches one decoded event.
func (r *Runner) handle(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults, txHash string) error {
	switch ev.Type {
	// ---- market (order book) -------------------------------------------
	case "market_clear":
		return r.onMarketClear(ctx, tx, ev, br)
	case "market_order":
		return r.onMarketOrder(ctx, tx, ev, br, txHash)

	// ---- mincast (bonding curve) ---------------------------------------
	case "mincast_trade":
		return r.onMincastTrade(ctx, tx, ev, br, txHash)
	case "mincast_transfer":
		return r.adjustMincastTransfer(ctx, tx, ev)
	case "mincast_invest":
		return r.onMincastInvest(ctx, tx, ev)

	// ---- stableusd ------------------------------------------------------
	case "stableusd_supply":
		return r.onStableSupply(ctx, tx, ev)
	case "stableusd_transfer":
		return r.onStableTransfer(ctx, tx, ev)
	case "stableusd_compliance":
		return r.onStableCompliance(ctx, tx, ev)
	case "stableusd_redemption":
		return r.onStableRedemption(ctx, tx, ev, br)

	// ---- rwatoken -------------------------------------------------------
	case "rwatoken_supply":
		return r.onRwaSupply(ctx, tx, ev)
	case "rwatoken_transfer":
		return r.onRwaTransfer(ctx, tx, ev)
	case "rwatoken_compliance":
		return r.onRwaCompliance(ctx, tx, ev)
	case "rwatoken_snapshot":
		return r.onRwaSnapshot(ctx, tx, ev)
	case "rwatoken_distribution":
		return r.onRwaDistribution(ctx, tx, ev, br)
	case "rwatoken_redemption":
		return r.onRwaRedemption(ctx, tx, ev, br)

	// ---- offering -------------------------------------------------------
	case "offering_subscription":
		return r.onOfferingSubscription(ctx, tx, ev)
	case "offering_return":
		return r.onOfferingReturn(ctx, tx, ev)
	case "offering_refund":
		return r.onOfferingRefund(ctx, tx, ev)
	case "offering_tranche":
		return r.onOfferingTranche(ctx, tx, ev)
	}
	return nil
}
