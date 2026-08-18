package cosmosrunner

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"energychain/dex/indexer/internal/cosmos"
	"energychain/dex/indexer/internal/metrics"
	"energychain/dex/indexer/internal/pubsub"
)

// rwaBasePrefix marks a market whose base asset is an x/rwatoken security token
// ("rwa/<tokenID>"); the quote leg is always a stableusd denom.
const rwaBasePrefix = "rwa/"

// parseRWABase returns the token id when a market's base_denom is an RWA token.
func parseRWABase(denom string) (uint64, bool) {
	if !strings.HasPrefix(denom, rwaBasePrefix) {
		return 0, false
	}
	id, err := strconv.ParseUint(strings.TrimPrefix(denom, rwaBasePrefix), 10, 64)
	if err != nil || id == 0 {
		return 0, false
	}
	return id, true
}

// num returns a decimal-string event attribute, defaulting to "0" so it can be
// passed straight into a NUMERIC column.
func num(ev cosmos.Event, key string) string {
	if v, ok := ev.Attrs[key]; ok && v != "" {
		return v
	}
	return "0"
}

func u64(ev cosmos.Event, key string) uint64 {
	n, _ := strconv.ParseUint(ev.Attrs[key], 10, 64)
	return n
}

// ===========================================================================
// market (order book)
// ===========================================================================

// onMarketClear records one uniform-price batch print. Emitted by the market
// EndBlocker (finalize-block events, no tx hash).
func (r *Runner) onMarketClear(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults) error {
	marketID := u64(ev, "market_id")
	price := num(ev, "price")
	qty := num(ev, "qty")
	if _, err := tx.Exec(ctx, `
		INSERT INTO market_clears (market_id, height, block_time, price, qty)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (market_id, height) DO UPDATE
		   SET price=EXCLUDED.price, qty=EXCLUDED.qty, block_time=EXCLUDED.block_time`,
		marketID, br.Height, br.Time, price, qty); err != nil {
		return err
	}
	// Keep the market's last clearing price fresh between snapshots.
	_, _ = tx.Exec(ctx, `
		UPDATE markets SET last_clearing_price=$2, last_batch_time=$3 WHERE id=$1`,
		marketID, price, br.Time.Unix())
	metrics.CosmosClearsTotal.Inc()
	r.pub.Publish(ctx, pubsub.ChClears, map[string]any{
		"market_id":  marketID,
		"price":      price,
		"qty":        qty,
		"height":     br.Height,
		"block_time": br.Time.Unix(),
	})
	return nil
}

// onMarketOrder records placement / cancellation into the activity feed.
func (r *Runner) onMarketOrder(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults, txHash string) error {
	action := ev.Attrs["action"]
	marketID := u64(ev, "market_id")
	orderID := u64(ev, "order_id")
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (market_id, order_id, owner, action, side, price, qty, refunded, height, tx_hash, block_time)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (market_id, order_id, action, height) DO NOTHING`,
		marketID, orderID, ev.Attrs["owner"], action, ev.Attrs["side"],
		num(ev, "price"), num(ev, "qty"), num(ev, "refunded"),
		br.Height, txHash, br.Time); err != nil {
		return err
	}
	r.pub.Publish(ctx, pubsub.ChOrders, map[string]any{
		"market_id":  marketID,
		"order_id":   orderID,
		"action":     action,
		"owner":      ev.Attrs["owner"],
		"side":       ev.Attrs["side"],
		"price":      num(ev, "price"),
		"qty":        num(ev, "qty"),
		"height":     br.Height,
		"block_time": br.Time.Unix(),
	})
	// Order escrow and batch fills move base/quote through the stableusd /
	// rwatoken ledgers without emitting their own balance events, so the
	// owner's mirrored balances drift on every place/cancel/void/fill. Re-sync
	// them from chain truth (the periodic snapshot is the eventual safety net).
	return r.refreshMarketParticipant(ctx, tx, marketID, ev.Attrs["owner"])
}

// refreshMarketParticipant re-syncs an account's base and quote balances for a
// market from authoritative chain state. The quote leg is always a stableusd
// denom; the base leg is an rwatoken unit balance for an RWA market, or a
// stableusd denom for a stable/stable market.
func (r *Runner) refreshMarketParticipant(ctx context.Context, tx pgx.Tx, marketID uint64, owner string) error {
	if owner == "" {
		return nil
	}
	var base, quote string
	if err := tx.QueryRow(ctx, `SELECT base_denom, quote_denom FROM markets WHERE id=$1`, marketID).Scan(&base, &quote); err != nil {
		return nil // market not mirrored yet; snapshot will reconcile
	}
	if quote != "" {
		if bal, err := r.stableBalance(ctx, quote, owner); err == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
				ON CONFLICT (denom_id, account) DO UPDATE SET amount=EXCLUDED.amount`,
				quote, owner, bal); err != nil {
				return err
			}
		}
	}
	if tokenID, ok := parseRWABase(base); ok {
		bal, err := r.rwaBalance(ctx, tokenID, owner)
		if err != nil {
			return nil
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO rwa_balances (token_id, holder, amount) VALUES ($1,$2,$3)
			ON CONFLICT (token_id, holder) DO UPDATE SET amount=EXCLUDED.amount`,
			tokenID, owner, bal)
		return err
	}
	if base != "" {
		if bal, err := r.stableBalance(ctx, base, owner); err == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
				ON CONFLICT (denom_id, account) DO UPDATE SET amount=EXCLUDED.amount`,
				base, owner, bal); err != nil {
				return err
			}
		}
	}
	return nil
}

// ===========================================================================
// mincast (bonding curve)
// ===========================================================================

func (r *Runner) onMincastTrade(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults, txHash string) error {
	action := ev.Attrs["action"] // mint | melt
	marketID := u64(ev, "market_id")
	account := ev.Attrs["account"]
	units := u64(ev, "units")
	if _, err := tx.Exec(ctx, `
		INSERT INTO mincast_trades (market_id, action, account, pay_amount, units, settlement, fee, floor_price, height, tx_hash, block_time)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (market_id, action, account, height, units) DO NOTHING`,
		marketID, action, account, num(ev, "amount"), num(ev, "units"),
		num(ev, "settlement"), num(ev, "fee"), num(ev, "floor_price"),
		br.Height, txHash, br.Time); err != nil {
		return err
	}
	// Maintain holder balance: mint credits units, melt debits them.
	switch action {
	case "mint":
		if err := adjustMincastBalance(ctx, tx, marketID, account, int64(units)); err != nil {
			return err
		}
	case "melt":
		if err := adjustMincastBalance(ctx, tx, marketID, account, -int64(units)); err != nil {
			return err
		}
	}
	// Keep the floor price fresh between snapshots.
	_, _ = tx.Exec(ctx, `UPDATE mincast_markets SET floor_price=$2 WHERE id=$1`,
		marketID, num(ev, "floor_price"))
	metrics.CosmosTradesTotal.Inc()
	r.pub.Publish(ctx, pubsub.ChTrades, map[string]any{
		"market_id":   marketID,
		"action":      action,
		"account":     account,
		"units":       num(ev, "units"),
		"settlement":  num(ev, "settlement"),
		"floor_price": num(ev, "floor_price"),
		"height":      br.Height,
		"block_time":  br.Time.Unix(),
	})
	return nil
}

func (r *Runner) adjustMincastTransfer(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	marketID := u64(ev, "market_id")
	amt := int64(u64(ev, "amount"))
	if from := ev.Attrs["from"]; from != "" {
		if err := adjustMincastBalance(ctx, tx, marketID, from, -amt); err != nil {
			return err
		}
	}
	if to := ev.Attrs["to"]; to != "" {
		if err := adjustMincastBalance(ctx, tx, marketID, to, amt); err != nil {
			return err
		}
	}
	return nil
}

// onMincastInvest keeps the invest record + escrowed holder balance in sync.
func (r *Runner) onMincastInvest(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	action := ev.Attrs["action"]
	marketID := u64(ev, "market_id")
	investID := u64(ev, "invest_id")
	switch action {
	case "open":
		// Units leave the holder into the invest escrow.
		if err := adjustMincastBalance(ctx, tx, marketID, ev.Attrs["account"], -int64(u64(ev, "units"))); err != nil {
			return err
		}
	case "cancel":
		// Re-query the invest to restore the escrowed units to the holder.
		var inv investRow
		if err := r.cl.Query(ctx, "energychain.mincast.v1.Query/Invest",
			map[string]any{"id": strconv.FormatUint(investID, 10)}, &inv); err == nil {
			_ = adjustMincastBalance(ctx, tx, marketID, inv.Invest.Investor, int64(parseU(inv.Invest.PrincipalUnits)))
		}
	}
	// Upsert the invest record from the authoritative query.
	var inv investRow
	if err := r.cl.Query(ctx, "energychain.mincast.v1.Query/Invest",
		map[string]any{"id": strconv.FormatUint(investID, 10)}, &inv); err == nil && inv.Invest.Id != "" {
		return upsertInvest(ctx, tx, inv.Invest)
	}
	return nil
}

// ===========================================================================
// stableusd
// ===========================================================================

func (r *Runner) onStableSupply(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	denom := ev.Attrs["denom"]
	amt := int64(u64(ev, "amount"))
	switch ev.Attrs["action"] {
	case "mint", "bridge_mint":
		if err := adjustStableBalance(ctx, tx, denom, ev.Attrs["to"], amt); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `UPDATE stable_denoms SET supply = supply + $2 WHERE id=$1`, denom, num(ev, "amount"))
	case "burn", "bridge_burn":
		if err := adjustStableBalance(ctx, tx, denom, ev.Attrs["from"], -amt); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `UPDATE stable_denoms SET supply = GREATEST(supply - $2, 0) WHERE id=$1`, denom, num(ev, "amount"))
	}
	r.pub.Publish(ctx, pubsub.ChIssuance, map[string]any{
		"kind":   "stableusd",
		"action": ev.Attrs["action"],
		"denom":  denom,
		"amount": num(ev, "amount"),
	})
	return nil
}

func (r *Runner) onStableTransfer(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	if ev.Attrs["action"] == "approve" {
		return nil // allowance only; no balance change
	}
	denom := ev.Attrs["denom"]
	amt := int64(u64(ev, "amount"))
	if err := adjustStableBalance(ctx, tx, denom, ev.Attrs["from"], -amt); err != nil {
		return err
	}
	return adjustStableBalance(ctx, tx, denom, ev.Attrs["to"], amt)
}

// onStableCompliance handles force_transfer (amount not in the event) by
// re-querying both affected balances authoritatively.
func (r *Runner) onStableCompliance(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	if ev.Attrs["action"] != "force_transfer" {
		return nil
	}
	denom := ev.Attrs["denom"]
	for _, acct := range []string{ev.Attrs["from"], ev.Attrs["to"]} {
		if acct == "" {
			continue
		}
		if bal, err := r.stableBalance(ctx, denom, acct); err == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
				ON CONFLICT (denom_id, account) DO UPDATE SET amount=EXCLUDED.amount`,
				denom, acct, bal); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Runner) onStableRedemption(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults) error {
	id := u64(ev, "redemption_id")
	var resp stableRedemptionRow
	if err := r.cl.Query(ctx, "energychain.stableusd.v1.Query/Redemption",
		map[string]any{"id": strconv.FormatUint(id, 10)}, &resp); err == nil && resp.Redemption.Id != "" {
		rd := resp.Redemption
		if _, err := tx.Exec(ctx, `
			INSERT INTO stable_redemptions (id, denom_id, holder, amount, status, memo, created_at, resolved_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, resolved_at=EXCLUDED.resolved_at`,
			parseU(rd.Id), rd.DenomId, rd.Holder, num0(rd.Amount), rd.Status, rd.Memo,
			parseU(rd.CreatedAt), parseU(rd.ResolvedAt)); err != nil {
			return err
		}
	}
	r.pub.Publish(ctx, pubsub.ChRedemptions, map[string]any{
		"kind":          "stableusd",
		"action":        ev.Attrs["action"],
		"denom":         ev.Attrs["denom"],
		"redemption_id": id,
	})
	return nil
}

// ===========================================================================
// rwatoken
// ===========================================================================

func (r *Runner) onRwaSupply(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	tokenID := u64(ev, "token_id")
	amt := int64(u64(ev, "amount"))
	switch ev.Attrs["action"] {
	case "mint":
		if err := adjustRwaBalance(ctx, tx, tokenID, ev.Attrs["to"], amt); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `UPDATE rwa_tokens SET total_supply = total_supply + $2 WHERE id=$1`, tokenID, num(ev, "amount"))
	case "burn":
		if err := adjustRwaBalance(ctx, tx, tokenID, ev.Attrs["from"], -amt); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `UPDATE rwa_tokens SET total_supply = GREATEST(total_supply - $2, 0) WHERE id=$1`, tokenID, num(ev, "amount"))
	}
	r.pub.Publish(ctx, pubsub.ChIssuance, map[string]any{
		"kind":     "rwatoken",
		"action":   ev.Attrs["action"],
		"token_id": tokenID,
		"amount":   num(ev, "amount"),
	})
	return nil
}

func (r *Runner) onRwaTransfer(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	tokenID := u64(ev, "token_id")
	amt := int64(u64(ev, "amount"))
	if err := adjustRwaBalance(ctx, tx, tokenID, ev.Attrs["from"], -amt); err != nil {
		return err
	}
	return adjustRwaBalance(ctx, tx, tokenID, ev.Attrs["to"], amt)
}

func (r *Runner) onRwaCompliance(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	if ev.Attrs["action"] != "force_transfer" {
		return nil
	}
	tokenID := u64(ev, "token_id")
	for _, holder := range []string{ev.Attrs["from"], ev.Attrs["to"]} {
		if holder == "" {
			continue
		}
		if bal, err := r.rwaBalance(ctx, tokenID, holder); err == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO rwa_balances (token_id, holder, amount) VALUES ($1,$2,$3)
				ON CONFLICT (token_id, holder) DO UPDATE SET amount=EXCLUDED.amount`,
				tokenID, holder, bal); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Runner) onRwaSnapshot(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	if ev.Attrs["action"] != "take" {
		return nil
	}
	tokenID := u64(ev, "token_id")
	snapID := u64(ev, "snapshot_id")
	if snapID == 0 || tokenID == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO rwa_snapshot_balances (snapshot_id, holder, amount)
		SELECT $1, holder, amount FROM rwa_balances
		 WHERE token_id=$2 AND amount::numeric > 0
		ON CONFLICT (snapshot_id, holder) DO UPDATE SET amount=EXCLUDED.amount`,
		snapID, tokenID); err != nil {
		return err
	}
	r.pub.Publish(ctx, pubsub.ChIssuance, map[string]any{
		"kind":        "rwatoken_snapshot",
		"action":      "take",
		"token_id":    tokenID,
		"snapshot_id": snapID,
	})
	return nil
}

func (r *Runner) onRwaDistribution(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults) error {
	id := u64(ev, "distribution_id")
	action := ev.Attrs["action"]
	var resp rwaDistributionRow
	if err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Distribution",
		map[string]any{"id": strconv.FormatUint(id, 10)}, &resp); err == nil && resp.Distribution.Id != "" {
		d := resp.Distribution
		if _, err := tx.Exec(ctx, `
			INSERT INTO rwa_distributions (id, token_id, snapshot_id, denom, total_amount, claimed_amount, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (id) DO UPDATE SET claimed_amount=EXCLUDED.claimed_amount`,
			parseU(d.Id), parseU(d.TokenId), parseU(d.SnapshotId), d.Denom,
			num0(d.TotalAmount), num0(d.ClaimedAmount), parseU(d.CreatedAt)); err != nil {
			return err
		}
		// A claim pays the holder's pro-rata share from the dividend pool via the
		// stableusd ledger's internal move (no stableusd event), so re-sync the
		// claimer's settlement balance from chain truth.
		if action == "claim" {
			if holder := ev.Attrs["account"]; holder != "" {
				claimedAt := int64(0)
				if br != nil {
					claimedAt = br.Time.Unix()
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO rwa_distribution_claims (distribution_id, holder, amount, claimed_at)
					VALUES ($1,$2,$3,$4)
					ON CONFLICT (distribution_id, holder) DO UPDATE
					   SET amount=EXCLUDED.amount, claimed_at=EXCLUDED.claimed_at`,
					id, holder, num(ev, "amount"), claimedAt); err != nil {
					return err
				}
			}
			if holder := ev.Attrs["account"]; holder != "" && d.Denom != "" {
				if bal, err := r.stableBalance(ctx, d.Denom, holder); err == nil {
					if _, err := tx.Exec(ctx, `
						INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
						ON CONFLICT (denom_id, account) DO UPDATE SET amount=EXCLUDED.amount`,
						d.Denom, holder, bal); err != nil {
						return err
					}
				}
			}
		}
	}
	r.pub.Publish(ctx, pubsub.ChIssuance, map[string]any{
		"kind":            "rwatoken_distribution",
		"action":          ev.Attrs["action"],
		"token_id":        u64(ev, "token_id"),
		"distribution_id": id,
	})
	return nil
}

func (r *Runner) onRwaRedemption(ctx context.Context, tx pgx.Tx, ev cosmos.Event, br *cosmos.BlockResults) error {
	id := u64(ev, "redemption_id")
	var resp rwaRedemptionRow
	if err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Redemption",
		map[string]any{"id": strconv.FormatUint(id, 10)}, &resp); err == nil && resp.Redemption.Id != "" {
		rd := resp.Redemption
		if _, err := tx.Exec(ctx, `
			INSERT INTO rwa_redemptions (id, token_id, holder, units, denom, payout, status, requested_at, execute_after, resolved_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, resolved_at=EXCLUDED.resolved_at`,
			parseU(rd.Id), parseU(rd.TokenId), rd.Holder, num0(rd.Units), rd.Denom,
			num0(rd.Payout), rd.Status, parseU(rd.RequestedAt), parseU(rd.ExecuteAfter), parseU(rd.ResolvedAt)); err != nil {
			return err
		}
	}
	r.pub.Publish(ctx, pubsub.ChRedemptions, map[string]any{
		"kind":          "rwatoken",
		"action":        ev.Attrs["action"],
		"token_id":      u64(ev, "token_id"),
		"redemption_id": id,
	})
	return nil
}

// ===========================================================================
// balance helpers
// ===========================================================================

func adjustStableBalance(ctx context.Context, tx pgx.Tx, denom, account string, delta int64) error {
	if account == "" || delta == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
		ON CONFLICT (denom_id, account) DO UPDATE
		   SET amount = GREATEST(stable_balances.amount + $3, 0)`,
		denom, account, delta)
	return err
}

// Offering settlements move settlement stablecoins and mint RWA units through
// the stableusd / rwatoken keepers' INTERNAL ledger calls (MoveBalance,
// IssueUnits), none of which emit a stableusd_*/rwatoken_* event. So unlike the
// public Transfer/Mint paths, the indexer never sees these balance changes and
// the portfolio drifts (e.g. a subscriber's scnUSDC stays at its pre-subscribe
// value, a claimed RWA allocation never shows). The handlers below re-query the
// authoritative on-chain balance for the affected human accounts and upsert it
// as an absolute value; snapshots already keep the offering/treasury rows fresh.

// refreshOfferingStable re-syncs each account's settlement-denom balance from
// chain state. The offering events carry no denom, so it is resolved from the
// mirrored offering row.
func (r *Runner) refreshOfferingStable(ctx context.Context, tx pgx.Tx, offeringID uint64, accounts ...string) error {
	var denom string
	if err := tx.QueryRow(ctx, `SELECT denom FROM offerings WHERE id=$1`, offeringID).Scan(&denom); err != nil || denom == "" {
		return nil
	}
	for _, acct := range accounts {
		if acct == "" {
			continue
		}
		bal, err := r.stableBalance(ctx, denom, acct)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO stable_balances (denom_id, account, amount) VALUES ($1,$2,$3)
			ON CONFLICT (denom_id, account) DO UPDATE SET amount=EXCLUDED.amount`,
			denom, acct, bal); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runner) refreshOfferingSubscription(ctx context.Context, tx pgx.Tx, offeringID uint64, investor string) error {
	if investor == "" {
		return nil
	}
	var resp subscriptionRow
	if err := r.cl.Query(ctx, "energychain.offering.v1.Query/Subscription",
		map[string]any{
			"offering_id": strconv.FormatUint(offeringID, 10),
			"investor":    investor,
		}, &resp); err != nil {
		return nil
	}
	s := resp.Subscription
	if s.Investor == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO offering_subscriptions
		  (offering_id, investor, contributed, units, allocated, returns_claimed, refunded)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (offering_id, investor) DO UPDATE SET
		  returns_claimed=EXCLUDED.returns_claimed`,
		offeringID, s.Investor, num0(s.Contributed), num0(s.Units), s.Allocated,
		num0(s.ReturnsClaimed), s.Refunded)
	return err
}

// onOfferingSubscription handles both legs of a subscription: "subscribe"
// debits the investor's settlement balance into the treasury, and "allocate"
// mints RWA units to the investor on a successful raise.
func (r *Runner) onOfferingSubscription(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	investor := ev.Attrs["investor"]
	if investor == "" {
		return nil
	}
	offeringID := u64(ev, "offering_id")
	switch ev.Attrs["action"] {
	case "subscribe":
		return r.refreshOfferingStable(ctx, tx, offeringID, investor)
	case "allocate":
		var tokenID int64
		if err := tx.QueryRow(ctx, `SELECT token_id FROM offerings WHERE id=$1`, offeringID).Scan(&tokenID); err != nil {
			return nil
		}
		bal, err := r.rwaBalance(ctx, uint64(tokenID), investor)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO rwa_balances (token_id, holder, amount) VALUES ($1,$2,$3)
			ON CONFLICT (token_id, holder) DO UPDATE SET amount=EXCLUDED.amount`,
			tokenID, investor, bal)
		return err
	}
	return nil
}

// onOfferingReturn refreshes balances after an issuer yield injection (issuer
// debited) or an investor returns claim (investor credited).
func (r *Runner) onOfferingReturn(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	offeringID := u64(ev, "offering_id")
	switch ev.Attrs["action"] {
	case "claim":
		investor := ev.Attrs["investor"]
		if err := r.refreshOfferingStable(ctx, tx, offeringID, investor); err != nil {
			return err
		}
		return r.refreshOfferingSubscription(ctx, tx, offeringID, investor)
	case "inject":
		var issuer string
		if err := tx.QueryRow(ctx, `SELECT issuer FROM offerings WHERE id=$1`, offeringID).Scan(&issuer); err != nil {
			return nil
		}
		return r.refreshOfferingStable(ctx, tx, offeringID, issuer)
	}
	return nil
}

// onOfferingRefund refreshes an investor's balance after a refund payout.
func (r *Runner) onOfferingRefund(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	return r.refreshOfferingStable(ctx, tx, u64(ev, "offering_id"), ev.Attrs["investor"])
}

// onOfferingTranche refreshes the issuer's balance after a tranche release.
func (r *Runner) onOfferingTranche(ctx context.Context, tx pgx.Tx, ev cosmos.Event) error {
	offeringID := u64(ev, "offering_id")
	var issuer string
	if err := tx.QueryRow(ctx, `SELECT issuer FROM offerings WHERE id=$1`, offeringID).Scan(&issuer); err != nil {
		return nil
	}
	return r.refreshOfferingStable(ctx, tx, offeringID, issuer)
}

func adjustRwaBalance(ctx context.Context, tx pgx.Tx, tokenID uint64, holder string, delta int64) error {
	if holder == "" || delta == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO rwa_balances (token_id, holder, amount) VALUES ($1,$2,$3)
		ON CONFLICT (token_id, holder) DO UPDATE
		   SET amount = GREATEST(rwa_balances.amount + $3, 0)`,
		tokenID, holder, delta)
	return err
}

func adjustMincastBalance(ctx context.Context, tx pgx.Tx, marketID uint64, holder string, delta int64) error {
	if holder == "" || delta == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO mincast_balances (market_id, holder, amount) VALUES ($1,$2,$3)
		ON CONFLICT (market_id, holder) DO UPDATE
		   SET amount = GREATEST(mincast_balances.amount + $3, 0)`,
		marketID, holder, delta)
	return err
}

// stableBalance / rwaBalance fetch the authoritative on-chain balance.
func (r *Runner) stableBalance(ctx context.Context, denom, account string) (string, error) {
	var resp struct {
		Amount string `json:"amount"`
	}
	err := r.cl.Query(ctx, "energychain.stableusd.v1.Query/Balance",
		map[string]any{"denom_id": denom, "account": account}, &resp)
	return num0(resp.Amount), err
}

func (r *Runner) rwaBalance(ctx context.Context, tokenID uint64, holder string) (string, error) {
	var resp struct {
		Amount string `json:"amount"`
	}
	err := r.cl.Query(ctx, "energychain.rwatoken.v1.Query/Balance",
		map[string]any{"token_id": strconv.FormatUint(tokenID, 10), "holder": holder}, &resp)
	return num0(resp.Amount), err
}
