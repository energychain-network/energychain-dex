-- 003_native.up.sql
--
-- Native Cosmos module data model for EnergyChain. These tables mirror the
-- on-chain entities exposed by the energychain-node custom modules
-- (stableusd / rwatoken / offering / mincast / market / identity / assethub /
-- bridge / automation). The cosmos-indexer keeps them in sync from CometBFT
-- block events + periodic gRPC/REST state snapshots; dex-api serves them.
--
-- Conventions:
--   * on-chain uint64 amounts/prices  -> NUMERIC(40,0) (uint64 overflows int8)
--   * on-chain ids/sequences/heights  -> BIGINT
--   * on-chain unix times             -> BIGINT (seconds)
--   * enums                           -> TEXT, storing the proto enum name
--                                        (e.g. "ORDER_STATUS_OPEN")
--   * height-based cursor; Cosmos blocks are final (no reorg rewind needed).

-- ---------------------------------------------------------------------------
-- Indexer cursor (height based, one row per logical stream)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cosmos_cursor (
    stream     TEXT PRIMARY KEY,
    height     BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 资产发行 (asset issuance)
-- ===========================================================================

-- stableusd: fiat-pegged settlement denoms ----------------------------------
CREATE TABLE IF NOT EXISTS stable_denoms (
    id                    TEXT PRIMARY KEY,
    symbol                TEXT          NOT NULL DEFAULT '',
    decimals              INT           NOT NULL DEFAULT 0,
    peg_currency          TEXT          NOT NULL DEFAULT '',
    admin                 TEXT          NOT NULL DEFAULT '',
    minters               TEXT[]        NOT NULL DEFAULT '{}',
    status                TEXT          NOT NULL DEFAULT 'DENOM_STATUS_ACTIVE',
    reserve_topic         TEXT          NOT NULL DEFAULT '',
    required_ratio_bps    INT           NOT NULL DEFAULT 0,
    max_staleness_seconds BIGINT        NOT NULL DEFAULT 0,
    policy_id             TEXT          NOT NULL DEFAULT '',
    supply                NUMERIC(40,0) NOT NULL DEFAULT 0,
    created_at            BIGINT        NOT NULL DEFAULT 0,
    updated_at            BIGINT        NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stable_balances (
    denom_id TEXT          NOT NULL,
    account  TEXT          NOT NULL,
    amount   NUMERIC(40,0) NOT NULL DEFAULT 0,
    PRIMARY KEY (denom_id, account)
);
CREATE INDEX IF NOT EXISTS stable_balances_account_idx ON stable_balances (account);

CREATE TABLE IF NOT EXISTS stable_redemptions (
    id         BIGINT PRIMARY KEY,
    denom_id   TEXT          NOT NULL,
    holder     TEXT          NOT NULL,
    amount     NUMERIC(40,0) NOT NULL DEFAULT 0,
    status     TEXT          NOT NULL DEFAULT 'REDEMPTION_STATUS_PENDING',
    memo       TEXT          NOT NULL DEFAULT '',
    created_at BIGINT        NOT NULL DEFAULT 0,
    resolved_at BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stable_redemptions_holder_idx ON stable_redemptions (holder);

-- rwatoken: permissioned RWA security tokens --------------------------------
CREATE TABLE IF NOT EXISTS rwa_tokens (
    id                       BIGINT PRIMARY KEY,
    symbol                   TEXT          NOT NULL DEFAULT '',
    name                     TEXT          NOT NULL DEFAULT '',
    admin                    TEXT          NOT NULL DEFAULT '',
    asset_class              TEXT          NOT NULL DEFAULT '',
    decimals                 INT           NOT NULL DEFAULT 0,
    total_supply             NUMERIC(40,0) NOT NULL DEFAULT 0,
    status                   TEXT          NOT NULL DEFAULT 'TOKEN_STATUS_ACTIVE',
    settlement_denom         TEXT          NOT NULL DEFAULT '',
    policy_id                TEXT          NOT NULL DEFAULT '',
    require_kyc              BOOLEAN       NOT NULL DEFAULT FALSE,
    redemption_price         NUMERIC(40,0) NOT NULL DEFAULT 0,
    redemption_delay_seconds BIGINT        NOT NULL DEFAULT 0,
    per_holder_cap           NUMERIC(40,0) NOT NULL DEFAULT 0,
    metadata_uri             TEXT          NOT NULL DEFAULT '',
    pool_balance             NUMERIC(40,0) NOT NULL DEFAULT 0,
    created_at               BIGINT        NOT NULL DEFAULT 0,
    updated_at               BIGINT        NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rwa_balances (
    token_id BIGINT        NOT NULL,
    holder   TEXT          NOT NULL,
    amount   NUMERIC(40,0) NOT NULL DEFAULT 0,
    PRIMARY KEY (token_id, holder)
);
CREATE INDEX IF NOT EXISTS rwa_balances_holder_idx ON rwa_balances (holder);

CREATE TABLE IF NOT EXISTS rwa_distributions (
    id             BIGINT PRIMARY KEY,
    token_id       BIGINT        NOT NULL,
    snapshot_id    BIGINT        NOT NULL DEFAULT 0,
    denom          TEXT          NOT NULL DEFAULT '',
    total_amount   NUMERIC(40,0) NOT NULL DEFAULT 0,
    claimed_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
    created_at     BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rwa_distributions_token_idx ON rwa_distributions (token_id);

CREATE TABLE IF NOT EXISTS rwa_redemptions (
    id           BIGINT PRIMARY KEY,
    token_id     BIGINT        NOT NULL,
    holder       TEXT          NOT NULL,
    units        NUMERIC(40,0) NOT NULL DEFAULT 0,
    denom        TEXT          NOT NULL DEFAULT '',
    payout       NUMERIC(40,0) NOT NULL DEFAULT 0,
    status       TEXT          NOT NULL DEFAULT 'REDEMPTION_STATUS_PENDING',
    requested_at BIGINT        NOT NULL DEFAULT 0,
    execute_after BIGINT       NOT NULL DEFAULT 0,
    resolved_at  BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rwa_redemptions_holder_idx ON rwa_redemptions (holder);

-- offering: Initial RWA Offering (IRO) --------------------------------------
CREATE TABLE IF NOT EXISTS offerings (
    id                 BIGINT PRIMARY KEY,
    token_id           BIGINT        NOT NULL DEFAULT 0,
    issuer             TEXT          NOT NULL DEFAULT '',
    denom              TEXT          NOT NULL DEFAULT '',
    unit_price         NUMERIC(40,0) NOT NULL DEFAULT 0,
    soft_cap           NUMERIC(40,0) NOT NULL DEFAULT 0,
    hard_cap           NUMERIC(40,0) NOT NULL DEFAULT 0,
    raised             NUMERIC(40,0) NOT NULL DEFAULT 0,
    start_time         BIGINT        NOT NULL DEFAULT 0,
    end_time           BIGINT        NOT NULL DEFAULT 0,
    status             TEXT          NOT NULL DEFAULT 'OFFERING_STATUS_OPEN',
    total_tranches     INT           NOT NULL DEFAULT 0,
    released_tranches  INT           NOT NULL DEFAULT 0,
    released_amount    NUMERIC(40,0) NOT NULL DEFAULT 0,
    injections_done    INT           NOT NULL DEFAULT 0,
    injected_total     NUMERIC(40,0) NOT NULL DEFAULT 0,
    required_injection NUMERIC(40,0) NOT NULL DEFAULT 0,
    injection_interval BIGINT        NOT NULL DEFAULT 0,
    allocated_units    NUMERIC(40,0) NOT NULL DEFAULT 0,
    default_treasury   NUMERIC(40,0) NOT NULL DEFAULT 0,
    treasury           NUMERIC(40,0) NOT NULL DEFAULT 0,
    returns_pool       NUMERIC(40,0) NOT NULL DEFAULT 0,
    succeeded_at       BIGINT        NOT NULL DEFAULT 0,
    created_at         BIGINT        NOT NULL DEFAULT 0,
    updated_at         BIGINT        NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS offering_subscriptions (
    offering_id     BIGINT        NOT NULL,
    investor        TEXT          NOT NULL,
    contributed     NUMERIC(40,0) NOT NULL DEFAULT 0,
    units           NUMERIC(40,0) NOT NULL DEFAULT 0,
    allocated       BOOLEAN       NOT NULL DEFAULT FALSE,
    returns_claimed NUMERIC(40,0) NOT NULL DEFAULT 0,
    refunded        BOOLEAN       NOT NULL DEFAULT FALSE,
    PRIMARY KEY (offering_id, investor)
);
CREATE INDEX IF NOT EXISTS offering_subscriptions_investor_idx ON offering_subscriptions (investor);

-- ===========================================================================
-- 交易 (trading)
-- ===========================================================================

-- market: frequent batch auction order book ---------------------------------
CREATE TABLE IF NOT EXISTS markets (
    id                  BIGINT PRIMARY KEY,
    base_denom          TEXT          NOT NULL DEFAULT '',
    quote_denom         TEXT          NOT NULL DEFAULT '',
    status              TEXT          NOT NULL DEFAULT 'MARKET_STATUS_ACTIVE',
    fee_bps             INT           NOT NULL DEFAULT 0,
    min_base_qty        NUMERIC(40,0) NOT NULL DEFAULT 0,
    batch_interval      BIGINT        NOT NULL DEFAULT 0,
    last_batch_time     BIGINT        NOT NULL DEFAULT 0,
    last_clearing_price NUMERIC(40,0) NOT NULL DEFAULT 0,
    created_at          BIGINT        NOT NULL DEFAULT 0,
    require_kyc         BOOLEAN       NOT NULL DEFAULT FALSE,
    policy_id           TEXT          NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
    id         BIGINT PRIMARY KEY,
    market_id  BIGINT        NOT NULL,
    owner      TEXT          NOT NULL,
    side       TEXT          NOT NULL,
    price      NUMERIC(40,0) NOT NULL DEFAULT 0,
    quantity   NUMERIC(40,0) NOT NULL DEFAULT 0,
    filled     NUMERIC(40,0) NOT NULL DEFAULT 0,
    escrowed   NUMERIC(40,0) NOT NULL DEFAULT 0,
    status     TEXT          NOT NULL DEFAULT 'ORDER_STATUS_OPEN',
    created_at BIGINT        NOT NULL DEFAULT 0,
    seq        BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_market_status_idx ON orders (market_id, status);
CREATE INDEX IF NOT EXISTS orders_owner_idx ON orders (owner);

-- per-batch uniform clearing prints (one "trade" per cleared batch) ----------
CREATE TABLE IF NOT EXISTS market_clears (
    market_id  BIGINT        NOT NULL,
    height     BIGINT        NOT NULL,
    block_time TIMESTAMPTZ   NOT NULL,
    price      NUMERIC(40,0) NOT NULL DEFAULT 0,
    qty        NUMERIC(40,0) NOT NULL DEFAULT 0,
    PRIMARY KEY (market_id, height)
);
CREATE INDEX IF NOT EXISTS market_clears_time_idx ON market_clears (market_id, block_time DESC);

-- order placement / cancel activity feed ------------------------------------
CREATE TABLE IF NOT EXISTS order_events (
    id         BIGSERIAL PRIMARY KEY,
    market_id  BIGINT        NOT NULL,
    order_id   BIGINT        NOT NULL,
    owner      TEXT          NOT NULL DEFAULT '',
    action     TEXT          NOT NULL,            -- place | cancel
    side       TEXT          NOT NULL DEFAULT '',
    price      NUMERIC(40,0) NOT NULL DEFAULT 0,
    qty        NUMERIC(40,0) NOT NULL DEFAULT 0,
    refunded   NUMERIC(40,0) NOT NULL DEFAULT 0,
    height     BIGINT        NOT NULL DEFAULT 0,
    tx_hash    TEXT          NOT NULL DEFAULT '',
    block_time TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_market_idx ON order_events (market_id, block_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS order_events_dedup_idx
    ON order_events (market_id, order_id, action, height);

-- mincast: bonding-curve markets --------------------------------------------
CREATE TABLE IF NOT EXISTS mincast_markets (
    id               BIGINT PRIMARY KEY,
    denom            TEXT          NOT NULL DEFAULT '',
    name             TEXT          NOT NULL DEFAULT '',
    admin            TEXT          NOT NULL DEFAULT '',
    settlement_denom TEXT          NOT NULL DEFAULT '',
    treasury         NUMERIC(40,0) NOT NULL DEFAULT 0,
    supply           NUMERIC(40,0) NOT NULL DEFAULT 0,
    initial_price    NUMERIC(40,0) NOT NULL DEFAULT 0,
    mint_fee_bps     INT           NOT NULL DEFAULT 0,
    melt_fee_bps     INT           NOT NULL DEFAULT 0,
    floor_price      NUMERIC(40,0) NOT NULL DEFAULT 0,
    status           TEXT          NOT NULL DEFAULT 'MARKET_STATUS_ACTIVE',
    policy_id        TEXT          NOT NULL DEFAULT '',
    require_kyc      BOOLEAN       NOT NULL DEFAULT FALSE,
    reward_pool      NUMERIC(40,0) NOT NULL DEFAULT 0,
    created_at       BIGINT        NOT NULL DEFAULT 0,
    updated_at       BIGINT        NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mincast_balances (
    market_id BIGINT        NOT NULL,
    holder    TEXT          NOT NULL,
    amount    NUMERIC(40,0) NOT NULL DEFAULT 0,
    PRIMARY KEY (market_id, holder)
);
CREATE INDEX IF NOT EXISTS mincast_balances_holder_idx ON mincast_balances (holder);

CREATE TABLE IF NOT EXISTS mincast_invests (
    id              BIGINT PRIMARY KEY,
    market_id       BIGINT        NOT NULL,
    investor        TEXT          NOT NULL,
    principal_units NUMERIC(40,0) NOT NULL DEFAULT 0,
    yield           NUMERIC(40,0) NOT NULL DEFAULT 0,
    apy_bps         INT           NOT NULL DEFAULT 0,
    opened_at       BIGINT        NOT NULL DEFAULT 0,
    maturity        BIGINT        NOT NULL DEFAULT 0,
    status          TEXT          NOT NULL DEFAULT 'INVEST_STATUS_ACTIVE',
    resolved_at     BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mincast_invests_investor_idx ON mincast_invests (investor);

CREATE TABLE IF NOT EXISTS mincast_trades (
    id         BIGSERIAL PRIMARY KEY,
    market_id  BIGINT        NOT NULL,
    action     TEXT          NOT NULL,            -- mint | melt
    account    TEXT          NOT NULL DEFAULT '',
    pay_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
    units      NUMERIC(40,0) NOT NULL DEFAULT 0,
    settlement NUMERIC(40,0) NOT NULL DEFAULT 0,
    fee        NUMERIC(40,0) NOT NULL DEFAULT 0,
    floor_price NUMERIC(40,0) NOT NULL DEFAULT 0,
    height     BIGINT        NOT NULL DEFAULT 0,
    tx_hash    TEXT          NOT NULL DEFAULT '',
    block_time TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mincast_trades_market_idx ON mincast_trades (market_id, block_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mincast_trades_dedup_idx
    ON mincast_trades (market_id, action, account, height, units);

-- ===========================================================================
-- 合规 / 能源数据 (compliance / energy)
-- ===========================================================================

-- identity: KYC / policy ----------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_accounts (
    address        TEXT PRIMARY KEY,
    did            TEXT    NOT NULL DEFAULT '',
    kyc_cleared    BOOLEAN NOT NULL DEFAULT FALSE,
    accredited     BOOLEAN NOT NULL DEFAULT FALSE,
    jurisdiction   TEXT    NOT NULL DEFAULT '',
    kyc_expires_at BIGINT  NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'ACCOUNT_STATUS_ACTIVE',
    registrar      TEXT    NOT NULL DEFAULT '',
    created_at     BIGINT  NOT NULL DEFAULT 0,
    updated_at     BIGINT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS identity_policies (
    id                    TEXT PRIMARY KEY,
    description           TEXT    NOT NULL DEFAULT '',
    require_kyc           BOOLEAN NOT NULL DEFAULT FALSE,
    require_accredited    BOOLEAN NOT NULL DEFAULT FALSE,
    deny_frozen           BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_jurisdictions TEXT[]  NOT NULL DEFAULT '{}',
    denied_jurisdictions  TEXT[]  NOT NULL DEFAULT '{}',
    paused                BOOLEAN NOT NULL DEFAULT FALSE,
    owner                 TEXT    NOT NULL DEFAULT '',
    created_at            BIGINT  NOT NULL DEFAULT 0,
    updated_at            BIGINT  NOT NULL DEFAULT 0
);

-- assethub: providers / devices / metering / oracle -------------------------
CREATE TABLE IF NOT EXISTS assethub_providers (
    address      TEXT PRIMARY KEY,
    role         TEXT          NOT NULL DEFAULT '',
    display_name TEXT          NOT NULL DEFAULT '',
    bond         NUMERIC(40,0) NOT NULL DEFAULT 0,
    status       TEXT          NOT NULL DEFAULT 'PROVIDER_STATUS_ACTIVE',
    infractions  INT           NOT NULL DEFAULT 0,
    jailed_until BIGINT        NOT NULL DEFAULT 0,
    created_at   BIGINT        NOT NULL DEFAULT 0,
    updated_at   BIGINT        NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assethub_devices (
    id               TEXT PRIMARY KEY,
    operator         TEXT   NOT NULL DEFAULT '',
    device_type      TEXT   NOT NULL DEFAULT '',
    pubkey           TEXT   NOT NULL DEFAULT '',
    jurisdiction     TEXT   NOT NULL DEFAULT '',
    attestation_hash TEXT   NOT NULL DEFAULT '',
    firmware         TEXT   NOT NULL DEFAULT '',
    status           TEXT   NOT NULL DEFAULT 'DEVICE_STATUS_ACTIVE',
    created_at       BIGINT NOT NULL DEFAULT 0,
    updated_at       BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS assethub_devices_operator_idx ON assethub_devices (operator);

CREATE TABLE IF NOT EXISTS assethub_readings (
    id                BIGINT PRIMARY KEY,
    device_id         TEXT          NOT NULL,
    period_start      BIGINT        NOT NULL DEFAULT 0,
    period_end        BIGINT        NOT NULL DEFAULT 0,
    unit              TEXT          NOT NULL DEFAULT '',
    iot_value         NUMERIC(40,0) NOT NULL DEFAULT 0,
    operational_value NUMERIC(40,0) NOT NULL DEFAULT 0,
    verified          BOOLEAN       NOT NULL DEFAULT FALSE,
    submitted_by      TEXT          NOT NULL DEFAULT '',
    submitted_at      BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS assethub_readings_device_idx ON assethub_readings (device_id, period_end DESC);

CREATE TABLE IF NOT EXISTS assethub_topics (
    id           TEXT PRIMARY KEY,
    description  TEXT          NOT NULL DEFAULT '',
    min_sources  INT           NOT NULL DEFAULT 0,
    value        NUMERIC(40,0) NOT NULL DEFAULT 0,
    source_count INT           NOT NULL DEFAULT 0,
    has_value    BOOLEAN       NOT NULL DEFAULT FALSE,
    updated_at   BIGINT        NOT NULL DEFAULT 0
);

-- ===========================================================================
-- 结算扩展 (bridge / automation streams)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS bridge_transfers (
    direction  TEXT          NOT NULL,            -- inbound | outbound
    id         BIGINT        NOT NULL,            -- nonce (outbound) or inbound id
    counterparty_chain BIGINT NOT NULL DEFAULT 0,
    party_addr TEXT          NOT NULL DEFAULT '', -- sender (outbound) or recipient (inbound)
    asset_id   BIGINT        NOT NULL DEFAULT 0,
    amount     NUMERIC(40,0) NOT NULL DEFAULT 0,
    status     TEXT          NOT NULL DEFAULT '',
    created_at BIGINT        NOT NULL DEFAULT 0,
    PRIMARY KEY (direction, id)
);
CREATE INDEX IF NOT EXISTS bridge_transfers_party_idx ON bridge_transfers (party_addr);

CREATE TABLE IF NOT EXISTS payment_streams (
    id          BIGINT PRIMARY KEY,
    sender      TEXT          NOT NULL DEFAULT '',
    receiver    TEXT          NOT NULL DEFAULT '',
    denom       TEXT          NOT NULL DEFAULT '',
    deposit     NUMERIC(40,0) NOT NULL DEFAULT 0,
    withdrawn   NUMERIC(40,0) NOT NULL DEFAULT 0,
    rate_per_sec NUMERIC(40,0) NOT NULL DEFAULT 0,
    start_time  BIGINT        NOT NULL DEFAULT 0,
    stop_time   BIGINT        NOT NULL DEFAULT 0,
    status      TEXT          NOT NULL DEFAULT 'STREAM_STATUS_ACTIVE'
);
CREATE INDEX IF NOT EXISTS payment_streams_receiver_idx ON payment_streams (receiver);
CREATE INDEX IF NOT EXISTS payment_streams_sender_idx ON payment_streams (sender);
