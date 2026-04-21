DROP INDEX IF EXISTS idx_api_keys_owner;
ALTER TABLE api_keys
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS owner;
