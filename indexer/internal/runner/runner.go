package runner

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"energychain/dex/indexer/internal/aggregator"
	"energychain/dex/indexer/internal/config"
	"energychain/dex/indexer/internal/evm"
	"energychain/dex/indexer/internal/metrics"
	"energychain/dex/indexer/internal/pricing"
	"energychain/dex/indexer/internal/pubsub"
	"energychain/dex/indexer/internal/storage"
)

type Runner struct {
	cfg     *config.Config
	store   *storage.Store
	rpc     *evm.Client
	pub     *pubsub.Publisher
	pricer  *pricing.Pricer
	log     zerolog.Logger

	// Cached set of known pair addresses + token0/token1 + decimals so we can
	// process events with no extra round-trips.
	mu          sync.RWMutex
	pairs       map[string]*pairInfo // hex-lower -> info
	tokenDec    map[string]uint8     // hex-lower -> decimals
}

type pairInfo struct {
	address  []byte
	token0   []byte
	token1   []byte
	dec0     uint8
	dec1     uint8
}

func New(cfg *config.Config, store *storage.Store, log zerolog.Logger) *Runner {
	r := &Runner{
		cfg:      cfg,
		store:    store,
		rpc:      evm.New(cfg.EvmRPC),
		pub:      pubsub.New(cfg.RedisAddr, cfg.RedisDB),
		log:      log,
		pairs:    map[string]*pairInfo{},
		tokenDec: map[string]uint8{},
	}
	r.pricer = pricing.New(store.Pool(), cfg.ChainID, cfg.WECY, cfg.USDTAnchor, cfg.StableTokens, cfg.PriceTWAPDeviationBps)
	return r
}

// isVerifiedAddress reports whether the given 0x-prefixed lowercase address
// is in the operator's curated trust list.
func (r *Runner) isVerifiedAddress(addrHexLower string) bool {
	for _, v := range r.cfg.VerifiedTokens {
		if v == addrHexLower {
			return true
		}
	}
	return false
}

// applyTrustList promotes every operator-curated address to trust_score>=2
// even if the token was first seen before the verified list was configured.
// Idempotent; safe to call repeatedly.
func (r *Runner) applyTrustList(ctx context.Context) {
	if len(r.cfg.VerifiedTokens) == 0 {
		return
	}
	addrs := make([][]byte, 0, len(r.cfg.VerifiedTokens))
	for _, h := range r.cfg.VerifiedTokens {
		addrs = append(addrs, addrBytes(h))
	}
	if _, err := r.store.Pool().Exec(ctx, `
		UPDATE tokens SET trust_score = GREATEST(trust_score, 2)
		 WHERE chain_id=$1 AND address = ANY($2)`, r.cfg.ChainID, addrs); err != nil {
		r.log.Warn().Err(err).Msg("apply trust list")
	}
	if r.cfg.LogoBaseURL != "" {
		// Backfill logos for tokens that don't yet have one.
		if _, err := r.store.Pool().Exec(ctx, `
			UPDATE tokens
			   SET logo_uri = $2 || '/' || ('0x' || encode(address, 'hex')) || '.png'
			 WHERE chain_id=$1 AND (logo_uri IS NULL OR logo_uri = '')`,
			r.cfg.ChainID, r.cfg.LogoBaseURL); err != nil {
			r.log.Warn().Err(err).Msg("backfill logos")
		}
	}
}

func (r *Runner) Run(ctx context.Context) error {
	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	r.applyTrustList(ctx)

	priceTk := time.NewTicker(60 * time.Second)
	defer priceTk.Stop()
	tk := time.NewTicker(r.cfg.TickInterval)
	defer tk.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-priceTk.C:
			if err := r.pricer.Refresh(ctx); err != nil {
				r.log.Warn().Err(err).Msg("pricer refresh")
			}
			if err := r.pricer.PersistTVL(ctx); err != nil {
				r.log.Warn().Err(err).Msg("persist tvl")
			}
			if err := aggregator.RefreshPairRollups(ctx, r.store.Pool(), r.cfg.ChainID); err != nil {
				r.log.Warn().Err(err).Msg("refresh rollups")
			}
			if err := aggregator.RefreshTokenStats(ctx, r.store.Pool(), r.cfg.ChainID); err != nil {
				r.log.Warn().Err(err).Msg("refresh token stats")
			}
			// Materialized view that powers /search; refreshing concurrently lets
			// readers keep hitting the prior snapshot during the refresh.
			if _, err := r.store.Pool().Exec(ctx,
				`REFRESH MATERIALIZED VIEW CONCURRENTLY search_index`); err != nil {
				// First run after migrations may not have a unique index → fallback
				// to a non-concurrent refresh, which always succeeds.
				_, _ = r.store.Pool().Exec(ctx, `REFRESH MATERIALIZED VIEW search_index`)
			}
		case <-tk.C:
			start := time.Now()
			if err := r.tick(ctx); err != nil {
				r.log.Error().Err(err).Msg("tick failed")
			}
			metrics.TickDuration.Observe(time.Since(start).Seconds())
		}
	}
}

// bootstrap loads existing pairs into the in-memory map and resolves the
// initial cursor. If the cursor is empty we backfill from the configured
// start height (0 = factory deploy block, which we discover via the
// PairCreated history).
func (r *Runner) bootstrap(ctx context.Context) error {
	rows, err := r.store.Pool().Query(ctx, `
		SELECT p.address, p.token0, p.token1, t0.decimals, t1.decimals
		  FROM pairs p
		  JOIN tokens t0 ON t0.chain_id = p.chain_id AND t0.address = p.token0
		  JOIN tokens t1 ON t1.chain_id = p.chain_id AND t1.address = p.token1
		 WHERE p.chain_id = $1`, r.cfg.ChainID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var p pairInfo
		var d0, d1 int16
		if err := rows.Scan(&p.address, &p.token0, &p.token1, &d0, &d1); err != nil {
			return err
		}
		p.dec0 = uint8(d0)
		p.dec1 = uint8(d1)
		key := hexLower(p.address)
		r.pairs[key] = &p
		r.tokenDec[hexLower(p.token0)] = p.dec0
		r.tokenDec[hexLower(p.token1)] = p.dec1
	}
	r.log.Info().Int("pairs", len(r.pairs)).Msg("bootstrap complete")
	metrics.Pairs.Set(float64(len(r.pairs)))
	return nil
}

// tick processes the next batch of blocks. Reorg-safe: the parent-hash of the
// first new block must match the stored cursor's hash, otherwise we rewind.
func (r *Runner) tick(ctx context.Context) error {
	head, err := r.rpc.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("block number: %w", err)
	}
	metrics.ChainHead.Set(float64(head))

	cursor, cursorHash, err := r.store.Cursor(ctx, "main")
	if err != nil {
		return err
	}
	from := cursor + 1
	if cursor == 0 {
		from = r.cfg.StartHeight
	}
	if from <= 0 {
		from = 1
	}
	tip := head - int64(r.cfg.Confirmations)
	if tip < from {
		return nil
	}
	to := from + int64(r.cfg.BatchSize) - 1
	if to > tip {
		to = tip
	}

	// Reorg check: parentHash of `from` must equal cursorHash (when we have one).
	if cursor > 0 && len(cursorHash) > 0 {
		first, err := r.rpc.BlockByNumber(ctx, from)
		if err != nil {
			return err
		}
		if first != nil && !bytes.Equal(first.ParentHash, cursorHash) {
			depth := r.rewind(ctx, cursor)
			metrics.ReorgDepth.Set(float64(depth))
			r.log.Warn().Int64("depth", depth).Msg("reorg detected, rewound")
			return nil
		}
	}
	metrics.ReorgDepth.Set(0)

	if err := r.processRange(ctx, from, to); err != nil {
		return err
	}

	// Save cursor as the last processed block.
	last, err := r.rpc.BlockByNumber(ctx, to)
	if err != nil {
		return err
	}
	if last == nil {
		return errors.New("missing tip block")
	}
	if err := r.store.SaveCursor(ctx, "main", to, last.Hash); err != nil {
		return err
	}
	metrics.ProcessedHeight.Set(float64(to))
	metrics.LastBlockTime.Set(float64(last.Time.Unix()))
	return nil
}

// rewind reverses every piece of state derived from blocks > rewindTarget.
// We:
//  1. delete swaps + liquidity_events rows above the target
//  2. delete OHLCV buckets that started after the target's block time
//     (any bucket containing the target block stays — it will be re-built
//     idempotently when the events replay because UpsertCandleAtPrice does
//     a SUM/UPDATE, not an INSERT)
//  3. re-snapshot pair reserves on-chain at the rewind block
//  4. for every (pair, owner) lp_position whose updated_height > rewind,
//     re-query balanceOf at the rewind block — this is correct even after
//     dozens of transfers because balanceOf is the canonical source of truth
//
// All of (1)-(4) run in one transaction so a crash mid-rewind cannot leave
// the DB in a partial state. Returns rewind depth (cursor - target).
func (r *Runner) rewind(ctx context.Context, cursor int64) int64 {
	rewindTo := cursor - int64(r.cfg.Confirmations) - 24
	if rewindTo < 0 {
		rewindTo = 0
	}
	pool := r.store.Pool()
	tx, err := pool.Begin(ctx)
	if err != nil {
		r.log.Error().Err(err).Msg("rewind begin tx")
		return 0
	}
	defer tx.Rollback(ctx)

	// (1) per-event rows
	if _, err := tx.Exec(ctx,
		`DELETE FROM swaps WHERE chain_id=$1 AND height > $2`, r.cfg.ChainID, rewindTo); err != nil {
		r.log.Error().Err(err).Msg("rewind swaps")
		return 0
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM liquidity_events WHERE chain_id=$1 AND height > $2`, r.cfg.ChainID, rewindTo); err != nil {
		r.log.Error().Err(err).Msg("rewind liquidity_events")
		return 0
	}

	// (2) OHLCV buckets: drop anything whose bucket-end is past the rewind
	// block timestamp. We get the rewind block's timestamp from the chain
	// (cheap — one call). Buckets that straddle the rewind block stay; the
	// idempotent UpsertCandleAtPrice will fix them up during replay.
	rewindBlock, err := r.rpc.BlockByNumber(ctx, rewindTo)
	if err != nil || rewindBlock == nil {
		r.log.Error().Err(err).Int64("h", rewindTo).Msg("rewind block fetch")
		return 0
	}
	rewindTs := rewindBlock.Time
	if _, err := tx.Exec(ctx,
		`DELETE FROM ohlcv WHERE chain_id=$1 AND ts > $2`,
		r.cfg.ChainID, rewindTs); err != nil {
		r.log.Error().Err(err).Msg("rewind ohlcv")
		return 0
	}

	// Token rollups will be refreshed by the periodic ticker; clearing the
	// time-bound 24h column ensures we don't show stale numbers in the gap.
	if _, err := tx.Exec(ctx,
		`UPDATE token_stats SET vol_24h_usd='0' WHERE chain_id=$1`, r.cfg.ChainID); err != nil {
		r.log.Warn().Err(err).Msg("rewind token_stats reset")
	}

	// (3) Re-snapshot reserves at rewindTo for every known pair so
	// pairs.reserve0/1 reflects the truth right at the rewind block.
	rewindTag := fmt.Sprintf("0x%x", rewindTo)
	r.mu.RLock()
	pairsSnap := make([]*pairInfo, 0, len(r.pairs))
	for _, p := range r.pairs {
		pairsSnap = append(pairsSnap, p)
	}
	r.mu.RUnlock()
	for _, p := range pairsSnap {
		r0, r1 := r.rpc.GetReservesAt(ctx, "0x"+hex.EncodeToString(p.address), rewindTag)
		if r0 == nil {
			continue
		}
		_, _ = tx.Exec(ctx,
			`UPDATE pairs SET reserve0=$3, reserve1=$4, last_sync_height=$5
			   WHERE chain_id=$1 AND address=$2`,
			r.cfg.ChainID, p.address, r0.String(), r1.String(), rewindTo)
	}

	// (4) lp_positions: every owner that received/sent LP after rewindTo
	// could be wrong. Re-query balanceOf on the LP token (the pair itself)
	// for each affected (pair, owner) and overwrite the stored balance.
	rows, err := tx.Query(ctx,
		`SELECT pair, owner FROM lp_positions
		  WHERE chain_id=$1 AND updated_height > $2`, r.cfg.ChainID, rewindTo)
	if err != nil {
		r.log.Warn().Err(err).Msg("rewind lp scan")
	} else {
		type po struct{ pair, owner []byte }
		var stale []po
		for rows.Next() {
			var pAddr, oAddr []byte
			if err := rows.Scan(&pAddr, &oAddr); err == nil {
				stale = append(stale, po{pAddr, oAddr})
			}
		}
		rows.Close()
		for _, x := range stale {
			bal := r.rpc.BalanceOfAt(ctx,
				"0x"+hex.EncodeToString(x.pair),
				"0x"+hex.EncodeToString(x.owner),
				rewindTag)
			_, _ = tx.Exec(ctx,
				`UPDATE lp_positions SET liquidity=$4, updated_height=$5
				   WHERE chain_id=$1 AND pair=$2 AND owner=$3`,
				r.cfg.ChainID, x.pair, x.owner, bal.String(), rewindTo)
		}
	}

	// (5) Move cursor back so the next tick re-applies events from rewindTo+1
	if err := r.store.SaveCursorTx(ctx, tx, "main", rewindTo, rewindBlock.Hash); err != nil {
		r.log.Error().Err(err).Msg("rewind save cursor")
		return 0
	}

	if err := tx.Commit(ctx); err != nil {
		r.log.Error().Err(err).Msg("rewind commit")
		return 0
	}
	return cursor - rewindTo
}

// processRange fetches all relevant logs in [from,to], sorts and applies them.
//
// We do two passes inside one transaction:
//
//  1. Factory PairCreated logs: this teaches us the addresses of any pair
//     contracts deployed in this range, so the next pass can include them.
//  2. All Sync/Swap/Mint/Burn/Transfer logs from every pair we know about
//     (including the ones discovered in pass 1).
//
// Without the two-pass design, the very first Mint/Sync/Swap on a brand-new
// pair created within the same batch would be silently dropped because the
// initial address filter wouldn't have included that pair's address yet.
func (r *Runner) processRange(ctx context.Context, from, to int64) error {
	tx, err := r.store.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	blockTimes := map[int64]time.Time{}
	getBlockTime := func(h int64) (time.Time, error) {
		if t, ok := blockTimes[h]; ok {
			return t, nil
		}
		b, err := r.rpc.BlockByNumber(ctx, h)
		if err != nil {
			return time.Time{}, err
		}
		if b == nil {
			return time.Time{}, fmt.Errorf("block %d missing", h)
		}
		blockTimes[h] = b.Time
		return b.Time, nil
	}

	// ----- Pass 1: PairCreated -----
	if r.cfg.Factory != "" {
		newPairs, err := r.rpc.GetLogs(ctx, evm.FilterQuery{
			FromBlock: from,
			ToBlock:   to,
			Addresses: []string{r.cfg.Factory},
			Topics:    [][]string{{"0x" + hex.EncodeToString(evm.TopicPairCreated)}},
		})
		if err != nil {
			return fmt.Errorf("getLogs paircreated %d-%d: %w", from, to, err)
		}
		sort.SliceStable(newPairs, func(i, j int) bool {
			if newPairs[i].Height != newPairs[j].Height {
				return newPairs[i].Height < newPairs[j].Height
			}
			return newPairs[i].LogIndex < newPairs[j].LogIndex
		})
		for _, l := range newPairs {
			bt, err := getBlockTime(l.Height)
			if err != nil {
				return err
			}
			if err := r.onPairCreated(ctx, tx, l, bt); err != nil {
				return err
			}
		}
	}

	// ----- Pass 2: pair-side events -----
	r.mu.RLock()
	addrs := make([]string, 0, len(r.pairs))
	for k := range r.pairs {
		addrs = append(addrs, "0x"+k)
	}
	r.mu.RUnlock()

	if len(addrs) > 0 {
		logs, err := r.rpc.GetLogs(ctx, evm.FilterQuery{
			FromBlock: from,
			ToBlock:   to,
			Addresses: addrs,
			Topics: [][]string{{
				"0x" + hex.EncodeToString(evm.TopicSync),
				"0x" + hex.EncodeToString(evm.TopicSwap),
				"0x" + hex.EncodeToString(evm.TopicMint),
				"0x" + hex.EncodeToString(evm.TopicBurn),
				"0x" + hex.EncodeToString(evm.TopicTransfer),
			}},
		})
		if err != nil {
			return fmt.Errorf("getLogs pair-events %d-%d: %w", from, to, err)
		}
		sort.SliceStable(logs, func(i, j int) bool {
			if logs[i].Height != logs[j].Height {
				return logs[i].Height < logs[j].Height
			}
			return logs[i].LogIndex < logs[j].LogIndex
		})
		for _, l := range logs {
			bt, err := getBlockTime(l.Height)
			if err != nil {
				return err
			}
			if err := r.dispatch(ctx, tx, l, bt); err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}

func (r *Runner) dispatch(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	if len(l.Topics) == 0 {
		return nil
	}
	switch {
	case bytes.Equal(l.Topics[0], evm.TopicPairCreated) && strings.EqualFold(addrHex(l.Address), r.cfg.Factory):
		return r.onPairCreated(ctx, tx, l, bt)
	case bytes.Equal(l.Topics[0], evm.TopicSync):
		return r.onSync(ctx, tx, l)
	case bytes.Equal(l.Topics[0], evm.TopicSwap):
		return r.onSwap(ctx, tx, l, bt)
	case bytes.Equal(l.Topics[0], evm.TopicMint):
		return r.onMint(ctx, tx, l, bt)
	case bytes.Equal(l.Topics[0], evm.TopicBurn):
		return r.onBurn(ctx, tx, l, bt)
	case bytes.Equal(l.Topics[0], evm.TopicTransfer):
		return r.onLPTransfer(ctx, tx, l, bt)
	}
	return nil
}

func (r *Runner) onPairCreated(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	ev := evm.DecodePairCreated(l)
	if ev == nil {
		return nil
	}
	// Ensure both tokens are catalogued.
	if err := r.upsertToken(ctx, tx, ev.Token0, l.Height); err != nil {
		return err
	}
	if err := r.upsertToken(ctx, tx, ev.Token1, l.Height); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO pairs (chain_id, address, factory, token0, token1, fee_bps,
		                   created_height, created_tx, created_at)
		VALUES ($1,$2,$3,$4,$5,30,$6,$7,$8)
		ON CONFLICT (chain_id, address) DO NOTHING`,
		r.cfg.ChainID, ev.Pair, addrBytes(r.cfg.Factory),
		ev.Token0, ev.Token1, l.Height, l.TxHash, bt); err != nil {
		return err
	}

	// Track in memory.
	r.mu.Lock()
	r.pairs[hexLower(ev.Pair)] = &pairInfo{
		address: ev.Pair, token0: ev.Token0, token1: ev.Token1,
		dec0: r.tokenDec[hexLower(ev.Token0)],
		dec1: r.tokenDec[hexLower(ev.Token1)],
	}
	r.mu.Unlock()
	metrics.Pairs.Set(float64(len(r.pairs)))
	r.pub.Publish(ctx, pubsub.ChPairs, map[string]any{
		"event":   "created",
		"pair":    "0x" + hex.EncodeToString(ev.Pair),
		"token0":  "0x" + hex.EncodeToString(ev.Token0),
		"token1":  "0x" + hex.EncodeToString(ev.Token1),
		"height":  l.Height,
	})
	return nil
}

func (r *Runner) upsertToken(ctx context.Context, tx pgx.Tx, addr []byte, height int64) error {
	r.mu.RLock()
	_, known := r.tokenDec[hexLower(addr)]
	r.mu.RUnlock()
	if known {
		return nil
	}
	meta, _ := r.rpc.FetchERC20(ctx, "0x"+hex.EncodeToString(addr))
	if meta == nil {
		meta = &evm.ERC20Meta{Decimals: 18, TotalSupply: new(big.Int)}
	}
	addrHexLower := "0x" + hex.EncodeToString(addr)
	wrapped := strings.EqualFold(addrHexLower, r.cfg.WECY)
	stable := r.cfg.USDTAnchor != "" && strings.EqualFold(addrHexLower, r.cfg.USDTAnchor)
	trust := 1
	if wrapped || stable || r.isVerifiedAddress(addrHexLower) {
		trust = 2
	}
	logo := ""
	if r.cfg.LogoBaseURL != "" {
		logo = r.cfg.LogoBaseURL + "/" + strings.ToLower(addrHexLower) + ".png"
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tokens (chain_id, address, symbol, name, decimals, total_supply,
		                    is_wrapped_native, is_stablecoin, trust_score, logo_uri,
		                    first_seen_height, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
		ON CONFLICT (chain_id, address) DO UPDATE SET
			symbol = EXCLUDED.symbol,
			name   = EXCLUDED.name,
			decimals = EXCLUDED.decimals,
			total_supply = EXCLUDED.total_supply,
			-- never downgrade trust; never blank an existing logo
			trust_score = GREATEST(tokens.trust_score, EXCLUDED.trust_score),
			logo_uri    = COALESCE(NULLIF(EXCLUDED.logo_uri, ''), tokens.logo_uri),
			updated_at = NOW()`,
		r.cfg.ChainID, addr, meta.Symbol, meta.Name, int(meta.Decimals),
		meta.TotalSupply.String(), wrapped, stable, trust, logo, height); err != nil {
		return err
	}
	r.mu.Lock()
	r.tokenDec[hexLower(addr)] = meta.Decimals
	r.mu.Unlock()
	return nil
}

func (r *Runner) onSync(ctx context.Context, tx pgx.Tx, l evm.Log) error {
	ev := evm.DecodeSync(l)
	if ev == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE pairs SET reserve0=$3, reserve1=$4, last_sync_height=$5
		 WHERE chain_id=$1 AND address=$2`,
		r.cfg.ChainID, l.Address, ev.Reserve0.String(), ev.Reserve1.String(), l.Height); err != nil {
		return err
	}
	// Publish a lightweight reserves update so dashboards can refresh TVL
	// without round-tripping the API. Sent best-effort outside the txn.
	r.pub.Publish(ctx, pubsub.ChPairs, map[string]any{
		"event":    "sync",
		"pair":     "0x" + hex.EncodeToString(l.Address),
		"reserve0": ev.Reserve0.String(),
		"reserve1": ev.Reserve1.String(),
		"height":   l.Height,
	})
	return nil
}

func (r *Runner) onSwap(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	ev := evm.DecodeSwap(l)
	if ev == nil {
		return nil
	}
	r.mu.RLock()
	info := r.pairs[hexLower(l.Address)]
	r.mu.RUnlock()
	if info == nil {
		return nil
	}

	side := 0 // 0 = buy token0 (token0 leaves the pair → user gets token0)
	out0 := new(big.Int).Set(ev.Amount0Out)
	out1 := new(big.Int).Set(ev.Amount1Out)
	if out1.Sign() > 0 && out0.Sign() == 0 {
		side = 1
	}

	price := computePrice(out0, out1, ev.Amount0In, ev.Amount1In, info.dec0, info.dec1)
	priceStr := price.Text('f', 18)

	vol0 := new(big.Int).Add(ev.Amount0In, ev.Amount0Out)
	vol1 := new(big.Int).Add(ev.Amount1In, ev.Amount1Out)
	volUSD := r.estimateUSDVolume(info, vol0, vol1)

	if _, err := tx.Exec(ctx, `
		INSERT INTO swaps (chain_id, pair, block_time, height, tx_hash, log_index,
		                   sender, recipient, amount0_in, amount1_in, amount0_out, amount1_out,
		                   side, price, amount_usd)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (chain_id, pair, block_time, log_index) DO NOTHING`,
		r.cfg.ChainID, l.Address, bt, l.Height, l.TxHash, l.LogIndex,
		ev.Sender, ev.To,
		ev.Amount0In.String(), ev.Amount1In.String(),
		ev.Amount0Out.String(), ev.Amount1Out.String(),
		side, priceStr, volUSD.Text('f', 8)); err != nil {
		return err
	}
	if err := aggregator.UpsertCandleAtPrice(ctx, tx, r.cfg.ChainID, l.Address, bt, price, vol0, vol1, volUSD); err != nil {
		return err
	}
	metrics.SwapsTotal.Inc()
	r.pub.Publish(ctx, pubsub.ChSwaps, map[string]any{
		"pair":        "0x" + hex.EncodeToString(l.Address),
		"tx":          "0x" + hex.EncodeToString(l.TxHash),
		"block_time":  bt.Unix(),
		"height":      l.Height,
		"sender":      "0x" + hex.EncodeToString(ev.Sender),
		"recipient":   "0x" + hex.EncodeToString(ev.To),
		"amount0_in":  ev.Amount0In.String(),
		"amount1_in":  ev.Amount1In.String(),
		"amount0_out": ev.Amount0Out.String(),
		"amount1_out": ev.Amount1Out.String(),
		"price":       priceStr,
		"side":        side,
		"amount_usd":  volUSD.Text('f', 8),
	})
	return nil
}

func computePrice(a0Out, a1Out, a0In, a1In *big.Int, d0, d1 uint8) *big.Float {
	// Price of token0 expressed in token1 = (token1 received) / (token0 sent).
	var num, denom *big.Int
	if a0Out.Sign() > 0 && a1In.Sign() > 0 {
		num = a1In
		denom = a0Out
	} else if a1Out.Sign() > 0 && a0In.Sign() > 0 {
		num = a1Out
		denom = a0In
	} else {
		return big.NewFloat(0)
	}
	n := new(big.Float).SetInt(num)
	d := new(big.Float).SetInt(denom)
	if d.Sign() == 0 {
		return big.NewFloat(0)
	}
	p := new(big.Float).Quo(n, d)
	// adjust decimals: result is in raw units; whole-unit price = raw * 10^(d0 - d1)
	return p.Mul(p, decPow10(int(d0)-int(d1)))
}

func (r *Runner) estimateUSDVolume(info *pairInfo, vol0, vol1 *big.Int) *big.Float {
	p0 := r.pricer.PriceUSD(info.token0)
	p1 := r.pricer.PriceUSD(info.token1)
	v0 := new(big.Float).SetInt(vol0)
	v0.Quo(v0, decPow10(int(info.dec0)))
	v1 := new(big.Float).SetInt(vol1)
	v1.Quo(v1, decPow10(int(info.dec1)))
	a := new(big.Float).Mul(v0, p0)
	b := new(big.Float).Mul(v1, p1)
	out := new(big.Float).Add(a, b)
	out.Quo(out, big.NewFloat(2)) // average the two sides
	return out
}

func (r *Runner) onMint(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	ev := evm.DecodeMint(l)
	if ev == nil {
		return nil
	}
	r.mu.RLock()
	info := r.pairs[hexLower(l.Address)]
	r.mu.RUnlock()
	if info == nil {
		return nil
	}
	usd := r.estimateUSDVolume(info, ev.Amount0, ev.Amount1)
	if _, err := tx.Exec(ctx, `
		INSERT INTO liquidity_events (chain_id, pair, block_time, height, tx_hash, log_index,
		                              kind, provider, amount0, amount1, liquidity, amount_usd)
		VALUES ($1,$2,$3,$4,$5,$6,'mint',$7,$8,$9,0,$10)
		ON CONFLICT (chain_id, pair, block_time, log_index) DO NOTHING`,
		r.cfg.ChainID, l.Address, bt, l.Height, l.TxHash, l.LogIndex,
		ev.Sender, ev.Amount0.String(), ev.Amount1.String(), usd.Text('f', 8)); err != nil {
		return err
	}
	metrics.LiquidityTotal.Inc()
	r.pub.Publish(ctx, pubsub.ChLiquidity, map[string]any{
		"kind":       "mint",
		"pair":       "0x" + hex.EncodeToString(l.Address),
		"tx":         "0x" + hex.EncodeToString(l.TxHash),
		"provider":   "0x" + hex.EncodeToString(ev.Sender),
		"amount0":    ev.Amount0.String(),
		"amount1":    ev.Amount1.String(),
		"amount_usd": usd.Text('f', 8),
		"block_time": bt.Unix(),
		"height":     l.Height,
	})
	return nil
}

func (r *Runner) onBurn(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	ev := evm.DecodeBurn(l)
	if ev == nil {
		return nil
	}
	r.mu.RLock()
	info := r.pairs[hexLower(l.Address)]
	r.mu.RUnlock()
	if info == nil {
		return nil
	}
	usd := r.estimateUSDVolume(info, ev.Amount0, ev.Amount1)
	if _, err := tx.Exec(ctx, `
		INSERT INTO liquidity_events (chain_id, pair, block_time, height, tx_hash, log_index,
		                              kind, provider, amount0, amount1, liquidity, amount_usd)
		VALUES ($1,$2,$3,$4,$5,$6,'burn',$7,$8,$9,0,$10)
		ON CONFLICT (chain_id, pair, block_time, log_index) DO NOTHING`,
		r.cfg.ChainID, l.Address, bt, l.Height, l.TxHash, l.LogIndex,
		ev.To, ev.Amount0.String(), ev.Amount1.String(), usd.Text('f', 8)); err != nil {
		return err
	}
	metrics.LiquidityTotal.Inc()
	r.pub.Publish(ctx, pubsub.ChLiquidity, map[string]any{
		"kind":       "burn",
		"pair":       "0x" + hex.EncodeToString(l.Address),
		"tx":         "0x" + hex.EncodeToString(l.TxHash),
		"provider":   "0x" + hex.EncodeToString(ev.To),
		"amount0":    ev.Amount0.String(),
		"amount1":    ev.Amount1.String(),
		"amount_usd": usd.Text('f', 8),
		"block_time": bt.Unix(),
		"height":     l.Height,
	})
	return nil
}

// onLPTransfer keeps lp_positions consistent with the LP-token Transfer events
// emitted by every Pair (which is itself an ERC20). Mint/Burn are special-cased
// upstream for accounting; here we update balances for free transfers.
func (r *Runner) onLPTransfer(ctx context.Context, tx pgx.Tx, l evm.Log, bt time.Time) error {
	r.mu.RLock()
	_, isPair := r.pairs[hexLower(l.Address)]
	r.mu.RUnlock()
	if !isPair {
		return nil
	}
	ev := evm.DecodeTransfer(l)
	if ev == nil {
		return nil
	}
	zero := make([]byte, 20)
	// Apply +amount to the recipient and -amount to the sender as separate
	// upserts. Storing the signed value in `liquidity` lets the ON CONFLICT
	// branch be a plain addition.
	apply := func(owner []byte, signed *big.Int) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO lp_positions (chain_id, pair, owner, liquidity, first_seen_height, updated_height)
			VALUES ($1,$2,$3,$4,$5,$5)
			ON CONFLICT (chain_id, pair, owner) DO UPDATE
			   SET liquidity = lp_positions.liquidity + EXCLUDED.liquidity,
			       updated_height = EXCLUDED.updated_height`,
			r.cfg.ChainID, l.Address, owner, signed.String(), l.Height)
		return err
	}
	if !bytes.Equal(ev.From, zero) {
		if err := apply(ev.From, new(big.Int).Neg(ev.Amount)); err != nil {
			return err
		}
	}
	if !bytes.Equal(ev.To, zero) {
		if err := apply(ev.To, new(big.Int).Set(ev.Amount)); err != nil {
			return err
		}
	}
	_ = bt
	return nil
}

// ---------------------------------------------------------------------------

func decPow10(n int) *big.Float {
	v := big.NewFloat(1)
	ten := big.NewFloat(10)
	abs := n
	if abs < 0 {
		abs = -abs
	}
	for i := 0; i < abs; i++ {
		v.Mul(v, ten)
	}
	if n < 0 {
		v.Quo(big.NewFloat(1), v)
	}
	return v
}

func hexLower(b []byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hex[c>>4]
		out[i*2+1] = hex[c&0x0f]
	}
	return string(out)
}

func addrHex(b []byte) string { return "0x" + hexLower(b) }

func addrBytes(s string) []byte {
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	out := make([]byte, len(s)/2)
	for i := 0; i < len(s)/2; i++ {
		var b byte
		for j := 0; j < 2; j++ {
			c := s[i*2+j]
			var v byte
			switch {
			case c >= '0' && c <= '9':
				v = c - '0'
			case c >= 'a' && c <= 'f':
				v = c - 'a' + 10
			}
			b = (b << 4) | v
		}
		out[i] = b
	}
	return out
}
