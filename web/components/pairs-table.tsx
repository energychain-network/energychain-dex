import Link from 'next/link';
import type { Pair } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';

export function PairsTable({ items, max }: { items: Pair[]; max?: number }) {
  const safe = items ?? [];
  const list = max ? safe.slice(0, max) : safe;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400">
            <tr className="bg-white/[0.02]">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Pool</th>
              <th className="px-4 py-3 font-medium text-right">TVL</th>
              <th className="px-4 py-3 font-medium text-right">Volume 24h</th>
              <th className="px-4 py-3 font-medium text-right">Fees 24h</th>
              <th className="px-4 py-3 font-medium text-right">APR</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => (
              <tr key={p.address} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-ink-400">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link href={`/pools/${p.address}`} className="flex items-center gap-2 hover:text-energy-400">
                    <TokenChips a={displaySymbol(p.symbol0) || shortAddr(p.token0)} b={displaySymbol(p.symbol1) || shortAddr(p.token1)} />
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">{fmtUSD(p.tvl_usd)}</td>
                <td className="px-4 py-3 text-right">{fmtUSD(p.volume_usd_24h)}</td>
                <td className="px-4 py-3 text-right">{fmtUSD(p.fees_usd_24h)}</td>
                <td className="px-4 py-3 text-right text-bull">{Number(p.apr_24h || 0).toFixed(2)}%</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/swap?in=${p.token0}&out=${p.token1}`} className="btn-ghost px-3 py-1 text-xs">Swap</Link>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-400">
                  No pools yet. Deploy the factory and add your first liquidity pool.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TokenChips({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex items-center">
      <TokenAvatar label={a} className="ring-2 ring-ink-900" />
      <TokenAvatar label={b} className="-ml-2 ring-2 ring-ink-900" />
      <span className="ml-2 font-medium text-ink-100">{a} / {b}</span>
    </div>
  );
}

function TokenAvatar({ label, className = '' }: { label: string; className?: string }) {
  // Deterministic colour based on the symbol hash; gives a unique-ish chip
  // even before we plug in real logo URIs.
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  const bg = `hsl(${h}, 60%, 45%)`;
  return (
    <span
      className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white ${className}`}
      style={{ backgroundColor: bg }}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}
