package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Native (Cosmos module) read endpoints. All list/detail handlers read from
// the indexer-maintained Postgres mirror; balance / quote / evaluate / tx
// handlers reach the chain live via the REST client. uint64 columns are cast
// to ::text in SQL so JSON preserves full precision.

// rowsToMaps runs a query and returns each row as a column-keyed map. NUMERIC
// columns should be cast ::text in the SQL so they serialise as strings.
func (a *API) rowsToMaps(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := a.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fds := rows.FieldDescriptions()
	out := make([]map[string]any, 0, 16)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(fds))
		for i, fd := range fds {
			m[string(fd.Name)] = vals[i]
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (a *API) oneRow(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	rows, err := a.rowsToMaps(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

func u64Param(r *http.Request, key string) string {
	v := chi.URLParam(r, key)
	if _, err := strconv.ParseUint(v, 10, 64); err != nil {
		return ""
	}
	return v
}

// ===========================================================================
// stableusd
// ===========================================================================

func (a *API) Denoms(w http.ResponseWriter, r *http.Request) {
	v, err := a.cached(r, "native:denoms", 15*time.Second, func() (any, error) {
		items, err := a.rowsToMaps(r.Context(), `
			SELECT id, symbol, decimals, peg_currency, admin, minters, status,
			       reserve_topic, required_ratio_bps, max_staleness_seconds, policy_id,
			       supply::text AS supply, created_at, updated_at
			  FROM stable_denoms ORDER BY id`)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": items}, nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (a *API) Denom(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row, err := a.oneRow(r.Context(), `
		SELECT id, symbol, decimals, peg_currency, admin, minters, status,
		       reserve_topic, required_ratio_bps, max_staleness_seconds, policy_id,
		       supply::text AS supply, created_at, updated_at
		  FROM stable_denoms WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "denom not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// DenomBalance returns the authoritative on-chain free balance (excludes
// market order escrow) for an account.
func (a *API) DenomBalance(w http.ResponseWriter, r *http.Request) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	id := chi.URLParam(r, "id")
	addr := chi.URLParam(r, "addr")
	var resp struct {
		Amount string `json:"amount"`
	}
	if err := a.Cosmos.Query(r.Context(), "energychain.stableusd.v1.Query/Balance",
		map[string]any{"denom_id": id, "account": addr}, &resp); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if resp.Amount == "" {
		resp.Amount = "0"
	}
	writeJSON(w, http.StatusOK, map[string]any{"denom_id": id, "account": addr, "amount": resp.Amount})
}

// ===========================================================================
// rwatoken
// ===========================================================================

func (a *API) RwaTokens(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, symbol, name, admin, asset_class, decimals, total_supply::text AS total_supply,
		       status, settlement_denom, policy_id, require_kyc, redemption_price::text AS redemption_price,
		       redemption_delay_seconds, per_holder_cap::text AS per_holder_cap, metadata_uri,
		       pool_balance::text AS pool_balance, created_at, updated_at
		  FROM rwa_tokens ORDER BY id`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) RwaToken(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid token id")
		return
	}
	row, err := a.oneRow(r.Context(), `
		SELECT id, symbol, name, admin, asset_class, decimals, total_supply::text AS total_supply,
		       status, settlement_denom, policy_id, require_kyc, redemption_price::text AS redemption_price,
		       redemption_delay_seconds, per_holder_cap::text AS per_holder_cap, metadata_uri,
		       pool_balance::text AS pool_balance, created_at, updated_at
		  FROM rwa_tokens WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "token not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (a *API) RwaDistributions(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, token_id, snapshot_id, denom, total_amount::text AS total_amount,
		       claimed_amount::text AS claimed_amount, created_at
		  FROM rwa_distributions WHERE token_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// RwaOfferingReturns lists ClaimReturns receipts for offerings tied to this RWA
// token. Pass ?investor= to scope to the connected wallet (one row per offering).
func (a *API) RwaOfferingReturns(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	investor := strings.TrimSpace(r.URL.Query().Get("investor"))
	if investor == "" {
		writeErr(w, http.StatusBadRequest, "investor required")
		return
	}
	ctx := r.Context()
	offerings, err := a.rowsToMaps(ctx, `
		SELECT id::text AS id, denom FROM offerings WHERE token_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]map[string]any, 0, 4)
	for _, o := range offerings {
		oid := mapStr(o, "id")
		denom, _ := o["denom"].(string)
		subs, err := a.rowsToMaps(ctx, `
			SELECT investor, units::text AS units, contributed::text AS contributed,
			       returns_claimed::text AS returns_claimed, allocated, refunded
			  FROM offering_subscriptions
			 WHERE offering_id=$1::bigint AND investor=$2`, oid, investor)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, s := range subs {
			if s["refunded"] == true {
				continue
			}
			returnsClaimed := mapStr(s, "returns_claimed")
			claimable := "0"
			if a.Cosmos != nil {
				var subResp struct {
					Subscription struct {
						ReturnsClaimed string `json:"returns_claimed"`
					} `json:"subscription"`
				}
				if err := a.Cosmos.Query(ctx, "energychain.offering.v1.Query/Subscription",
					map[string]any{"offering_id": oid, "investor": investor}, &subResp); err == nil {
					if subResp.Subscription.ReturnsClaimed != "" {
						returnsClaimed = subResp.Subscription.ReturnsClaimed
					}
				}
				var claimResp struct {
					Amount string `json:"amount"`
				}
				if err := a.Cosmos.Query(ctx, "energychain.offering.v1.Query/ClaimableReturns",
					map[string]any{"offering_id": oid, "investor": investor}, &claimResp); err == nil && claimResp.Amount != "" {
					claimable = claimResp.Amount
				}
			}
			items = append(items, map[string]any{
				"offering_id":     oid,
				"denom":           denom,
				"investor":        investor,
				"units":           mapStr(s, "units"),
				"contributed":     mapStr(s, "contributed"),
				"returns_claimed": returnsClaimed,
				"claimable":       claimable,
				"allocated":       s["allocated"],
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"token_id": id, "investor": investor, "items": items})
}

func mapStr(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		if v == "" {
			return "0"
		}
		return v
	case int64:
		return strconv.FormatInt(v, 10)
	case int:
		return strconv.Itoa(v)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case float64:
		return strconv.FormatInt(int64(v), 10)
	default:
		return "0"
	}
}

func (a *API) RwaRedemptions(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, token_id, holder, units::text AS units, denom, payout::text AS payout,
		       status, requested_at, execute_after, resolved_at
		  FROM rwa_redemptions WHERE token_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// RwaClaimable lists, per distribution of a token, how much a holder can still
// claim (their snapshot pro-rata share, net of prior claims). This is what the
// secondary-market buyer needs to see: after a snapshot+distribution they are
// the holder-of-record and the dividend follows the token to them. The
// claimable amount is read live from chain so it reflects late claims.
func (a *API) RwaClaimable(w http.ResponseWriter, r *http.Request) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	id := u64Param(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid token id")
		return
	}
	holder := chi.URLParam(r, "addr")
	dists, err := a.rowsToMaps(r.Context(), `
		SELECT id::text AS id, snapshot_id, denom, total_amount::text AS total_amount,
		       claimed_amount::text AS claimed_amount, created_at
		  FROM rwa_distributions WHERE token_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(dists))
	var total uint64
	for _, d := range dists {
		did, _ := d["id"].(string)
		var resp struct {
			Amount  string `json:"amount"`
			Claimed bool   `json:"claimed"`
		}
		if err := a.Cosmos.Query(r.Context(), "energychain.rwatoken.v1.Query/ClaimableAmount",
			map[string]any{"distribution_id": did, "holder": holder}, &resp); err != nil {
			continue
		}
		if resp.Amount == "" {
			resp.Amount = "0"
		}
		if n, e := strconv.ParseUint(resp.Amount, 10, 64); e == nil {
			total += n
		}
		out = append(out, map[string]any{
			"distribution_id": did,
			"snapshot_id":     d["snapshot_id"],
			"denom":           d["denom"],
			"amount":          resp.Amount,
			"claimed":         resp.Claimed,
			"created_at":      d["created_at"],
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"token_id": id, "holder": holder, "items": out, "total_claimable": strconv.FormatUint(total, 10)})
}

// ===========================================================================
// market (order book)
// ===========================================================================

func (a *API) Markets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	items, err := a.rowsToMaps(ctx, `
		SELECT id, base_denom, quote_denom, status, fee_bps, min_base_qty::text AS min_base_qty,
		       batch_interval, last_batch_time, last_clearing_price::text AS last_clearing_price,
		       created_at, require_kyc, policy_id,
		       operator, bond_amount::text AS bond_amount, bond_denom
		  FROM markets ORDER BY id`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, m := range items {
		a.enrichMarket(ctx, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) Market(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	ctx := r.Context()
	row, err := a.oneRow(ctx, `
		SELECT id, base_denom, quote_denom, status, fee_bps, min_base_qty::text AS min_base_qty,
		       batch_interval, last_batch_time, last_clearing_price::text AS last_clearing_price,
		       created_at, require_kyc, policy_id,
		       operator, bond_amount::text AS bond_amount, bond_denom
		  FROM markets WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "market not found")
		return
	}
	a.enrichMarket(ctx, row)
	writeJSON(w, http.StatusOK, row)
}

// enrichMarket annotates a market row with the asset kind and display metadata
// for its base/quote legs. The quote leg is always an x/stableusd denom; the
// base leg is either a stable denom (base_kind "stable") or an x/rwatoken
// security token addressed as "rwa/<tokenID>" (base_kind "rwa"). The frontend
// needs base_decimals to format order quantities correctly (an RWA token often
// has 0 decimals, a stablecoin 6).
func (a *API) enrichMarket(ctx context.Context, m map[string]any) {
	base, _ := m["base_denom"].(string)
	quote, _ := m["quote_denom"].(string)
	if sym, dec, ok := a.stableMeta(ctx, quote); ok {
		m["quote_symbol"] = sym
		m["quote_decimals"] = dec
	}
	if strings.HasPrefix(base, "rwa/") {
		m["base_kind"] = "rwa"
		if id, err := strconv.ParseUint(strings.TrimPrefix(base, "rwa/"), 10, 64); err == nil {
			m["base_token_id"] = id
			if sym, dec, ok := a.rwaMeta(ctx, id); ok {
				m["base_symbol"] = sym
				m["base_decimals"] = dec
			}
		}
	} else {
		m["base_kind"] = "stable"
		if sym, dec, ok := a.stableMeta(ctx, base); ok {
			m["base_symbol"] = sym
			m["base_decimals"] = dec
		}
	}
}

func (a *API) stableMeta(ctx context.Context, id string) (string, int, bool) {
	if id == "" {
		return "", 0, false
	}
	var sym string
	var dec int
	if err := a.Pool.QueryRow(ctx, `SELECT symbol, decimals FROM stable_denoms WHERE id=$1`, id).Scan(&sym, &dec); err != nil {
		return "", 0, false
	}
	return sym, dec, true
}

func (a *API) rwaMeta(ctx context.Context, id uint64) (string, int, bool) {
	var sym string
	var dec int
	if err := a.Pool.QueryRow(ctx, `SELECT symbol, decimals FROM rwa_tokens WHERE id=$1`, id).Scan(&sym, &dec); err != nil {
		return "", 0, false
	}
	return sym, dec, true
}

// OrderBook returns aggregated price levels (depth) plus the raw open orders,
// split into bids (BUY, descending price) and asks (SELL, ascending price).
func (a *API) OrderBook(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	depth := func(side, order string) ([]map[string]any, error) {
		return a.rowsToMaps(r.Context(), `
			SELECT price::text AS price,
			       SUM(quantity - filled)::text AS quantity,
			       COUNT(*) AS orders
			  FROM orders
			 WHERE market_id=$1 AND status='ORDER_STATUS_OPEN' AND side=$2
			 GROUP BY price
			 ORDER BY price `+order+`
			 LIMIT 100`, id, side)
	}
	bids, err := depth("ORDER_SIDE_BUY", "DESC")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	asks, err := depth("ORDER_SIDE_SELL", "ASC")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"market_id": id, "bids": bids, "asks": asks})
}

// MarketTrades returns recent batch-clearing prints for a market.
func (a *API) MarketTrades(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	limit := intParam(r, "limit", 100, 500)
	items, err := a.rowsToMaps(r.Context(), `
		SELECT market_id, height, EXTRACT(EPOCH FROM block_time)::bigint AS block_time,
		       price::text AS price, qty::text AS qty
		  FROM market_clears WHERE market_id=$1 ORDER BY height DESC LIMIT $2`, id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// MarketCandles aggregates clearing prints into OHLCV buckets.
func (a *API) MarketCandles(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	interval := granToInterval(r.URL.Query().Get("granularity"))
	limit := intParam(r, "limit", 500, 1000)
	items, err := a.rowsToMaps(r.Context(), `
		SELECT EXTRACT(EPOCH FROM bucket)::bigint AS t,
		       o::text AS o, h::text AS h, l::text AS l, c::text AS c,
		       v::text AS v, n
		  FROM (
		    SELECT time_bucket($2::interval, block_time) AS bucket,
		           first(price, block_time) AS o,
		           max(price)               AS h,
		           min(price)               AS l,
		           last(price, block_time)  AS c,
		           sum(qty)                 AS v,
		           count(*)                 AS n
		      FROM market_clears
		     WHERE market_id=$1
		     GROUP BY bucket
		     ORDER BY bucket DESC
		     LIMIT $3
		  ) s ORDER BY bucket ASC`, id, interval, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "granularity": r.URL.Query().Get("granularity")})
}

func granToInterval(g string) string {
	switch g {
	case "1m":
		return "1 minute"
	case "5m":
		return "5 minutes"
	case "15m":
		return "15 minutes"
	case "1h":
		return "1 hour"
	case "4h":
		return "4 hours"
	case "1d":
		return "1 day"
	case "1w":
		return "1 week"
	default:
		return "1 hour"
	}
}

// OrdersByOwner returns an owner's open orders across all markets.
func (a *API) OrdersByOwner(w http.ResponseWriter, r *http.Request) {
	owner := chi.URLParam(r, "addr")
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, market_id, owner, side, price::text AS price, quantity::text AS quantity,
		       filled::text AS filled, escrowed::text AS escrowed, status, created_at, seq
		  FROM orders WHERE owner=$1 AND status='ORDER_STATUS_OPEN' ORDER BY created_at DESC`, owner)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// ===========================================================================
// mincast
// ===========================================================================

func (a *API) MincastMarkets(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, denom, name, admin, settlement_denom, treasury::text AS treasury,
		       supply::text AS supply, initial_price::text AS initial_price, mint_fee_bps, melt_fee_bps,
		       floor_price::text AS floor_price, status, policy_id, require_kyc,
		       reward_pool::text AS reward_pool, created_at, updated_at
		  FROM mincast_markets ORDER BY id`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) MincastMarket(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	row, err := a.oneRow(r.Context(), `
		SELECT id, denom, name, admin, settlement_denom, treasury::text AS treasury,
		       supply::text AS supply, initial_price::text AS initial_price, mint_fee_bps, melt_fee_bps,
		       floor_price::text AS floor_price, status, policy_id, require_kyc,
		       reward_pool::text AS reward_pool, created_at, updated_at
		  FROM mincast_markets WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "market not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// MincastQuote previews a mint or melt against the live bonding curve.
func (a *API) MincastQuote(w http.ResponseWriter, r *http.Request) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	id := u64Param(r, "id")
	isMint := r.URL.Query().Get("is_mint") != "false"
	amount := r.URL.Query().Get("amount")
	if amount == "" {
		writeErr(w, http.StatusBadRequest, "amount required")
		return
	}
	var resp map[string]any
	if err := a.Cosmos.Query(r.Context(), "energychain.mincast.v1.Query/Quote",
		map[string]any{"market_id": id, "is_mint": isMint, "amount": amount}, &resp); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) MincastTrades(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	limit := intParam(r, "limit", 100, 500)
	items, err := a.rowsToMaps(r.Context(), `
		SELECT market_id, action, account, pay_amount::text AS pay_amount, units::text AS units,
		       settlement::text AS settlement, fee::text AS fee, floor_price::text AS floor_price,
		       height, tx_hash, EXTRACT(EPOCH FROM block_time)::bigint AS block_time
		  FROM mincast_trades WHERE market_id=$1 ORDER BY id DESC LIMIT $2`, id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// ===========================================================================
// offering
// ===========================================================================

func (a *API) Offerings(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, token_id, issuer, denom, unit_price::text AS unit_price, soft_cap::text AS soft_cap,
		       hard_cap::text AS hard_cap, raised::text AS raised, start_time, end_time, status,
		       total_tranches, released_tranches, released_amount::text AS released_amount,
		       injections_done, injected_total::text AS injected_total,
		       required_injection::text AS required_injection, injection_interval,
		       allocated_units::text AS allocated_units, treasury::text AS treasury,
		       returns_pool::text AS returns_pool, succeeded_at, created_at, updated_at
		  FROM offerings ORDER BY id DESC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) Offering(w http.ResponseWriter, r *http.Request) {
	id := u64Param(r, "id")
	row, err := a.oneRow(r.Context(), `
		SELECT id, token_id, issuer, denom, unit_price::text AS unit_price, soft_cap::text AS soft_cap,
		       hard_cap::text AS hard_cap, raised::text AS raised, start_time, end_time, status,
		       total_tranches, released_tranches, released_amount::text AS released_amount,
		       injections_done, injected_total::text AS injected_total,
		       required_injection::text AS required_injection, injection_interval,
		       allocated_units::text AS allocated_units, default_treasury::text AS default_treasury,
		       treasury::text AS treasury, returns_pool::text AS returns_pool, succeeded_at,
		       created_at, updated_at
		  FROM offerings WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "offering not found")
		return
	}
	subs, _ := a.rowsToMaps(r.Context(), `
		SELECT offering_id, investor, contributed::text AS contributed, units::text AS units,
		       allocated, returns_claimed::text AS returns_claimed, refunded
		  FROM offering_subscriptions WHERE offering_id=$1 ORDER BY investor`, id)
	row["subscriptions"] = subs
	writeJSON(w, http.StatusOK, row)
}

// ===========================================================================
// identity / compliance
// ===========================================================================

func (a *API) IdentityAccount(w http.ResponseWriter, r *http.Request) {
	addr := chi.URLParam(r, "addr")
	row, err := a.oneRow(r.Context(), `
		SELECT address, did, kyc_cleared, accredited, jurisdiction, kyc_expires_at, status,
		       registrar, created_at, updated_at
		  FROM identity_accounts WHERE address=$1`, addr)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		// Not an error: simply an un-onboarded address.
		writeJSON(w, http.StatusOK, map[string]any{"address": addr, "kyc_cleared": false, "exists": false})
		return
	}
	row["exists"] = true
	writeJSON(w, http.StatusOK, row)
}

func (a *API) Policy(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row, err := a.oneRow(r.Context(), `
		SELECT id, description, require_kyc, require_accredited, deny_frozen, allowed_jurisdictions,
		       denied_jurisdictions, paused, owner, created_at, updated_at
		  FROM identity_policies WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "policy not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// EvaluateTransfer proxies a live compliance pre-check so the UI can warn
// before a user signs a doomed transfer.
func (a *API) EvaluateTransfer(w http.ResponseWriter, r *http.Request) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	var body struct {
		PolicyID string `json:"policy_id"`
		From     string `json:"from"`
		To       string `json:"to"`
		Amount   string `json:"amount"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	var resp map[string]any
	if err := a.Cosmos.Query(r.Context(), "energychain.identity.v1.Query/EvaluateTransfer",
		map[string]any{"policy_id": body.PolicyID, "from": body.From, "to": body.To, "amount": body.Amount}, &resp); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ===========================================================================
// assethub (energy)
// ===========================================================================

func (a *API) AssethubDevices(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, operator, device_type, jurisdiction, attestation_hash, firmware, status,
		       created_at, updated_at
		  FROM assethub_devices ORDER BY id`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) AssethubReadings(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	limit := intParam(r, "limit", 100, 500)
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, device_id, period_start, period_end, unit, iot_value::text AS iot_value,
		       operational_value::text AS operational_value, verified, submitted_by, submitted_at
		  FROM assethub_readings WHERE device_id=$1 ORDER BY period_end DESC LIMIT $2`, id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) AssethubProviders(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT address, role, display_name, bond::text AS bond, status, infractions,
		       jailed_until, created_at, updated_at
		  FROM assethub_providers ORDER BY address`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) AssethubTopics(w http.ResponseWriter, r *http.Request) {
	items, err := a.rowsToMaps(r.Context(), `
		SELECT id, description, min_sources, value::text AS value, source_count, has_value, updated_at
		  FROM assethub_topics ORDER BY id`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// ===========================================================================
// portfolio (cross-module, by bech32 address)
// ===========================================================================

func (a *API) NativePortfolio(w http.ResponseWriter, r *http.Request) {
	addr := chi.URLParam(r, "addr")
	ctx := r.Context()

	stable, _ := a.rowsToMaps(ctx, `
		SELECT b.denom_id, d.symbol, d.decimals, b.amount::text AS amount
		  FROM stable_balances b LEFT JOIN stable_denoms d ON d.id=b.denom_id
		 WHERE b.account=$1 AND b.amount > 0 ORDER BY b.denom_id`, addr)
	rwa, _ := a.rowsToMaps(ctx, `
		SELECT b.token_id, t.symbol, t.name, t.decimals, t.asset_class, b.amount::text AS amount
		  FROM rwa_balances b LEFT JOIN rwa_tokens t ON t.id=b.token_id
		 WHERE b.holder=$1 AND b.amount > 0 ORDER BY b.token_id`, addr)
	mincast, _ := a.rowsToMaps(ctx, `
		SELECT b.market_id, m.denom, m.name, m.floor_price::text AS floor_price, b.amount::text AS amount
		  FROM mincast_balances b LEFT JOIN mincast_markets m ON m.id=b.market_id
		 WHERE b.holder=$1 AND b.amount > 0 ORDER BY b.market_id`, addr)
	openOrders, _ := a.rowsToMaps(ctx, `
		SELECT id, market_id, side, price::text AS price, quantity::text AS quantity,
		       filled::text AS filled, escrowed::text AS escrowed, status
		  FROM orders WHERE owner=$1 AND status='ORDER_STATUS_OPEN' ORDER BY created_at DESC`, addr)
	invests, _ := a.rowsToMaps(ctx, `
		SELECT id, market_id, principal_units::text AS principal_units, yield::text AS yield,
		       apy_bps, opened_at, maturity, status
		  FROM mincast_invests WHERE investor=$1 ORDER BY id DESC`, addr)
	subs, _ := a.rowsToMaps(ctx, `
		SELECT offering_id, contributed::text AS contributed, units::text AS units, allocated,
		       returns_claimed::text AS returns_claimed, refunded
		  FROM offering_subscriptions WHERE investor=$1 ORDER BY offering_id DESC`, addr)

	writeJSON(w, http.StatusOK, map[string]any{
		"address":        addr,
		"stable_balances": stable,
		"rwa_balances":   rwa,
		"mincast_balances": mincast,
		"open_orders":    openOrders,
		"invests":        invests,
		"subscriptions":  subs,
	})
}

// ===========================================================================
// transaction simulate / broadcast proxy
// ===========================================================================

// TxBroadcast forwards a signed tx to the Cosmos REST broadcast endpoint.
// Body: {"tx_bytes":"<base64>","mode":"BROADCAST_MODE_SYNC"}.
func (a *API) TxBroadcast(w http.ResponseWriter, r *http.Request) {
	a.txProxy(w, r, "cosmos/tx/v1beta1/txs")
}

// TxSimulate forwards to the Cosmos REST simulate endpoint.
// Body: {"tx_bytes":"<base64>"}.
func (a *API) TxSimulate(w http.ResponseWriter, r *http.Request) {
	a.txProxy(w, r, "cosmos/tx/v1beta1/simulate")
}

func (a *API) txProxy(w http.ResponseWriter, r *http.Request, method string) {
	if a.Cosmos == nil {
		writeErr(w, http.StatusNotImplemented, "cosmos layer disabled")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body")
		return
	}
	status, resp, err := a.Cosmos.BroadcastRaw(r.Context(), method, body)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(resp)
}

// NativeConfig exposes chain connection params the web app needs to configure
// Keplr / CosmJS.
func (a *API) NativeConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"cosmos_enabled":  a.Cosmos != nil,
		"chain_id":        a.CosmosChainID,
		"bech32_prefix":   a.Bech32Prefix,
		"native_denom":    a.NativeDenom,
		"native_decimals": a.NativeDecimals,
	})
}

var _ = strings.TrimSpace
