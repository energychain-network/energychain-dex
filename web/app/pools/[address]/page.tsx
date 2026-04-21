import Link from 'next/link';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';
import { LiquidityActions } from './liquidity-actions';

export const revalidate = 10;

export default async function PoolDetail({ params }: { params: { address: string } }) {
  const [pair, swaps, liq] = await Promise.all([
    api.getPair(params.address).catch(() => null),
    api.pairSwaps(params.address, 20).catch(() => ({ items: [] as any[] })),
    api.pairLiquidityEvents(params.address, 20).catch(() => ({ items: [] as any[] })),
  ]);
  if (!pair) return <div className="card p-8 text-center text-ink-400">Pool not found.</div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{displaySymbol(pair.symbol0) || shortAddr(pair.token0)} / {displaySymbol(pair.symbol1) || shortAddr(pair.token1)}</h1>
            <span className="chip mono">{shortAddr(pair.address, 4)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-400">UniV2 · 0.30% fee</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/charts/${pair.address}`} className="btn-outline">Chart</Link>
          <Link href={`/swap?in=${pair.token0}&out=${pair.token1}`} className="btn-primary">Trade</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="TVL" value={fmtUSD(pair.tvl_usd)} />
        <Stat label="Volume 24h" value={fmtUSD(pair.volume_usd_24h)} />
        <Stat label="Fees 24h" value={fmtUSD(pair.fees_usd_24h)} />
        <Stat label="APR" value={`${Number(pair.apr_24h || 0).toFixed(2)}%`} accent="bull" />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <h3 className="text-sm font-medium">Reserves</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row k={displaySymbol(pair.symbol0) || shortAddr(pair.token0)} v={pair.reserve0} />
            <Row k={displaySymbol(pair.symbol1) || shortAddr(pair.token1)} v={pair.reserve1} />
            <div className="divider" />
            <Row k="Created at block" v={`#${pair.created_height}`} />
            <Row k="Pair address" v={pair.address} />
          </div>
        </div>
        <LiquidityActions pair={pair} />
      </div>

      <section>
        <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-400">Recent swaps</h3>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400">
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Trader</th>
                <th className="px-4 py-3 text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {swaps.items.map((s: any) => (
                <tr key={s.tx + s.height} className="border-t border-white/5">
                  <td className="px-4 py-2 text-ink-300">{new Date(Number(s.block_time) * 1000).toLocaleString()}</td>
                  <td className="px-4 py-2"><span className={s.side === 0 ? 'text-bull' : 'text-bear'}>{s.side === 0 ? 'Buy' : 'Sell'}</span></td>
                  <td className="px-4 py-2 text-right">{fmtUSD(s.amount_usd)}</td>
                  <td className="px-4 py-2 text-right mono text-xs">{shortAddr(s.sender, 4)}</td>
                  <td className="px-4 py-2 text-right mono text-xs">{shortAddr(s.tx, 4)}</td>
                </tr>
              ))}
              {swaps.items.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-400">No trades yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-400">Liquidity history</h3>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400">
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 text-right">Provider</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {liq.items.map((e: any) => (
                <tr key={e.tx + e.height} className="border-t border-white/5">
                  <td className="px-4 py-2 text-ink-300">{new Date(Number(e.block_time) * 1000).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <span className={e.kind === 'mint' ? 'text-bull' : 'text-bear'}>{e.kind === 'mint' ? 'Add' : 'Remove'}</span>
                  </td>
                  <td className="px-4 py-2 text-right mono text-xs">{shortAddr(e.provider, 4)}</td>
                  <td className="px-4 py-2 text-right">{fmtUSD(e.amount_usd)}</td>
                  <td className="px-4 py-2 text-right mono text-xs">{shortAddr(e.tx, 4)}</td>
                </tr>
              ))}
              {liq.items.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-400">No add/remove activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'bull' | 'bear' }) {
  const tone = accent === 'bull' ? 'text-bull' : accent === 'bear' ? 'text-bear' : 'text-ink-100';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-ink-400">{k}</span><span className="mono break-all text-right">{String(v)}</span></div>;
}
