'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useBalance } from 'wagmi';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, fromBaseUnits, shortAddr, timeAgo } from '@/lib/format';

type Position = {
  pair: string; token0: string; token1: string; symbol0: string; symbol1: string;
  liquidity: string; reserve0: string; reserve1: string; tvl_usd: string;
};

type Trade = {
  block_time: number; tx: string; pair: string; symbol0: string; symbol1: string;
  amount0_in: string; amount1_in: string; amount0_out: string; amount1_out: string;
  side: number; amount_usd: string;
};

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const ecy = useBalance({ address });
  const [data, setData] = useState<{ positions: Position[]; swaps: Trade[] } | null>(null);
  const [overrideAddr, setOverrideAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = overrideAddr || address || '';

  useEffect(() => {
    if (!target) { setData(null); return; }
    let alive = true;
    setLoading(true); setErr(null);
    api.portfolio(target)
      .then((d) => { if (alive) setData(d as any); })
      .catch((e) => { if (alive) setErr(e.message || 'Failed to load portfolio'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="mt-1 text-sm text-ink-400">Liquidity positions, balances and on-chain trade history.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            placeholder="Look up any address (0x…)"
            className="input w-72 mono text-xs"
            value={overrideAddr}
            onChange={(e) => setOverrideAddr(e.target.value.trim())}
          />
        </div>
      </header>

      {!isConnected && !overrideAddr && (
        <div className="card p-8 text-center">
          <p className="text-ink-300">Connect your wallet, or paste any address above to inspect their portfolio.</p>
        </div>
      )}

      {target && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Address" value={shortAddr(target, 6)} mono />
            <Stat label="ECY balance" value={ecy.data ? `${fromBaseUnits(ecy.data.value.toString(), ecy.data.decimals, 6)} ECY` : '—'} />
            <Stat label="Open LP positions" value={String(data?.positions?.length ?? 0)} />
            <Stat label="Recent trades" value={String(data?.swaps?.length ?? 0)} />
          </section>

          <section>
            <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-400">LP positions</h3>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-400">
                  <tr className="bg-white/[0.02]">
                    <th className="px-4 py-3">Pair</th>
                    <th className="px-4 py-3 text-right">LP balance</th>
                    <th className="px-4 py-3 text-right">Pool TVL</th>
                    <th className="px-4 py-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.positions ?? []).map((p) => (
                    <tr key={p.pair} className="border-t border-white/5">
                      <td className="px-4 py-3">
                        <Link href={`/pools/${p.pair}`} className="hover:text-energy-400">
                          {displaySymbol(p.symbol0) || shortAddr(p.token0)} / {displaySymbol(p.symbol1) || shortAddr(p.token1)}
                        </Link>
                        <div className="mono text-xs text-ink-400">{shortAddr(p.pair, 4)}</div>
                      </td>
                      <td className="px-4 py-3 text-right mono">{fromBaseUnits(p.liquidity, 18, 8)}</td>
                      <td className="px-4 py-3 text-right">{fmtUSD(p.tvl_usd)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/pools/${p.pair}`} className="btn-ghost text-xs">Manage</Link>
                      </td>
                    </tr>
                  ))}
                  {(!data?.positions || data.positions.length === 0) && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-400">No active LP positions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-400">Trade history</h3>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-400">
                  <tr className="bg-white/[0.02]">
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Pair</th>
                    <th className="px-4 py-3">Side</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.swaps ?? []).map((s) => (
                    <tr key={s.tx + s.block_time} className="border-t border-white/5">
                      <td className="px-4 py-3 text-ink-300">{timeAgo(s.block_time)}</td>
                      <td className="px-4 py-3"><Link href={`/charts/${s.pair}`} className="hover:text-energy-400">{displaySymbol(s.symbol0)}/{displaySymbol(s.symbol1)}</Link></td>
                      <td className="px-4 py-3"><span className={s.side === 0 ? 'text-bull' : 'text-bear'}>{s.side === 0 ? 'Buy' : 'Sell'}</span></td>
                      <td className="px-4 py-3 text-right">{fmtUSD(s.amount_usd)}</td>
                      <td className="px-4 py-3 text-right mono text-xs">{shortAddr(s.tx, 6)}</td>
                    </tr>
                  ))}
                  {(!data?.swaps || data.swaps.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-400">No trade history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {loading && <p className="text-xs text-ink-400">Loading…</p>}
          {err && <p className="text-xs text-bear-400">{err}</p>}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${mono ? 'mono text-base' : ''}`}>{value}</div>
    </div>
  );
}
