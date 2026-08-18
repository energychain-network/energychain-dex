import { http, createConfig } from 'wagmi';
import { injected, walletConnect } from '@wagmi/connectors';
import { energyChain } from './chain';

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '';

/** EIP-1193 provider for browser wallets. OKX often exposes `okxwallet` (or
 * `okxwallet.ethereum`) while another extension owns `window.ethereum`; after a
 * reinstall OKX may not be merged into `ethereum` yet. Prefer `ethereum` when
 * present (multiplexers / default wallet), then fall back to OKX’s provider. */
function injectedTarget() {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & {
    ethereum?: import('viem').EIP1193Provider;
    okxwallet?: import('viem').EIP1193Provider & { ethereum?: import('viem').EIP1193Provider };
  };
  const okx = w.okxwallet?.ethereum ?? w.okxwallet;
  const eth = w.ethereum;
  const provider = eth ?? okx;
  if (!provider) return undefined;
  return {
    id: 'injected',
    name: 'Browser wallet',
    provider,
  };
}

// We expose three connectors: generic injected (covers MetaMask, Rabby, Brave,
// OKX, and any EIP-1193 provider) plus WalletConnect for mobile wallets. Adding
// a wallet here is the only place we should need to touch.
export const wagmiConfig = createConfig({
  chains: [energyChain],
  ssr: true,
  transports: {
    [energyChain.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true, target: injectedTarget }),
    ...(wcProjectId
      ? [walletConnect({ projectId: wcProjectId, showQrModal: true })]
      : []),
  ],
});
