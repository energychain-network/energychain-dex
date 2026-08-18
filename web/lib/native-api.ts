// Typed client for the native Cosmos module endpoints exposed by dex-api.
// Mirrors lib/api.ts: browser calls route through the /api-proxy rewrite.

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

// ---- types (numbers are strings to preserve uint64 precision) -------------

export type Denom = {
  id: string; symbol: string; decimals: number; peg_currency: string; admin: string;
  minters: string[]; status: string; reserve_topic: string; required_ratio_bps: number;
  policy_id: string; supply: string; created_at: number; updated_at: number;
};

export type RwaToken = {
  id: string; symbol: string; name: string; admin: string; asset_class: string; decimals: number;
  total_supply: string; status: string; settlement_denom: string; policy_id: string;
  require_kyc: boolean; redemption_price: string; redemption_delay_seconds: number;
  per_holder_cap: string; metadata_uri: string; pool_balance: string; created_at: number; updated_at: number;
};

export type Market = {
  id: string; base_denom: string; quote_denom: string; status: string; fee_bps: number;
  min_base_qty: string; batch_interval: number; last_batch_time: number; last_clearing_price: string;
  created_at: number; require_kyc: boolean; policy_id: string;
  // Listing bond: gov-created markets start PENDING_BOND; the operator posts
  // params.listing_bond to open trading and gets it back on delisting.
  operator?: string; bond_amount?: string; bond_denom?: string;
  // Enriched by dex-api: asset kind + display metadata for each leg. The quote
  // leg is always a stablecoin; the base leg is a stablecoin (base_kind
  // "stable") or an x/rwatoken security token (base_kind "rwa").
  base_kind?: 'rwa' | 'stable'; base_token_id?: number;
  base_symbol?: string; base_decimals?: number;
  quote_symbol?: string; quote_decimals?: number;
};

export type RwaDistribution = {
  id: string; token_id: number; snapshot_id: string; denom: string;
  total_amount: string; claimed_amount: string; created_at: number;
};

export type OfferingReturnClaim = {
  offering_id: string; denom: string; investor: string;
  units: string; contributed: string;
  returns_claimed: string; claimable: string; allocated: boolean;
};

export type ClaimableDistribution = {
  distribution_id: string; snapshot_id: number; denom: string;
  amount: string; claimed: boolean; created_at: number;
};
export type Claimable = { token_id: string; holder: string; items: ClaimableDistribution[]; total_claimable: string };

export type DepthLevel = { price: string; quantity: string; orders: number };
export type OrderBook = { market_id: string; bids: DepthLevel[]; asks: DepthLevel[] };
export type MarketTrade = { market_id: string; height: number; block_time: number; price: string; qty: string };
export type MarketCandle = { t: number; o: string; h: string; l: string; c: string; v: string; n: number };
export type Order = {
  id: string; market_id: string; owner: string; side: string; price: string; quantity: string;
  filled: string; escrowed: string; status: string; created_at: number; seq: number;
};

export type MincastMarket = {
  id: string; denom: string; name: string; admin: string; settlement_denom: string; treasury: string;
  supply: string; initial_price: string; mint_fee_bps: number; melt_fee_bps: number; floor_price: string;
  status: string; policy_id: string; require_kyc: boolean; reward_pool: string; created_at: number; updated_at: number;
};
export type MincastQuote = { units?: string; settlement?: string; fee?: string; floor_price?: string };
export type MincastTrade = {
  market_id: string; action: string; account: string; pay_amount: string; units: string;
  settlement: string; fee: string; floor_price: string; height: number; tx_hash: string; block_time: number;
};

export type Offering = {
  id: string; token_id: string; issuer: string; denom: string; unit_price: string; soft_cap: string;
  hard_cap: string; raised: string; start_time: number; end_time: number; status: string;
  total_tranches: number; released_tranches: number; released_amount: string; injections_done: number;
  injected_total: string; required_injection: string; injection_interval: number; allocated_units: string;
  treasury: string; returns_pool: string; succeeded_at: number; created_at: number; updated_at: number;
  subscriptions?: Subscription[];
};
export type Subscription = {
  offering_id: string; investor: string; contributed: string; units: string; allocated: boolean;
  returns_claimed: string; refunded: boolean;
};

export type IdentityAccount = {
  address: string; exists?: boolean; did?: string; kyc_cleared: boolean; accredited?: boolean;
  jurisdiction?: string; kyc_expires_at?: number; status?: string;
};
export type EvaluateResult = { allowed: boolean; reason: string };

export type Device = {
  id: string; operator: string; device_type: string; jurisdiction: string; attestation_hash: string;
  firmware: string; status: string; created_at: number; updated_at: number;
};
export type Reading = {
  id: string; device_id: string; period_start: number; period_end: number; unit: string;
  iot_value: string; operational_value: string; verified: boolean; submitted_by: string; submitted_at: number;
};
export type OracleTopic = {
  id: string; description: string; min_sources: number; value: string; source_count: number;
  has_value: boolean; updated_at: number;
};
export type Provider = {
  address: string; role: string; display_name: string; bond: string; status: string;
  infractions: number; jailed_until: number;
};

export type NativePortfolio = {
  address: string;
  stable_balances: { denom_id: string; symbol: string; decimals: number; amount: string }[];
  rwa_balances: { token_id: string; symbol: string; name: string; decimals: number; asset_class: string; amount: string }[];
  mincast_balances: { market_id: string; denom: string; name: string; floor_price: string; amount: string }[];
  open_orders: Order[];
  invests: { id: string; market_id: string; principal_units: string; yield: string; apy_bps: number; opened_at: number; maturity: number; status: string }[];
  subscriptions: Subscription[];
};

export type NativeConfig = {
  cosmos_enabled: boolean; chain_id: string; bech32_prefix: string; native_denom: string; native_decimals: number;
};

// ---- bridge (cross-chain mint/burn) --------------------------------------
// uint64 fields arrive as strings from the gRPC-gateway; enums as upper-snake.
export type BridgeChain = {
  id: string; name: string; chain_ref: string; attestors: string[]; threshold: number;
  status: string; created_at: number;
};
export type BridgeAsset = { id: string; denom: string; status: string; created_at: number };
export type BridgeOutbound = {
  nonce: string; sender: string; asset_id: string; amount: string; dest_chain_id: string;
  dest_addr: string; created_at: number;
};
export type BridgeInbound = {
  id: string; src_chain_id: string; src_nonce: string; recipient: string; asset_id: string;
  amount: string; attestations: string[]; status: string; created_at: number; released_at: number;
};
export type BridgeParams = {
  max_chains: number; max_assets: number; max_attestors_per_chain: number; max_lock_amount: string;
  paused: boolean; max_mint_per_tx: string; mint_window_seconds: number; max_mint_per_window: string;
};

export const nativeApi = {
  config: () => call<NativeConfig>('/native/config'),

  denoms: () => call<{ items: Denom[] }>('/denoms'),
  denom: (id: string) => call<Denom>(`/denoms/${id}`),
  denomBalance: (id: string, addr: string) => call<{ amount: string }>(`/denoms/${id}/balance/${addr}`),

  rwaTokens: () => call<{ items: RwaToken[] }>('/rwa/tokens'),
  rwaToken: (id: string) => call<RwaToken>(`/rwa/tokens/${id}`),
  rwaDistributions: (id: string) => call<{ items: RwaDistribution[] }>(`/rwa/tokens/${id}/distributions`),
  rwaOfferingReturns: (id: string, investor: string) =>
    call<{ token_id: string; investor: string; items: OfferingReturnClaim[] }>(
      `/rwa/tokens/${id}/offering-returns?investor=${encodeURIComponent(investor)}`,
    ),
  rwaRedemptions: (id: string) => call<{ items: any[] }>(`/rwa/tokens/${id}/redemptions`),
  rwaClaimable: (id: string, addr: string) => call<Claimable>(`/rwa/tokens/${id}/claimable/${addr}`),

  markets: () => call<{ items: Market[] }>('/markets'),
  market: (id: string) => call<Market>(`/markets/${id}`),
  orderBook: (id: string) => call<OrderBook>(`/markets/${id}/orderbook`),
  marketTrades: (id: string, limit = 100) => call<{ items: MarketTrade[] }>(`/markets/${id}/trades?limit=${limit}`),
  marketCandles: (id: string, granularity = '1h', limit = 500) =>
    call<{ items: MarketCandle[]; granularity: string }>(`/markets/${id}/candles?granularity=${granularity}&limit=${limit}`),
  ordersByOwner: (addr: string) => call<{ items: Order[] }>(`/orders/${addr}`),

  mincastMarkets: () => call<{ items: MincastMarket[] }>('/mincast/markets'),
  mincastMarket: (id: string) => call<MincastMarket>(`/mincast/markets/${id}`),
  mincastQuote: (id: string, isMint: boolean, amount: string) =>
    call<MincastQuote>(`/mincast/markets/${id}/quote?is_mint=${isMint}&amount=${amount}`),
  mincastTrades: (id: string, limit = 100) => call<{ items: MincastTrade[] }>(`/mincast/markets/${id}/trades?limit=${limit}`),

  offerings: () => call<{ items: Offering[] }>('/offerings'),
  offering: (id: string) => call<Offering>(`/offerings/${id}`),

  identityAccount: (addr: string) => call<IdentityAccount>(`/identity/accounts/${addr}`),
  policy: (id: string) => call<any>(`/policies/${id}`),
  evaluate: (body: { policy_id: string; from: string; to: string; amount: string }) =>
    call<EvaluateResult>('/identity/evaluate', { method: 'POST', body: JSON.stringify(body) }),

  devices: () => call<{ items: Device[] }>('/assethub/devices'),
  readings: (id: string, limit = 100) => call<{ items: Reading[] }>(`/assethub/devices/${id}/readings?limit=${limit}`),
  providers: () => call<{ items: Provider[] }>('/assethub/providers'),
  topics: () => call<{ items: OracleTopic[] }>('/assethub/topics'),

  portfolio: (addr: string) => call<NativePortfolio>(`/native/portfolio/${addr}`),

  bridgeParams: () => call<{ params: BridgeParams }>('/bridge/params'),
  bridgeChains: () => call<{ chains: BridgeChain[] }>('/bridge/chains'),
  bridgeAssets: () => call<{ assets: BridgeAsset[] }>('/bridge/assets'),
  bridgeInbounds: (limit = 200) => call<{ inbounds: BridgeInbound[] }>(`/bridge/inbounds?limit=${limit}`),
  bridgeOutbounds: (limit = 200) => call<{ outbounds: BridgeOutbound[] }>(`/bridge/outbounds?limit=${limit}`),
  bridgeNetBridged: (denom: string) => call<{ balance: string }>(`/bridge/net-bridged/${denom}`),
};
