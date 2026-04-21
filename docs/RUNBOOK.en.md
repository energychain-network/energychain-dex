# EnergySwap DEX Runbook (English)

Operational guide for the full DEX stack under `dex/` (dex-indexer, dex-api,
dex-web, PostgreSQL+TimescaleDB, Redis, Prometheus, Grafana, Nginx). The goal
is to let any SRE keep the service healthy, ship hotfixes and recover from
incidents without paging the original author.

## 1. Topology

```
EVM chain ──JSON-RPC──▶ dex-indexer ──▶ Postgres+TimescaleDB
                              │
                              ▼  Redis pub/sub
                          dex-api ──▶ dex-web
```

All services are wired together by `dex/deploy/docker-compose.yml`. Metrics
are scraped by Prometheus and visualised in Grafana. Nginx fronts the API,
WebSocket and the Next.js app on a single domain.

## 2. First-time deploy

```bash
cd dex/deploy
cp .env.example .env             # fill RPC, contract addresses, domain, email
docker compose pull
docker compose run --rm migrate  # apply schema once
docker compose up -d
docker compose logs -f indexer api
```

Health checks:

| URL                                  | Expected |
| ------------------------------------ | -------- |
| `https://<domain>/api/v1/overview`   | `200`    |
| `https://<domain>/`                  | landing renders |
| `http://<host>:9091/-/healthy`       | `200`    |
| `http://<host>:3001/api/health`      | `ok`     |

## 3. Daily checks

1. Grafana “DEX Overview” dashboard:
   - indexer lag < 30 blocks;
   - API p95 < 200 ms;
   - 24h volume matches expectations;
   - Postgres connections < 80% of pool.
2. Alerts: `http://<host>:9091/alerts` should be all green.
3. Spot check: `select count(*) from swaps where block_time > now() - interval '1h';`
   should be in the same ballpark as on-chain `Swap` events.

## 4. Upgrades

Blue/green rollout:

```bash
git pull
cd dex/deploy
docker compose build api web indexer
docker compose up -d --no-deps --remove-orphans api web indexer
docker compose ps
docker image prune -f
```

If only the web layer changed, you can keep the indexer running. Schema
changes must run `migrate` first:

```bash
docker compose run --rm migrate -path /migrations -database "$PG_DSN" up
```

## 5. Reorg and data repair

- The indexer keeps a 32-block confirmation buffer, so shallow reorgs are
  handled transparently.
- For deep reorgs or external corruption, replay from a safe height:
  ```bash
  docker compose stop indexer
  psql "$PG_DSN" -c "UPDATE indexer_cursor SET height = <safe_height> WHERE chain_id = <id>;"
  docker compose start indexer
  ```
- During replay the API keeps serving the previous snapshot; the UI shows a
  stale-data warning if `updated_at` lags head by > 5 minutes.

## 6. Backups

- Postgres: nightly `pg_basebackup` plus WAL archive to S3, 14-day retention.
- Redis: pure cache, no backup.
- `.env` and config: stored in a private git repo with SOPS-encrypted secrets.

Restore drill: every quarter, restore latest base + WAL into a sandbox VPC
and run `make verify` to compare the last 1000 swaps with on-chain logs.

## 7. Common incidents

| Symptom                                         | Triage |
| ----------------------------------------------- | ------ |
| Overview frozen on an old timestamp             | Check indexer logs / `indexer_cursor`. Usually RPC stall. |
| `/quote` returns 404                            | Verify token addresses, confirm a path exists in `pairs`. |
| Charts have no candles                          | Inspect `ohlcv` for that pair+granularity; rerun aggregator if missing. |
| WebSocket disconnects rapidly                   | Make sure Nginx `proxy_read_timeout` ≥ 60s and sticky sessions are on. |
| Postgres connection exhaustion                  | `SELECT pid, query FROM pg_stat_activity WHERE state='active';` — kill long queries. |

## 8. Contact matrix

- On-call primary: `#dex-oncall` (Slack)
- DBA: `#data-platform`
- Chain incidents: `#chain-core`
- Security: `security@energychain.io`
