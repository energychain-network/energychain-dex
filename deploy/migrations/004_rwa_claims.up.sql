-- Per-holder snapshot balances (frozen at TakeSnapshot) and dividend claims.

CREATE TABLE IF NOT EXISTS rwa_snapshot_balances (
    snapshot_id BIGINT        NOT NULL,
    holder      TEXT          NOT NULL,
    amount      NUMERIC(40,0) NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_id, holder)
);
CREATE INDEX IF NOT EXISTS rwa_snapshot_balances_snapshot_idx ON rwa_snapshot_balances (snapshot_id);

CREATE TABLE IF NOT EXISTS rwa_distribution_claims (
    distribution_id BIGINT        NOT NULL,
    holder          TEXT          NOT NULL,
    amount          NUMERIC(40,0) NOT NULL DEFAULT 0,
    claimed_at      BIGINT        NOT NULL DEFAULT 0,
    PRIMARY KEY (distribution_id, holder)
);
CREATE INDEX IF NOT EXISTS rwa_distribution_claims_dist_idx ON rwa_distribution_claims (distribution_id);
