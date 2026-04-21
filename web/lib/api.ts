// Single thin client around the DEX API. All paths are routed through Next.js
// rewrites (`/api-proxy/*`) in the browser to avoid CORS and to make the API
// origin configurable at deploy time.

const isBrowser = typeof window !== 'undefined';
const SERVER_BASE =
  process.env.DEX_API_INTERNAL_BASE ||
  process.env.NEXT_PUBLIC_DEX_API_BASE ||
  'http://localhost:8081';

function url(path: string) {
  if (isBrowser) return `/api-proxy${path}`;
  return `${SERVER_BASE}/api/v1${path}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch {}
    throw new Error(`${res.status} ${res.statusText}${detail ? ': ' + detail : ''}`);
  }
  return res.json() as Promise<T>;
}

export type Overview = {
  chain_id: number;
  pairs: number;
  tokens: number;
  volume_usd_24h: string;
  tvl_usd: string;
  trades_24h: number;
  updated_at: number;
};

export type Pair = {
  address: string;
  token0: string;
  token1: string;
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
};

export type Candle = {
  t: number; o: string; h: string; l: string; c: string; v: string; v_usd: string; n: number;
};

export type Token = {
  address: string;
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
};

export type Quote = {
  token_in: string; token_out: string; amount_in: string; amount_out: string;
  price_impact: string; path: string[]; pairs: string[]; hops: number; fee_bps_total: number;
};

export const api = {
  overview: () => call<Overview>('/overview'),
  listPairs: (sort: 'tvl' | 'volume' | 'new' | 'apr' = 'tvl', limit = 50) =>
    call<{ items: Pair[] }>(`/pairs?sort=${sort}&limit=${limit}`),
  getPair: (address: string) => call<Pair>(`/pairs/${address}`),
  candles: (address: string, granularity = '5m', limit = 500) =>
    call<{ items: Candle[]; granularity: string }>(`/pairs/${address}/candles?granularity=${granularity}&limit=${limit}`),
  pairSwaps: (address: string, limit = 50) =>
    call<{ items: any[] }>(`/pairs/${address}/swaps?limit=${limit}`),
  pairLiquidityEvents: (address: string, limit = 50) =>
    call<{ items: any[] }>(`/pairs/${address}/liquidity?limit=${limit}`),
  recentSwaps: (limit = 50) => call<{ items: any[] }>(`/swaps?limit=${limit}`),
  quote: (body: { token_in: string; token_out: string; amount_in: string; max_hops?: number }) =>
    call<Quote>('/quote', { method: 'POST', body: JSON.stringify(body) }),
  listTokens: (limit = 100, verifiedOnly = false) =>
    call<{ items: Token[] }>(`/tokens?limit=${limit}${verifiedOnly ? '&verified=1' : ''}`),
  getToken: (address: string) => call<Token>(`/tokens/${address}`),
  portfolio: (owner: string) => call<{ owner: string; positions: any[]; swaps: any[] }>(`/portfolio/${owner}`),
  search: (q: string) => call<{ items: any[] }>(`/search?q=${encodeURIComponent(q)}`),
  apiKeys: {
    challenge: (owner: string) =>
      call<{ nonce: string; message: string; expires_at: number }>(`/apikeys/challenge?owner=${owner}`),
    issue: (body: { owner: string; message: string; signature: string; label?: string }) =>
      call<{ key: string; key_hash: string; tier: string; label: string; created_at: number }>(
        '/apikeys/issue', { method: 'POST', body: JSON.stringify(body) },
      ),
    list: (body: { owner: string; message: string; signature: string }) =>
      call<{ items: ApiKeyRow[] }>('/apikeys/list', { method: 'POST', body: JSON.stringify(body) }),
    revoke: (body: { owner: string; message: string; signature: string; key_hash: string }) =>
      call<{ status: string }>('/apikeys/revoke', { method: 'POST', body: JSON.stringify(body) }),
  },
};

export type ApiKeyRow = {
  key_hash: string;
  label: string;
  tier: string;
  rate_per_min: number;
  burst: number;
  enabled: boolean;
  created_at: number;
  last_seen_at: number;
  revoked_at?: number;
};
