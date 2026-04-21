<h1 align="center">EnergyChain DEX</h1>

<p align="center">
  <em>Backend-driven AMM exchange on EnergyChain — Uniswap V2 contracts, a Go indexer + API, and a Next.js trading UI with live charts, swap, pools, portfolio, and farm.</em>
</p>

<p align="center">
  <a href="https://github.com/energychain-network/energychain-dex/actions"><img src="https://img.shields.io/github/actions/workflow/status/energychain-network/energychain-dex/ci.yml?branch=main" alt="CI"></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/go-1.22%2B-00ADD8?logo=go" alt="Go 1.22+"></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/next.js-14-000000?logo=next.js" alt="Next.js 14"></a>
  <a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/postgres-16%2BTimescale-336791?logo=postgresql" alt="Postgres 16 + TimescaleDB"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
</p>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Components](#components)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Contracts](#contracts)
- [REST API](#rest-api)
- [WebSocket protocol](#websocket-protocol)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Contributing](#contributing)
- [License](#license)

## Overview

A self-contained DeFi exchange purpose-built for EnergyChain. Smart-contract logic is a **Uniswap V2** fork; everything off-chain (price/candle history, top-of-book, portfolio aggregation, farm rewards) is computed by an in-house **Go indexer** that streams on-chain events into Postgres + TimescaleDB and pushes live updates over WebSocket.

The user-facing app is a **Next.js 14** application (App Router, Tailwind, wagmi + viem) covering swap, liquidity, pools, portfolio, candles, and farms — comparable in scope to a hosted DEX UI like SushiSwap or PancakeSwap.

## Features

- ✅ **Spot swap** with route splitting across multiple V2 pools.
- ✅ **Add / remove liquidity** for any whitelisted pair.
- ✅ **TradingView-style candles** (1 m / 5 m / 15 m / 1 h / 4 h / 1 d) generated from on-chain swaps.
- ✅ **Live order flow** over WebSocket — sub-second latency from block to UI.
- ✅ **Portfolio view** — token balances, LP positions, P&L estimates.
- ✅ **Farm staking** — LP-token staking with reward emissions.
- ✅ **Multicall-batched** reads for fast page loads.

## Architecture

```
                    ┌────────────────────────────────────────┐
                    │            energychaind node            │
                    │        EVM JSON-RPC :8545 / WS :8546    │
                    └───────────────┬────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       ┌──────────────┐    ┌──────────────┐      ┌────────────┐
       │ dex-indexer  │    │ dex-api      │      │  Redis     │
       │  (Go)        │───►│  (Go)        │◄─────┤  (cache    │
       │  - Sync,     │    │  REST + WS   │      │   + ws)    │
       │    Swap,     │    │  + candle agg│      └────────────┘
       │    Mint,Burn │    │              │
       │  - Reorg     │    └──────┬───────┘
       │    handling  │           │
       └──────┬───────┘           │ JSON / WS
              │                   ▼
        ┌─────▼─────┐      ┌────────────────────┐
        │ Postgres  │      │  dex-web           │
        │ +Timescale│      │  (Next.js 14)      │
        └───────────┘      │  swap / pools /    │
                           │  charts / farm     │
                           └────────────────────┘
```

## Components

| Path | Stack | Purpose |
|---|---|---|
| `indexer/` | Go 1.22 | Subscribes to V2 `Sync`, `Swap`, `Mint`, `Burn` events; rebuilds OHLCV; tracks LP positions. |
| `api/` | Go 1.22 (chi + pgx + nhooyr/websocket) | REST + WS server — pools, candles, swaps, farms, portfolio. |
| `web/` | Next.js 14 + Tailwind + wagmi + viem + lightweight-charts | Trader UI. |
| `sdk/` | TypeScript | Client library (used by `web/` and external integrators). |
| `contracts-abi/` | JSON | Pinned ABIs that match the deployed contracts. |

## Quick start

> Requirements: **Go 1.22**, **Node 20**, **Postgres 16 + TimescaleDB**, **Redis 7**, a running EnergyChain node (or any EVM-compatible RPC).

```bash
git clone https://github.com/energychain-network/energychain-dex.git
cd energychain-dex
make deps

# 1. database
psql -h localhost -U postgres -f indexer/migrations/0001_init.sql

# 2. point at a chain + contracts
export DEX_PG_DSN="postgres://dex:dex@localhost:5432/energy_dex"
export DEX_REDIS_URL="redis://localhost:6379/1"
export DEX_EVM_WS="ws://localhost:8546"
export DEX_FACTORY_ADDR=0x...    # see energychain-contracts deployment
export DEX_ROUTER_ADDR=0x...
export DEX_WECY_ADDR=0x...

# 3. run services
make run-indexer
make run-api

# 4. UI
cd web
cp .env.example .env.local       # set NEXT_PUBLIC_DEX_API_BASE / _DEX_WS / _CHAIN_ID
npm ci && npm run dev            # http://localhost:3001
```

## Configuration

All services are configured via environment variables. The complete list lives in [`docs/config.md`](./docs/config.md). The most-used:

| Var | Default | Description |
|---|---|---|
| `DEX_CHAIN_ID` | `9001` | EVM chain id for signed-msg validation. |
| `DEX_PG_DSN` | _required_ | Postgres DSN. |
| `DEX_REDIS_URL` | _required_ | Redis URL for cache + WS pub/sub. |
| `DEX_EVM_WS` | `ws://localhost:8546` | EVM WebSocket source. |
| `DEX_API_BIND` | `:8081` | API listen address. |
| `DEX_FACTORY_ADDR` / `DEX_ROUTER_ADDR` / `DEX_WECY_ADDR` | _required_ | Core contract addresses. |
| `NEXT_PUBLIC_DEX_API_BASE` | _required_ | Browser-side REST URL. |
| `NEXT_PUBLIC_DEX_WS` | _required_ | Browser-side WS URL. |

## Contracts

Smart contracts (Factory, Router, Pair, WECY, test tokens) are **not** in this repository — they live in [`energychain-contracts`](https://github.com/energychain-network/energychain-contracts). This repo only ships the pinned ABIs needed by the indexer and SDK (under [`contracts-abi/`](./contracts-abi/)).

## REST API

```
GET  /v1/pools
GET  /v1/pools/{address}
GET  /v1/pools/{address}/candles?interval=1h&from=...&to=...
GET  /v1/swaps?pool=0x...
GET  /v1/portfolio/{address}
GET  /v1/farms
POST /v1/quote                     # off-chain price quote (advisory)
```

Full OpenAPI spec: [`docs/rest-api.md`](./docs/rest-api.md).

## WebSocket protocol

```json
{ "id": 1, "method": "subscribe", "params": ["pool.swaps", "0xPoolAddr"] }
{ "id": 2, "method": "subscribe", "params": ["pool.candles", "0xPoolAddr", "1m"] }
```

The server pushes `{ "channel": "...", "data": { ... } }` frames as new on-chain data is indexed.

## Deployment

A docker-compose reference deployment is in [`deploy/compose/`](./deploy/compose/). Production deployment manifests (systemd units, nginx, monitoring) live in [`energychain-ops`](https://github.com/energychain-network/energychain-ops).

## Repository layout

```
api/             # Go REST + WS service
indexer/         # Go event indexer
sdk/             # TypeScript client SDK
web/             # Next.js front-end
contracts-abi/   # pinned ABIs (mirrored from energychain-contracts)
deploy/          # reference docker-compose deploy
docs/            # config / API / data-model docs
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributors must abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE). The on-chain contracts (in [`energychain-contracts`](https://github.com/energychain-network/energychain-contracts)) are derived from `Uniswap/v2-*`; see attribution headers there.
