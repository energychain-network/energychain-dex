'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Token } from '@/lib/api';
import { api } from '@/lib/api';
import { displaySymbol, shortAddr } from '@/lib/format';
import { TokenAvatar } from './token-avatar';

export type SimpleToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
};

// The native gas asset is represented as the magic 0xeeee… address inside the
// router (it short-circuits to ETH/ECY in WECY's deposit/withdraw paths). We
// expose it at the top of the picker so users don't have to hunt for it.
export const NATIVE_TOKEN: SimpleToken = {
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  symbol: 'ECY',
  name: 'EnergyChain Coin (native)',
  decimals: 18,
};

export function TokenPicker({
  open,
  onClose,
  onSelect,
  exclude,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (t: SimpleToken) => void;
  exclude?: string;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Token[]>([]);
  // Default to "verified only" so a fresh user account can't accidentally
  // pick a phishing token whose symbol shadows ECY/USDT. Power users can
  // toggle this off to reach the long tail of auto-listed assets.
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  useEffect(() => {
    if (!open) return;
    api.listTokens(200, false).then((r) => setList(r.items)).catch(() => {});
  }, [open]);

  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    const all: Token[] = [
      {
        address: NATIVE_TOKEN.address,
        symbol: NATIVE_TOKEN.symbol,
        name: NATIVE_TOKEN.name,
        decimals: NATIVE_TOKEN.decimals,
        total_supply: '0',
        wrapped_native: false,
        stablecoin: false,
        trust_score: 2,
        logo_url: '',
        price_usd: '0',
        volume_usd_24h: '0',
      } as Token,
      ...list,
    ];
    return all.filter((t) => {
      if (exclude && t.address.toLowerCase() === exclude.toLowerCase()) return false;
      if (t.wrapped_native && t.address.toLowerCase() !== NATIVE_TOKEN.address.toLowerCase()) return false;
      // The verified-only toggle never hides what the user explicitly typed
      // by full address — that would be confusing. Anything else needs to
      // pass the trust gate.
      if (verifiedOnly && t.trust_score < 2 && f !== t.address.toLowerCase()) return false;
      if (!f) return true;
      const sym = t.symbol.toLowerCase();
      const display = displaySymbol(t.symbol).toLowerCase();
      return (
        sym.includes(f) ||
        display.includes(f) ||
        t.name.toLowerCase().includes(f) ||
        t.address.toLowerCase().includes(f)
      );
    });
  }, [list, q, exclude, verifiedOnly]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-[440px] max-w-[92vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h3 className="text-sm font-medium">Select a token</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">✕</button>
        </div>
        <div className="space-y-2 p-4">
          <input
            autoFocus
            className="input"
            placeholder="Search name, symbol, or paste address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center justify-between text-xs text-ink-400">
            <span>Showing {filtered.length} {verifiedOnly ? 'verified' : 'total'} token{filtered.length === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
                className="accent-bull-400"
              />
              Verified only
            </span>
          </label>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.map((t) => (
            <button
              key={t.address}
              onClick={() => { onSelect({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals }); onClose(); }}
              className="flex w-full items-center justify-between border-t border-white/5 px-4 py-3 text-left hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-3">
                <TokenAvatar address={t.address} symbol={t.symbol} logoUrl={t.logo_url} size={32} />
                <div>
                  <div className="text-sm font-medium">{displaySymbol(t.symbol) || shortAddr(t.address)}</div>
                  <div className="text-xs text-ink-400">{t.name || shortAddr(t.address)}</div>
                </div>
              </div>
              <div className="text-right">
                {t.trust_score >= 2
                  ? <span className="chip border-bull/20 bg-bull/10 text-bull-400">verified</span>
                  : <span className="chip border-amber-400/20 bg-amber-400/5 text-amber-300">unverified</span>}
                <div className="mt-1 text-xs mono text-ink-400">{shortAddr(t.address)}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-400">
              No tokens match.{verifiedOnly && ' Try disabling "Verified only".'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
