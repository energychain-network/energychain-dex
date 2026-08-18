package cosmosrunner

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"

	"energychain/dex/indexer/internal/metrics"
)

// snapshotAll refreshes every entity table from authoritative REST queries.
// Errors are logged per-section so one failing module does not block the rest.
func (r *Runner) snapshotAll(ctx context.Context) error {
	type step struct {
		name string
		fn   func(context.Context) error
	}
	steps := []step{
		{"denoms", r.snapDenoms},
		{"tokens", r.snapTokens},
		{"rwa_distributions", r.snapRwaDistributions},
		{"rwa_snapshot_balances", r.snapRwaSnapshotBalances},
		{"markets", r.snapMarkets},
		{"mincast", r.snapMincast},
		{"offerings", r.snapOfferings},
		{"identity", r.snapIdentity},
		{"assethub", r.snapAssethub},
	}
	for _, s := range steps {
		if err := s.fn(ctx); err != nil {
			metrics.CosmosSnapshotErrors.Inc()
			r.log.Warn().Err(err).Str("section", s.name).Msg("snapshot section")
		}
	}
	return nil
}

// pageLimit is the per-request page size for list queries.
const pageLimit = "500"

// ---------------------------------------------------------------------------
// stableusd
// ---------------------------------------------------------------------------

func (r *Runner) snapDenoms(ctx context.Context) error {
	key := ""
	for {
		var resp denomsResp
		if err := r.cl.Query(ctx, "energychain.stableusd.v1.Query/Denoms",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, d := range resp.Denoms {
			var supply supplyResp
			_ = r.cl.Query(ctx, "energychain.stableusd.v1.Query/Supply",
				map[string]any{"denom_id": d.Id}, &supply)
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO stable_denoms
				  (id, symbol, decimals, peg_currency, admin, minters, status, reserve_topic,
				   required_ratio_bps, max_staleness_seconds, policy_id, supply, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
				ON CONFLICT (id) DO UPDATE SET
				  symbol=EXCLUDED.symbol, decimals=EXCLUDED.decimals, peg_currency=EXCLUDED.peg_currency,
				  admin=EXCLUDED.admin, minters=EXCLUDED.minters, status=EXCLUDED.status,
				  reserve_topic=EXCLUDED.reserve_topic, required_ratio_bps=EXCLUDED.required_ratio_bps,
				  max_staleness_seconds=EXCLUDED.max_staleness_seconds, policy_id=EXCLUDED.policy_id,
				  supply=EXCLUDED.supply, updated_at=EXCLUDED.updated_at`,
				d.Id, d.Symbol, d.Decimals, d.PegCurrency, d.Admin, d.Minters, d.Status, d.ReserveTopic,
				d.RequiredRatioBps, int64(parseU(d.MaxStalenessSeconds)), d.PolicyId, num0(supply.Amount),
				int64(parseU(d.CreatedAt)), int64(parseU(d.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

// ---------------------------------------------------------------------------
// rwatoken
// ---------------------------------------------------------------------------

func (r *Runner) snapTokens(ctx context.Context) error {
	key := ""
	for {
		var resp tokensResp
		if err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Tokens",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, t := range resp.Tokens {
			var pool poolBalanceResp
			_ = r.cl.Query(ctx, "energychain.rwatoken.v1.Query/PoolBalance",
				map[string]any{"token_id": t.Id}, &pool)
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO rwa_tokens
				  (id, symbol, name, admin, asset_class, decimals, total_supply, status,
				   settlement_denom, policy_id, require_kyc, redemption_price, redemption_delay_seconds,
				   per_holder_cap, metadata_uri, pool_balance, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
				ON CONFLICT (id) DO UPDATE SET
				  symbol=EXCLUDED.symbol, name=EXCLUDED.name, admin=EXCLUDED.admin,
				  asset_class=EXCLUDED.asset_class, decimals=EXCLUDED.decimals,
				  total_supply=EXCLUDED.total_supply, status=EXCLUDED.status,
				  settlement_denom=EXCLUDED.settlement_denom, policy_id=EXCLUDED.policy_id,
				  require_kyc=EXCLUDED.require_kyc, redemption_price=EXCLUDED.redemption_price,
				  redemption_delay_seconds=EXCLUDED.redemption_delay_seconds,
				  per_holder_cap=EXCLUDED.per_holder_cap, metadata_uri=EXCLUDED.metadata_uri,
				  pool_balance=EXCLUDED.pool_balance, updated_at=EXCLUDED.updated_at`,
				parseU(t.Id), t.Symbol, t.Name, t.Admin, t.AssetClass, t.Decimals, num0(t.TotalSupply),
				t.Status, t.SettlementDenom, t.PolicyId, t.RequireKyc, num0(t.RedemptionPrice),
				int64(parseU(t.RedemptionDelaySeconds)), 				num0(t.PerHolderCap), t.MetadataUri,
				num0(pool.Amount), int64(parseU(t.CreatedAt)), int64(parseU(t.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

// snapRwaDistributions walks distribution IDs 1..N from chain REST and upserts
// them into the API table. Distribution IDs are a global sequence; we stop at
// the first gap after id 1 so a missing middle id doesn't truncate the walk.
// This keeps the Assets "分红" table in sync even when block events were
// pruned or the event indexer lagged.
func (r *Runner) snapRwaDistributions(ctx context.Context) error {
	const maxID = 5000
	found := 0
	for id := uint64(1); id <= maxID; id++ {
		var resp rwaDistributionRow
		if err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Distribution",
			map[string]any{"id": strconv.FormatUint(id, 10)}, &resp); err != nil || resp.Distribution.Id == "" {
			if found > 0 {
				return nil
			}
			continue
		}
		found++
		d := resp.Distribution
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO rwa_distributions (id, token_id, snapshot_id, denom, total_amount, claimed_amount, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (id) DO UPDATE SET
			  token_id=EXCLUDED.token_id, snapshot_id=EXCLUDED.snapshot_id, denom=EXCLUDED.denom,
			  total_amount=EXCLUDED.total_amount, claimed_amount=EXCLUDED.claimed_amount,
			  created_at=EXCLUDED.created_at`,
			parseU(d.Id), parseU(d.TokenId), parseU(d.SnapshotId), d.Denom,
			num0(d.TotalAmount), num0(d.ClaimedAmount), int64(parseU(d.CreatedAt))); err != nil {
			return err
		}
	}
	return nil
}

// snapRwaSnapshotBalances backfills per-holder snapshot rows when the event
// indexer missed TakeSnapshot. If a snapshot has no rows yet, copy the token's
// current mirrored balances (accurate when no transfers occurred after snapshot).
func (r *Runner) snapRwaSnapshotBalances(ctx context.Context) error {
	const maxID = 5000
	found := 0
	for id := uint64(1); id <= maxID; id++ {
		var resp rwaSnapshotRow
		if err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Snapshot",
			map[string]any{"id": strconv.FormatUint(id, 10)}, &resp); err != nil || resp.Snapshot.Id == "" {
			if found > 0 {
				return nil
			}
			continue
		}
		found++
		snapID := parseU(resp.Snapshot.Id)
		tokenID := parseU(resp.Snapshot.TokenId)
		var n int
		if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM rwa_snapshot_balances WHERE snapshot_id=$1`, snapID).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO rwa_snapshot_balances (snapshot_id, holder, amount)
			SELECT $1, holder, amount FROM rwa_balances
			 WHERE token_id=$2 AND amount::numeric > 0
			ON CONFLICT (snapshot_id, holder) DO NOTHING`, snapID, tokenID); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// market (order book) + open orders
// ---------------------------------------------------------------------------

func (r *Runner) snapMarkets(ctx context.Context) error {
	key := ""
	for {
		var resp marketsResp
		if err := r.cl.Query(ctx, "energychain.market.v1.Query/Markets",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, m := range resp.Markets {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO markets
				  (id, base_denom, quote_denom, status, fee_bps, min_base_qty, batch_interval,
				   last_batch_time, last_clearing_price, created_at, require_kyc, policy_id,
				   operator, bond_amount, bond_denom)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
				ON CONFLICT (id) DO UPDATE SET
				  base_denom=EXCLUDED.base_denom, quote_denom=EXCLUDED.quote_denom, status=EXCLUDED.status,
				  fee_bps=EXCLUDED.fee_bps, min_base_qty=EXCLUDED.min_base_qty,
				  batch_interval=EXCLUDED.batch_interval, last_batch_time=EXCLUDED.last_batch_time,
				  last_clearing_price=EXCLUDED.last_clearing_price, require_kyc=EXCLUDED.require_kyc,
				  policy_id=EXCLUDED.policy_id, operator=EXCLUDED.operator,
				  bond_amount=EXCLUDED.bond_amount, bond_denom=EXCLUDED.bond_denom`,
				parseU(m.Id), m.BaseDenom, m.QuoteDenom, m.Status, m.FeeBps, num0(m.MinBaseQty),
				int64(parseU(m.BatchInterval)), int64(parseU(m.LastBatchTime)), num0(m.LastClearingPrice),
				int64(parseU(m.CreatedAt)), m.RequireKyc, m.PolicyId,
				m.Operator, num0(m.BondAmount), m.BondDenom); err != nil {
				return err
			}
			if err := r.snapOrderBook(ctx, parseU(m.Id)); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

// snapOrderBook replaces the cached open orders for a market with the live
// book. Filled / cancelled orders simply drop out of the book.
func (r *Runner) snapOrderBook(ctx context.Context, marketID uint64) error {
	var ob orderBookResp
	if err := r.cl.Query(ctx, "energychain.market.v1.Query/OrderBook",
		map[string]any{"market_id": strconv.FormatUint(marketID, 10)}, &ob); err != nil {
		return err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Mark all currently-open cached orders for this market closed; the live
	// open ones below are re-upserted as OPEN.
	if _, err := tx.Exec(ctx,
		`UPDATE orders SET status='ORDER_STATUS_CLOSED' WHERE market_id=$1 AND status='ORDER_STATUS_OPEN'`,
		marketID); err != nil {
		return err
	}
	upsert := func(o order) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO orders (id, market_id, owner, side, price, quantity, filled, escrowed, status, created_at, seq)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			ON CONFLICT (id) DO UPDATE SET
			  filled=EXCLUDED.filled, escrowed=EXCLUDED.escrowed, status=EXCLUDED.status`,
			parseU(o.Id), marketID, o.Owner, o.Side, num0(o.Price), num0(o.Quantity),
			num0(o.Filled), num0(o.Escrowed), "ORDER_STATUS_OPEN", int64(parseU(o.CreatedAt)), int64(parseU(o.Seq)))
		return err
	}
	for _, o := range ob.Buys {
		if err := upsert(o); err != nil {
			return err
		}
	}
	for _, o := range ob.Sells {
		if err := upsert(o); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// mincast
// ---------------------------------------------------------------------------

func (r *Runner) snapMincast(ctx context.Context) error {
	key := ""
	for {
		var resp mincastMarketsResp
		if err := r.cl.Query(ctx, "energychain.mincast.v1.Query/Markets",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, m := range resp.Markets {
			var rp rewardPoolResp
			_ = r.cl.Query(ctx, "energychain.mincast.v1.Query/RewardPool",
				map[string]any{"market_id": m.Id}, &rp)
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO mincast_markets
				  (id, denom, name, admin, settlement_denom, treasury, supply, initial_price,
				   mint_fee_bps, melt_fee_bps, floor_price, status, policy_id, require_kyc,
				   reward_pool, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
				ON CONFLICT (id) DO UPDATE SET
				  denom=EXCLUDED.denom, name=EXCLUDED.name, admin=EXCLUDED.admin,
				  settlement_denom=EXCLUDED.settlement_denom, treasury=EXCLUDED.treasury,
				  supply=EXCLUDED.supply, initial_price=EXCLUDED.initial_price,
				  mint_fee_bps=EXCLUDED.mint_fee_bps, melt_fee_bps=EXCLUDED.melt_fee_bps,
				  floor_price=EXCLUDED.floor_price, status=EXCLUDED.status, policy_id=EXCLUDED.policy_id,
				  require_kyc=EXCLUDED.require_kyc, reward_pool=EXCLUDED.reward_pool,
				  updated_at=EXCLUDED.updated_at`,
				parseU(m.Id), m.Denom, m.Name, m.Admin, m.SettlementDenom, num0(m.Treasury), num0(m.Supply),
				num0(m.InitialPrice), m.MintFeeBps, m.MeltFeeBps, num0(m.FloorPrice), m.Status, m.PolicyId,
				m.RequireKyc, num0(rp.Balance), int64(parseU(m.CreatedAt)), int64(parseU(m.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

func upsertInvest(ctx context.Context, tx pgx.Tx, iv invest) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO mincast_invests
		  (id, market_id, investor, principal_units, yield, apy_bps, opened_at, maturity, status, resolved_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO UPDATE SET
		  status=EXCLUDED.status, yield=EXCLUDED.yield, resolved_at=EXCLUDED.resolved_at`,
		parseU(iv.Id), parseU(iv.MarketId), iv.Investor, num0(iv.PrincipalUnits), num0(iv.Yield),
		iv.ApyBps, int64(parseU(iv.OpenedAt)), int64(parseU(iv.Maturity)), iv.Status, int64(parseU(iv.ResolvedAt)))
	return err
}

// ---------------------------------------------------------------------------
// offering
// ---------------------------------------------------------------------------

func (r *Runner) snapOfferings(ctx context.Context) error {
	key := ""
	for {
		var resp offeringsResp
		if err := r.cl.Query(ctx, "energychain.offering.v1.Query/Offerings",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, o := range resp.Offerings {
			var tr treasuryResp
			_ = r.cl.Query(ctx, "energychain.offering.v1.Query/TreasuryBalance",
				map[string]any{"offering_id": o.Id}, &tr)
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO offerings
				  (id, token_id, issuer, denom, unit_price, soft_cap, hard_cap, raised, start_time, end_time,
				   status, total_tranches, released_tranches, released_amount, injections_done, injected_total,
				   required_injection, injection_interval, allocated_units, default_treasury, treasury,
				   returns_pool, succeeded_at, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
				ON CONFLICT (id) DO UPDATE SET
				  status=EXCLUDED.status, raised=EXCLUDED.raised, released_tranches=EXCLUDED.released_tranches,
				  released_amount=EXCLUDED.released_amount, injections_done=EXCLUDED.injections_done,
				  injected_total=EXCLUDED.injected_total, allocated_units=EXCLUDED.allocated_units,
				  default_treasury=EXCLUDED.default_treasury, treasury=EXCLUDED.treasury,
				  returns_pool=EXCLUDED.returns_pool, succeeded_at=EXCLUDED.succeeded_at,
				  updated_at=EXCLUDED.updated_at`,
				parseU(o.Id), parseU(o.TokenId), o.Issuer, o.Denom, num0(o.UnitPrice), num0(o.SoftCap),
				num0(o.HardCap), num0(o.Raised), int64(parseU(o.StartTime)), int64(parseU(o.EndTime)),
				o.Status, o.TotalTranches, o.ReleasedTranches, num0(o.ReleasedAmount), o.InjectionsDone,
				num0(o.InjectedTotal), num0(o.RequiredInjection), int64(parseU(o.InjectionInterval)),
				num0(o.AllocatedUnits), num0(o.DefaultTreasury), num0(tr.Treasury), num0(tr.ReturnsPool),
				int64(parseU(o.SucceededAt)), int64(parseU(o.CreatedAt)), int64(parseU(o.UpdatedAt))); err != nil {
				return err
			}
			if err := r.snapSubscriptions(ctx, parseU(o.Id)); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

func (r *Runner) snapSubscriptions(ctx context.Context, offeringID uint64) error {
	key := ""
	for {
		var resp subscriptionsResp
		if err := r.cl.Query(ctx, "energychain.offering.v1.Query/SubscriptionsByOffering",
			map[string]any{"offering_id": strconv.FormatUint(offeringID, 10),
				"pagination": map[string]any{"key": key, "limit": pageLimit}}, &resp); err != nil {
			return err
		}
		for _, s := range resp.Subscriptions {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO offering_subscriptions
				  (offering_id, investor, contributed, units, allocated, returns_claimed, refunded)
				VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (offering_id, investor) DO UPDATE SET
				  contributed=EXCLUDED.contributed, units=EXCLUDED.units, allocated=EXCLUDED.allocated,
				  returns_claimed=EXCLUDED.returns_claimed, refunded=EXCLUDED.refunded`,
				offeringID, s.Investor, num0(s.Contributed), num0(s.Units), s.Allocated,
				num0(s.ReturnsClaimed), s.Refunded); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

func (r *Runner) snapIdentity(ctx context.Context) error {
	key := ""
	for {
		var resp accountsResp
		if err := r.cl.Query(ctx, "energychain.identity.v1.Query/Accounts",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, a := range resp.Accounts {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO identity_accounts
				  (address, did, kyc_cleared, accredited, jurisdiction, kyc_expires_at, status, registrar, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
				ON CONFLICT (address) DO UPDATE SET
				  did=EXCLUDED.did, kyc_cleared=EXCLUDED.kyc_cleared, accredited=EXCLUDED.accredited,
				  jurisdiction=EXCLUDED.jurisdiction, kyc_expires_at=EXCLUDED.kyc_expires_at,
				  status=EXCLUDED.status, registrar=EXCLUDED.registrar, updated_at=EXCLUDED.updated_at`,
				a.Address, a.Did, a.KycCleared, a.Accredited, a.Jurisdiction, int64(parseU(a.KycExpiresAt)),
				a.Status, a.Registrar, int64(parseU(a.CreatedAt)), int64(parseU(a.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			break
		}
		key = resp.Pagination.NextKey
	}
	// Policies.
	key = ""
	for {
		var resp policiesResp
		if err := r.cl.Query(ctx, "energychain.identity.v1.Query/Policies",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, p := range resp.Policies {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO identity_policies
				  (id, description, require_kyc, require_accredited, deny_frozen, allowed_jurisdictions,
				   denied_jurisdictions, paused, owner, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
				ON CONFLICT (id) DO UPDATE SET
				  description=EXCLUDED.description, require_kyc=EXCLUDED.require_kyc,
				  require_accredited=EXCLUDED.require_accredited, deny_frozen=EXCLUDED.deny_frozen,
				  allowed_jurisdictions=EXCLUDED.allowed_jurisdictions,
				  denied_jurisdictions=EXCLUDED.denied_jurisdictions, paused=EXCLUDED.paused,
				  owner=EXCLUDED.owner, updated_at=EXCLUDED.updated_at`,
				p.Id, p.Description, p.RequireKyc, p.RequireAccredited, p.DenyFrozen,
				p.AllowedJurisdictions, p.DeniedJurisdictions, p.Paused, p.Owner,
				int64(parseU(p.CreatedAt)), int64(parseU(p.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

// ---------------------------------------------------------------------------
// assethub
// ---------------------------------------------------------------------------

func (r *Runner) snapAssethub(ctx context.Context) error {
	// Providers.
	key := ""
	for {
		var resp providersResp
		if err := r.cl.Query(ctx, "energychain.assethub.v1.Query/Providers",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, p := range resp.Providers {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO assethub_providers
				  (address, role, display_name, bond, status, infractions, jailed_until, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				ON CONFLICT (address) DO UPDATE SET
				  role=EXCLUDED.role, display_name=EXCLUDED.display_name, bond=EXCLUDED.bond,
				  status=EXCLUDED.status, infractions=EXCLUDED.infractions, jailed_until=EXCLUDED.jailed_until,
				  updated_at=EXCLUDED.updated_at`,
				p.Address, p.Role, p.DisplayName, num0(p.Bond), p.Status, p.Infractions,
				int64(parseU(p.JailedUntil)), int64(parseU(p.CreatedAt)), int64(parseU(p.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			break
		}
		key = resp.Pagination.NextKey
	}
	// Devices + their latest readings.
	key = ""
	for {
		var resp devicesResp
		if err := r.cl.Query(ctx, "energychain.assethub.v1.Query/Devices",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, d := range resp.Devices {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO assethub_devices
				  (id, operator, device_type, pubkey, jurisdiction, attestation_hash, firmware, status, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
				ON CONFLICT (id) DO UPDATE SET
				  operator=EXCLUDED.operator, device_type=EXCLUDED.device_type, pubkey=EXCLUDED.pubkey,
				  jurisdiction=EXCLUDED.jurisdiction, attestation_hash=EXCLUDED.attestation_hash,
				  firmware=EXCLUDED.firmware, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
				d.Id, d.Operator, d.DeviceType, d.Pubkey, d.Jurisdiction, d.AttestationHash, d.Firmware,
				d.Status, int64(parseU(d.CreatedAt)), int64(parseU(d.UpdatedAt))); err != nil {
				return err
			}
			if err := r.snapReadings(ctx, d.Id); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			break
		}
		key = resp.Pagination.NextKey
	}
	// Oracle topics.
	key = ""
	for {
		var resp topicsResp
		if err := r.cl.Query(ctx, "energychain.assethub.v1.Query/Topics",
			pageReq{pageReqInner{Key: key, Limit: pageLimit}}, &resp); err != nil {
			return err
		}
		for _, t := range resp.Topics {
			if _, err := r.pool.Exec(ctx, `
				INSERT INTO assethub_topics
				  (id, description, min_sources, value, source_count, has_value, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (id) DO UPDATE SET
				  description=EXCLUDED.description, min_sources=EXCLUDED.min_sources, value=EXCLUDED.value,
				  source_count=EXCLUDED.source_count, has_value=EXCLUDED.has_value, updated_at=EXCLUDED.updated_at`,
				t.Id, t.Description, t.MinSources, num0(t.Value), t.SourceCount, t.HasValue,
				int64(parseU(t.UpdatedAt))); err != nil {
				return err
			}
		}
		if resp.Pagination.NextKey == "" {
			return nil
		}
		key = resp.Pagination.NextKey
	}
}

func (r *Runner) snapReadings(ctx context.Context, deviceID string) error {
	var resp readingsResp
	if err := r.cl.Query(ctx, "energychain.assethub.v1.Query/ReadingsByDevice",
		map[string]any{"device_id": deviceID, "pagination": map[string]any{"limit": "50"}}, &resp); err != nil {
		return err
	}
	for _, rd := range resp.Readings {
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO assethub_readings
			  (id, device_id, period_start, period_end, unit, iot_value, operational_value, verified, submitted_by, submitted_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (id) DO UPDATE SET
			  iot_value=EXCLUDED.iot_value, operational_value=EXCLUDED.operational_value, verified=EXCLUDED.verified`,
			parseU(rd.Id), rd.DeviceId, int64(parseU(rd.PeriodStart)), int64(parseU(rd.PeriodEnd)), rd.Unit,
			num0(rd.IotValue), num0(rd.OperationalValue), rd.Verified, rd.SubmittedBy,
			int64(parseU(rd.SubmittedAt))); err != nil {
			return err
		}
	}
	return nil
}
