-- EnergyChain DEX schema. Designed for a single-writer (indexer) topology.
-- All numeric fields that originate from EVM uint256 use NUMERIC(78,0) so we
-- never lose precision; the API layer is responsible for downsampling for the
-- wire format.

-- TimescaleDB is optional. When the extension is available we promote the
-- swaps / liquidity_events / ohlcv tables to hypertables for chunked storage
-- and faster recent-window queries. When it is not (e.g. running against a
-- vanilla host Postgres for local QA) the tables remain plain heap tables and
-- everything keeps working — just without time-based chunking.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS timescaledb';
  END IF;
END$$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
-- pgcrypto provides digest() used by the API-key lookup.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Cursor / progress tracking. The indexer keeps a single row per logical
-- stream so we can resume after restarts and detect reorgs.
-- ---------------------------------------------------------------------------
CREATE TABLE indexer_cursor (
  stream      TEXT PRIMARY KEY,
  height      BIGINT NOT NULL,
  block_hash  BYTEA  NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Tokens: ERC-20 metadata cache. Decimals/symbol/name are read from the
-- contract once and refreshed on demand.
-- ---------------------------------------------------------------------------
CREATE TABLE tokens (
  chain_id      INTEGER NOT NULL,
  address       BYTEA   NOT NULL,
  symbol        TEXT    NOT NULL DEFAULT '',
  name          TEXT    NOT NULL DEFAULT '',
  decimals      SMALLINT NOT NULL DEFAULT 18,
  total_supply  NUMERIC(78,0) NOT NULL DEFAULT 0,
  is_wrapped_native BOOLEAN NOT NULL DEFAULT FALSE,
  is_stablecoin BOOLEAN NOT NULL DEFAULT FALSE,
  logo_uri      TEXT    NOT NULL DEFAULT '',
  trust_score   SMALLINT NOT NULL DEFAULT 0, -- 0=unknown, 1=auto, 2=verified
  first_seen_height BIGINT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX tokens_symbol_trgm ON tokens USING GIN (symbol gin_trgm_ops);
CREATE INDEX tokens_name_trgm   ON tokens USING GIN (name   gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Pairs: every UniswapV2 Pair contract spawned from the Factory.
-- ---------------------------------------------------------------------------
CREATE TABLE pairs (
  chain_id        INTEGER NOT NULL,
  address         BYTEA   NOT NULL,
  factory         BYTEA   NOT NULL,
  token0          BYTEA   NOT NULL,
  token1          BYTEA   NOT NULL,
  fee_bps         INTEGER NOT NULL DEFAULT 30, -- UniV2 = 0.30%
  created_height  BIGINT  NOT NULL,
  created_tx      BYTEA   NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  -- Hot state (written by Sync events). Storing it here keeps the pair list
  -- fast — no join required for the front page.
  reserve0        NUMERIC(78,0) NOT NULL DEFAULT 0,
  reserve1        NUMERIC(78,0) NOT NULL DEFAULT 0,
  last_sync_height BIGINT NOT NULL DEFAULT 0,
  -- Rolling 24 h aggregates (refreshed by indexer's window job).
  volume_usd_24h  NUMERIC(38,8) NOT NULL DEFAULT 0,
  fees_usd_24h    NUMERIC(38,8) NOT NULL DEFAULT 0,
  tvl_usd         NUMERIC(38,8) NOT NULL DEFAULT 0,
  price0_usd      NUMERIC(38,18) NOT NULL DEFAULT 0,
  price1_usd      NUMERIC(38,18) NOT NULL DEFAULT 0,
  apr_24h         NUMERIC(10,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX pairs_token0   ON pairs (chain_id, token0);
CREATE INDEX pairs_token1   ON pairs (chain_id, token1);
CREATE INDEX pairs_tvl      ON pairs (chain_id, tvl_usd DESC);
CREATE INDEX pairs_volume   ON pairs (chain_id, volume_usd_24h DESC);

-- ---------------------------------------------------------------------------
-- Swaps: hypertable. One row per Swap event.
-- ---------------------------------------------------------------------------
CREATE TABLE swaps (
  chain_id     INTEGER NOT NULL,
  pair         BYTEA   NOT NULL,
  block_time   TIMESTAMPTZ NOT NULL,
  height       BIGINT  NOT NULL,
  tx_hash      BYTEA   NOT NULL,
  log_index    INTEGER NOT NULL,
  sender       BYTEA   NOT NULL,
  recipient    BYTEA   NOT NULL,
  amount0_in   NUMERIC(78,0) NOT NULL,
  amount1_in   NUMERIC(78,0) NOT NULL,
  amount0_out  NUMERIC(78,0) NOT NULL,
  amount1_out  NUMERIC(78,0) NOT NULL,
  -- Pre-computed for downstream queries; saves work on every chart load.
  side         SMALLINT NOT NULL,                  -- 0=buy token0, 1=sell token0
  price        NUMERIC(38,18) NOT NULL DEFAULT 0,  -- token1 per token0 at this trade
  amount_usd   NUMERIC(38,8)  NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, pair, block_time, log_index)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('swaps', 'block_time', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
  END IF;
END$$;
CREATE INDEX swaps_pair_time   ON swaps (chain_id, pair, block_time DESC);
CREATE INDEX swaps_sender_time ON swaps (chain_id, sender, block_time DESC);
CREATE INDEX swaps_tx          ON swaps (chain_id, tx_hash);

-- ---------------------------------------------------------------------------
-- Liquidity events (Mint / Burn).
-- ---------------------------------------------------------------------------
CREATE TYPE liquidity_kind AS ENUM ('mint', 'burn');
CREATE TABLE liquidity_events (
  chain_id    INTEGER NOT NULL,
  pair        BYTEA   NOT NULL,
  block_time  TIMESTAMPTZ NOT NULL,
  height      BIGINT  NOT NULL,
  tx_hash     BYTEA   NOT NULL,
  log_index   INTEGER NOT NULL,
  kind        liquidity_kind NOT NULL,
  provider    BYTEA   NOT NULL,
  amount0     NUMERIC(78,0) NOT NULL,
  amount1     NUMERIC(78,0) NOT NULL,
  liquidity   NUMERIC(78,0) NOT NULL,             -- LP-token delta (Mint: positive, Burn: negative magnitude in source event but stored absolute)
  amount_usd  NUMERIC(38,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, pair, block_time, log_index)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('liquidity_events', 'block_time', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
  END IF;
END$$;
CREATE INDEX liq_pair_time     ON liquidity_events (chain_id, pair, block_time DESC);
CREATE INDEX liq_provider_time ON liquidity_events (chain_id, provider, block_time DESC);

-- ---------------------------------------------------------------------------
-- LP positions: one row per (pair, owner). Updated on every Mint/Burn/Transfer.
-- ---------------------------------------------------------------------------
CREATE TABLE lp_positions (
  chain_id   INTEGER NOT NULL,
  pair       BYTEA   NOT NULL,
  owner      BYTEA   NOT NULL,
  liquidity  NUMERIC(78,0) NOT NULL DEFAULT 0,
  -- For PnL calculations:
  cost_basis_usd NUMERIC(38,8) NOT NULL DEFAULT 0,
  realized_pnl_usd NUMERIC(38,8) NOT NULL DEFAULT 0,
  first_seen_height BIGINT NOT NULL,
  updated_height    BIGINT NOT NULL,
  PRIMARY KEY (chain_id, pair, owner)
);
CREATE INDEX lp_owner ON lp_positions (chain_id, owner) WHERE liquidity > 0;

-- ---------------------------------------------------------------------------
-- OHLCV candles. Stored per (pair, granularity) and per token-side
-- (token0 priced in token1 only — quote-side aggregation is the API's job).
-- ---------------------------------------------------------------------------
CREATE TABLE ohlcv (
  chain_id    INTEGER NOT NULL,
  pair        BYTEA   NOT NULL,
  granularity TEXT    NOT NULL,        -- '1m','5m','15m','1h','4h','1d','1w'
  bucket      TIMESTAMPTZ NOT NULL,
  open        NUMERIC(38,18) NOT NULL,
  high        NUMERIC(38,18) NOT NULL,
  low         NUMERIC(38,18) NOT NULL,
  close       NUMERIC(38,18) NOT NULL,
  volume0     NUMERIC(78,0)  NOT NULL,
  volume1     NUMERIC(78,0)  NOT NULL,
  volume_usd  NUMERIC(38,8)  NOT NULL,
  trades      INTEGER NOT NULL,
  PRIMARY KEY (chain_id, pair, granularity, bucket)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('ohlcv', 'bucket', chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END$$;
CREATE INDEX ohlcv_lookup ON ohlcv (chain_id, pair, granularity, bucket DESC);

-- ---------------------------------------------------------------------------
-- Token-level rollups (24h volume / TVL / holder count). Refreshed by an
-- indexer job; the API only reads.
-- ---------------------------------------------------------------------------
CREATE TABLE token_stats (
  chain_id    INTEGER NOT NULL,
  token       BYTEA   NOT NULL,
  bucket      DATE    NOT NULL,
  volume_usd  NUMERIC(38,8) NOT NULL DEFAULT 0,
  tvl_usd     NUMERIC(38,8) NOT NULL DEFAULT 0,
  holders     INTEGER NOT NULL DEFAULT 0,
  trades      INTEGER NOT NULL DEFAULT 0,
  txs         INTEGER NOT NULL DEFAULT 0,
  unique_traders INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, token, bucket)
);

-- ---------------------------------------------------------------------------
-- API keys (mirror of explorer's table; isolated DB so we re-create here).
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
  key_hash    BYTEA PRIMARY KEY,                  -- sha256 of the raw key
  label       TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'public',     -- public|partner|internal
  rate_per_min INTEGER NOT NULL DEFAULT 60,
  burst       INTEGER NOT NULL DEFAULT 120,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Search materialized view (token + pair text search).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW search_index AS
SELECT
  'token'::text AS kind,
  t.chain_id,
  encode(t.address, 'hex') AS id,
  t.symbol AS title,
  t.name AS subtitle,
  t.trust_score AS rank
FROM tokens t
UNION ALL
SELECT
  'pair'::text,
  p.chain_id,
  encode(p.address, 'hex'),
  COALESCE(t0.symbol, '') || '/' || COALESCE(t1.symbol, ''),
  encode(p.address, 'hex'),
  CASE WHEN p.tvl_usd > 0 THEN 5 ELSE 1 END
FROM pairs p
LEFT JOIN tokens t0 ON t0.chain_id = p.chain_id AND t0.address = p.token0
LEFT JOIN tokens t1 ON t1.chain_id = p.chain_id AND t1.address = p.token1;

CREATE INDEX search_title_trgm ON search_index USING GIN (title gin_trgm_ops);
CREATE INDEX search_id_idx     ON search_index (chain_id, id);
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY (PostgreSQL constraint).
CREATE UNIQUE INDEX search_unique ON search_index (kind, chain_id, id);
