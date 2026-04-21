# @energychain/dex-sdk

A small, dependency-free TypeScript client for the EnergyChain DEX backend
(REST + WebSocket).

## Install

```bash
npm i @energychain/dex-sdk
# Node < 22 only:
npm i ws
```

## Usage

```ts
import { DexClient } from '@energychain/dex-sdk';

const dex = new DexClient({ baseUrl: 'https://dex.example.com' });

const top = await dex.listPairs({ sort: 'tvl', limit: 20 });
const candles = await dex.candles(top.items[0].address, { granularity: '1h', limit: 200 });

const stop = dex.subscribe(['dex:swaps'], ({ channel, data }) => {
  console.log(channel, data);
});
// later: stop();
```

### Node < 22

```ts
import { DexClient } from '@energychain/dex-sdk';
import WebSocket from 'ws';

const dex = new DexClient({ baseUrl: 'https://dex.example.com', WebSocketImpl: WebSocket as any });
```

## Channels

- `dex:swaps` — every accepted swap, fanned out from the indexer.
- `dex:pairs` — pair metadata / reserves updates.
- `dex:ohlcv:<pair>` — bucketed candle updates for the given pair.
- `dex:tokens` — token statistics refreshes.

## Stability

- HTTP responses are versioned under `/api/v1`. Breaking changes require a new
  major version of both this SDK and the API.
- All numeric fields are returned as strings to keep precision; convert with
  `BigInt()` or your favourite decimal library before doing arithmetic.
