'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { useEffect, useState } from 'react';
import { wagmiConfig } from '@/lib/wagmi';
import { useWSStatus } from '@/lib/ws';
import { CosmosWalletProvider } from '@/lib/cosmos-wallet';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <CosmosWalletProvider>
          <ReconnectRefetcher />
          {children}
        </CosmosWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// While the WS stream is down we miss every push (new swaps, OHLCV ticks, pair
// updates). When the stream comes back we invalidate every active react-query
// so each visible page does a single REST refetch and "snaps" back to the
// current truth without forcing the user to reload. The reconnect timestamp
// is monotonically increasing so each reconnect produces exactly one
// invalidation pass.
function ReconnectRefetcher() {
  const { reconnectedAt } = useWSStatus();
  const qc = useQueryClient();
  useEffect(() => {
    if (!reconnectedAt) return;
    qc.invalidateQueries();
  }, [reconnectedAt, qc]);
  return null;
}
