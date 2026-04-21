import { http, createConfig } from 'wagmi';
import { injected, walletConnect } from '@wagmi/connectors';
import { energyChain } from './chain';

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '';

// We expose three connectors: generic injected (covers MetaMask, Rabby, Brave,
// and any EIP-1193 provider) plus WalletConnect for mobile wallets. Adding
// a wallet here is the only place we should need to touch.
export const wagmiConfig = createConfig({
  chains: [energyChain],
  ssr: true,
  transports: {
    [energyChain.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [walletConnect({ projectId: wcProjectId, showQrModal: true })]
      : []),
  ],
});
