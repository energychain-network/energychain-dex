'use client';

import { useState } from 'react';
import { useCosmos } from '@/lib/cosmos-wallet';
import { shortAddr } from '@/lib/format';

// Keplr / Leap connect button for the native Cosmos layer. Sits next to the
// EVM ConnectButton in the header; the two wallets are independent.
export function CosmosConnect() {
  const { address, connecting, error, connect, disconnect } = useCosmos();
  const [open, setOpen] = useState(false);

  if (address) {
    return (
      <div className="relative">
        <button className="btn-outline" onClick={() => setOpen((s) => !s)} title="Cosmos 钱包">
          <span className="mr-1 text-energy-400">◈</span>
          <span className="mono text-xs">{shortAddr(address, 5)}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-56 card overflow-hidden">
            <div className="px-3 py-2 text-xs text-ink-400 break-all">{address}</div>
            <button
              onClick={() => { setOpen(false); disconnect(); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5 border-t border-white/5"
            >
              断开 Cosmos 钱包
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <button className="btn-outline" disabled={connecting} onClick={() => connect().catch(() => {})}>
        {connecting ? '连接中…' : 'Keplr'}
      </button>
      {error && (
        <div className="absolute right-0 mt-2 w-64 card p-3 text-xs text-bear-300">{error}</div>
      )}
    </div>
  );
}
