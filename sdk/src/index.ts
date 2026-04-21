// @energychain/dex-sdk
//
// Thin, dependency-free TypeScript client for the EnergyChain DEX backend.
// Works in browsers (uses native fetch + WebSocket) and Node.js >= 18 (native
// fetch). For Node < 22 you may pass a `WebSocket` ctor (e.g. from the `ws`
// package) via `new DexClient({ WebSocketImpl })` to enable streaming.

export type Hex = `0x${string}`;

export interface Overview {
  chain_id: number;
  pairs: number;
  tokens: number;
  volume_usd_24h: string;
  tvl_usd: string;
  trades_24h: number;
  updated_at: number;
}

export interface Pair {
  address: Hex;
  token0: Hex;
  token1: Hex;
  symbol0: string;
  symbol1: string;
  reserve0: string;
  reserve1: string;
  volume_usd_24h: string;
  fees_usd_24h: string;
  tvl_usd: string;
  apr_24h: string;
  price0_usd: string;
  price1_usd: string;
  created_height: number;
  created_at: number;
}

export interface Candle {
  t: number;
  o: string; h: string; l: string; c: string;
  v: string; v_usd: string; n: number;
}

export interface Token {
  address: Hex;
  symbol: string;
  name: string;
  decimals: number;
  total_supply: string;
  wrapped_native: boolean;
  stablecoin: boolean;
  trust_score: number;
  logo_url: string;
  price_usd: string;
  volume_usd_24h: string;
}

export interface Quote {
  token_in: Hex;
  token_out: Hex;
  amount_in: string;
  amount_out: string;
  price_impact: string;
  path: Hex[];
  pairs: Hex[];
  hops: number;
  fee_bps_total: number;
}

export type Granularity = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface DexClientOptions {
  /** Base URL, e.g. `https://dex.example.com`. The SDK will append `/api/v1`. */
  baseUrl: string;
  /** Optional API key for authenticated routes / higher rate limits. */
  apiKey?: string;
  /** Custom WebSocket constructor (Node fallback). */
  WebSocketImpl?: typeof WebSocket;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export class DexClient {
  private base: string;
  private apiKey?: string;
  private fetchImpl: typeof fetch;
  private WS?: typeof WebSocket;

  constructor(opts: DexClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '') + '/api/v1';
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    if (!this.fetchImpl) throw new Error('fetch is not available; pass `fetchImpl`');
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const res = await this.fetchImpl(this.base + path, { ...init, headers });
    if (!res.ok) {
      let detail = '';
      try { detail = ((await res.json()) as any)?.error || ''; } catch {}
      throw new DexApiError(res.status, `${res.status} ${res.statusText}${detail ? ': ' + detail : ''}`);
    }
    return res.json() as Promise<T>;
  }

  overview(): Promise<Overview> { return this.req('/overview'); }
  listPairs(opts: { sort?: 'tvl' | 'volume' | 'apr' | 'new'; limit?: number; offset?: number } = {}): Promise<{ items: Pair[]; limit: number; offset: number }> {
    const q = new URLSearchParams();
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.offset) q.set('offset', String(opts.offset));
    const qs = q.toString();
    return this.req(`/pairs${qs ? '?' + qs : ''}`);
  }
  getPair(address: Hex): Promise<Pair> { return this.req(`/pairs/${address}`); }
  candles(address: Hex, opts: { granularity?: Granularity; limit?: number } = {}): Promise<{ items: Candle[]; granularity: Granularity }> {
    const q = new URLSearchParams();
    if (opts.granularity) q.set('granularity', opts.granularity);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return this.req(`/pairs/${address}/candles${qs ? '?' + qs : ''}`);
  }
  pairSwaps(address: Hex, limit = 50): Promise<{ items: any[] }> { return this.req(`/pairs/${address}/swaps?limit=${limit}`); }
  pairLiquidityEvents(address: Hex, limit = 50): Promise<{ items: any[] }> { return this.req(`/pairs/${address}/liquidity?limit=${limit}`); }
  recentSwaps(limit = 50): Promise<{ items: any[] }> { return this.req(`/swaps?limit=${limit}`); }

  listTokens(limit = 100): Promise<{ items: Token[] }> { return this.req(`/tokens?limit=${limit}`); }
  getToken(address: Hex): Promise<Token> { return this.req(`/tokens/${address}`); }

  quote(req: { token_in: Hex; token_out: Hex; amount_in: string; max_hops?: number }): Promise<Quote> {
    return this.req('/quote', { method: 'POST', body: JSON.stringify(req) });
  }
  portfolio(owner: Hex): Promise<{ owner: Hex; positions: any[]; swaps: any[] }> { return this.req(`/portfolio/${owner}`); }
  search(q: string): Promise<{ items: { kind: 'pair' | 'token' | 'tx'; id: Hex; title: string; subtitle: string; rank: number }[] }> {
    return this.req(`/search?q=${encodeURIComponent(q)}`);
  }

  /** Subscribe to a WebSocket channel and return an unsubscribe function. */
  subscribe<T = unknown>(channels: string[], onMessage: (msg: { channel: string; data: T }) => void, onError?: (e: unknown) => void): () => void {
    if (!this.WS) throw new Error('No WebSocket implementation available; pass `WebSocketImpl`');
    // The WS hub lives at the API origin under /ws — *not* under /api/v1. We
    // also have to map https→wss (don't accidentally produce wsss) and http→ws.
    const wsUrl = this.base.replace(/\/api\/v1$/, '/ws').replace(/^https/, 'wss').replace(/^http/, 'ws');
    const ws = new this.WS(wsUrl);
    // Server protocol: { op: 'sub' | 'unsub', ch: string[] }
    const send = () => ws.send(JSON.stringify({ op: 'sub', ch: channels }));
    ws.addEventListener('open', send);
    ws.addEventListener('message', (e: MessageEvent) => {
      try {
        const m = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
        if (m && m.channel) onMessage(m as any);
      } catch (err) { onError?.(err); }
    });
    if (onError) ws.addEventListener('error', (e: Event) => onError(e));
    return () => {
      try { ws.send(JSON.stringify({ op: 'unsub', ch: channels })); } catch {}
      try { ws.close(); } catch {}
    };
  }
}

export class DexApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'DexApiError'; }
}

export default DexClient;
