import Link from 'next/link';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';

export const revalidate = 10;

export default async function ChartsIndex() {
  const res = await api.listPairs('volume', 50).catch(() => ({ items: [] as any[] }));
  // The EVM DEX API returns {"items": null} when no AMM pairs are indexed yet
  // (e.g. EVM layer disabled / no contracts). `.catch` only handles rejections,
  // so guard against a null payload to avoid a render crash (500).
  const top = { items: res.items ?? [] };
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Markets</h1>
          <p className="mt-1 text-sm text-ink-400">Pick a pair to open the trading view.</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400">
            <tr className="bg-white/[0.02]">
              <th className="px-4 py-3">Pair</th>
              <th className="px-4 py-3 text-right">TVL</th>
              <th className="px-4 py-3 text-right">Volume 24h</th>
              <th className="px-4 py-3 text-right">APR</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {top.items.map((p) => (
              <tr key={p.address} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <span className="font-medium">{displaySymbol(p.symbol0) || shortAddr(p.token0)} / {displaySymbol(p.symbol1) || shortAddr(p.token1)}</span>
                  <span className="ml-2 text-xs mono text-ink-400">{shortAddr(p.address, 3)}</span>
                </td>
                <td className="px-4 py-3 text-right">{fmtUSD(p.tvl_usd)}</td>
                <td className="px-4 py-3 text-right">{fmtUSD(p.volume_usd_24h)}</td>
                <td className="px-4 py-3 text-right text-bull">{Number(p.apr_24h || 0).toFixed(2)}%</td>
                <td className="px-4 py-3 text-right"><Link href={`/charts/${p.address}`} className="btn-ghost px-3 py-1 text-xs">Trade</Link></td>
              </tr>
            ))}
            {top.items.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-400">No markets indexed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
