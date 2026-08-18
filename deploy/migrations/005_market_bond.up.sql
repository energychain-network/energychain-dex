-- market listing bond: operator posts params.listing_bond to open trading
-- (PENDING_BOND -> ACTIVE); refunded on governance delisting (DELISTED).
ALTER TABLE markets ADD COLUMN IF NOT EXISTS operator    TEXT          NOT NULL DEFAULT '';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS bond_amount NUMERIC(78,0) NOT NULL DEFAULT 0;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS bond_denom  TEXT          NOT NULL DEFAULT '';
