-- Self-service API key ownership.
--
-- Until now api_keys was an ops-only table populated out-of-band.  We add an
-- `owner` column (the EVM address that signed the issuance challenge) plus a
-- supporting index so the /api-keys self-service UI can list and revoke a
-- user's own keys without touching unrelated rows.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS owner BYTEA,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner) WHERE owner IS NOT NULL;
