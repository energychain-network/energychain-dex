import { defineChain } from 'viem';

// EnergyChain mainnet currently lives on chain id 9001 (EVM cosmos
// integration). The 262144 default we shipped earlier was leftover from a
// pre-mainnet experiment and caused MetaMask to reject every signature
// because the wallet's chain didn't match the configured one. We default to
// 9001 here and allow override via NEXT_PUBLIC_DEX_CHAIN_ID so testnets and
// local devnets can still point elsewhere.
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEX_CHAIN_ID || 9001);
const RPC = process.env.NEXT_PUBLIC_DEX_RPC || 'http://localhost:8545';
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_BASE || 'http://localhost:3000';

export const energyChain = defineChain({
  id: CHAIN_ID,
  name: 'EnergyChain',
  nativeCurrency: { name: 'Energy', symbol: 'ECY', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC] },
    public: { http: [RPC] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: EXPLORER },
  },
  testnet: CHAIN_ID !== 9001,
});

export const ADDR = {
  factory: (process.env.NEXT_PUBLIC_DEX_FACTORY || '') as `0x${string}`,
  router: (process.env.NEXT_PUBLIC_DEX_ROUTER || '') as `0x${string}`,
  wecy: (process.env.NEXT_PUBLIC_DEX_WECY || '') as `0x${string}`,
};

// Returns true if any required contract address is missing. Used by the
// frontend to surface a clear "not configured" warning instead of silently
// signing transactions against the zero address.
export function dexConfigOk(): boolean {
  return !!(ADDR.factory && ADDR.router && ADDR.wecy);
}
