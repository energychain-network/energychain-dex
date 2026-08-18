# EnergyChain Native Layer — Operations Runbook

This document covers the native Cosmos module integration that reorients the DEX
around the `energychain-node` custom modules (`stableusd`, `rwatoken`,
`offering`, `mincast`, `market`, `identity`, `assethub`) instead of the legacy
EVM Uniswap V2 fork. The EVM stack still ships but is demoted to the
"DEX (EVM)" navigation group.

## Architecture

```
energychain-node
 ├─ CometBFT RPC  :26657   block events (time-series: clears, trades, transfers)
 └─ gRPC-gateway  :1317    REST state snapshots + cosmos.tx broadcast/simulate
        │
        ▼
 dex-indexer ──► Postgres (003_native.* tables) ──► dex-api (/api/v1/native …)
        │                                                  │
        └─ Redis pub/sub (dex:orders|clears|trades|…) ─────┴──► WebSocket ──► web (Keplr/CosmJS)
```

- **Indexer** (`indexer/internal/cosmosrunner`): per-height block scan for
  events + a slow (30s) REST snapshot loop for authoritative entity state. The
  cursor is a single high-water height in `cosmos_cursor` (Cosmos blocks are
  final — no reorg rewind).
- **API** (`api/internal/handlers/native.go`): read endpoints served from the
  Postgres mirror; live passthrough for balances, mincast quotes,
  `EvaluateTransfer`, and tx simulate/broadcast.
- **Web**: reads via `lib/native-api.ts`; writes via Keplr + CosmJS
  (`lib/cosmos.ts`, `lib/cosmos-msgs.ts`, `lib/proto.ts`). The browser signs
  locally and broadcasts through the CometBFT RPC.

## Enabling the native layer

Set in `deploy/.env` (see `.env.example` for the full list):

```
DEX_COSMOS_ENABLED=true
DEX_COSMOS_RPC=http://<node>:26657
DEX_COSMOS_REST=http://<node>:1317
DEX_EVM_ENABLED=true            # set false to run native-only
# web:
NEXT_PUBLIC_DEX_COSMOS_CHAIN_ID=energychain_9001-1
NEXT_PUBLIC_DEX_COSMOS_RPC=http://<node>:26657
NEXT_PUBLIC_BECH32_PREFIX=energy
NEXT_PUBLIC_NATIVE_DENOM=uecy
```

`DEX_EVM_ENABLED` and `DEX_COSMOS_ENABLED` are independent; at least one must be
true or the indexer/api refuse to start.

## Bring-up

```bash
cd deploy
cp .env.example .env          # edit cosmos endpoints
docker compose --profile migrate up migrate   # applies 001..003 incl. 003_native
docker compose up -d postgres redis indexer api web
```

Verify:

- `curl localhost:8081/api/v1/markets` → `{ "items": [...] }`
- `curl localhost:8081/api/v1/native/config` → chain id / prefix
- Indexer metrics: `curl localhost:9100/metrics | grep dex_indexer_cosmos`
  - `dex_indexer_cosmos_height` should track the chain tip.
  - `dex_indexer_cosmos_snapshot_errors_total` should stay flat.

## Health / readiness

`/readyz` on the indexer (`:9100`) fails once the last processed block is older
than 60s (`metrics.LastBlockTime`). For a Cosmos-only deployment this is driven
by the cosmos runner; for a dual deployment the EVM and cosmos runners share the
gauge, so readiness reflects whichever ticked most recently.

## Data model notes

- on-chain `uint64` amounts/prices → `NUMERIC(40,0)` (uint64 overflows int8).
- ids/sequences/heights/unix-times → `BIGINT`.
- proto enums → `TEXT` storing the proto enum name (e.g. `ORDER_STATUS_OPEN`).
- Balances are event-derived caches (`*_balances` tables); compliance
  force-transfers (which omit amounts from events) trigger an authoritative
  re-query of the affected accounts.

## Event sources

| Module     | time-series events                                   | snapshot query                              |
|------------|------------------------------------------------------|---------------------------------------------|
| market     | `market_clear`, `market_order`                       | `Markets` + `OrderBook`                      |
| mincast    | `mincast_trade`, `mincast_transfer`, `mincast_invest`| `Markets` + `RewardPool`                     |
| stableusd  | `stableusd_supply|transfer|compliance|redemption`    | `Denoms` + `Supply`                          |
| rwatoken   | `rwatoken_supply|transfer|compliance|distribution|redemption` | `Tokens` + `PoolBalance`           |
| offering   | (snapshot-driven)                                    | `Offerings` + `SubscriptionsByOffering`      |
| identity   | (snapshot-driven)                                    | `Accounts` + `Policies`                      |
| assethub   | (snapshot-driven)                                    | `Providers` + `Devices` + `Topics` + readings|

## Transaction signing

The web app builds messages from `lib/cosmos-msgs.ts` (type URL + scalar field
spec) and a dependency-free proto3 encoder (`lib/proto.ts`). CosmJS wraps these
in the Tx envelope and broadcasts via RPC with `gasPrice` auto-estimation. If a
new Msg is added on-chain, add its type URL + field layout to `MSGS` — field
numbers/types must match `chain/proto/energychain/<module>/v1/tx.proto`.

## Known gaps / follow-ups

- **bridge / automation**: `003_native.sql` provisions `bridge_transfers` and
  `payment_streams`, but indexer handlers, API endpoints and UI are not yet
  wired (event/proto names need confirmation against the node release). Track as
  Phase 4 remaining.
- **Bundle size**: CosmJS adds ~700kB to the trade/issue routes. Consider a
  dynamic `import()` of `lib/cosmos.ts` behind the connect action if first-load
  JS becomes a concern.
- **EVM sunset**: once native parity is confirmed in production, decide whether
  to fully retire the `/swap /pools /tokens /charts /farm` routes or keep them
  behind the "DEX (EVM)" menu.
