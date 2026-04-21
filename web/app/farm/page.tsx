import Link from 'next/link';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';

export const revalidate = 30;

// Phase-1 Farm: read-only “virtual farms” derived from existing AMM pools,
// ranked by trailing 24h fee APR. The on-chain MasterChef integration is a
// follow-up; this lets users discover where capital is currently most efficient
// without burning gas on a stake-now button that doesn’t exist yet.
export default async function FarmPage() {
  const list = await api.listPairs('apr', 50).catch(() => ({ items: [] as any[] }));
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Yield farms</h1>
          <p className="mt-1 text-sm text-ink-400">
            Pools ranked by 24h trading fee APR. Provide liquidity to earn 0.30% per swap on the underlying pair.
          </p>
        </div>
        <span className="chip">Phase 1 · fees only</span>
      </header>

      <div className="card border-amber-400/20 bg-amber-400/5 p-4">
        <div className="flex flex-wrap items-start gap-3 text-sm text-amber-100">
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs uppercase tracking-wider text-amber-300">Read-only</span>
          <p className="flex-1 leading-relaxed">
            Phase&nbsp;1 surfaces fee-APR opportunities so liquidity providers can already plan their allocations,
            but on-chain staking (MasterChef + EFM emissions) ships in the next contract release.
            For now, click <span className="font-medium">Add liquidity</span> to mint LP tokens — they auto-earn the
            0.30 % swap fee, no farming step required.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.items.map((p: any) => (
          <article key={p.address} className="card card-hover p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold">{displaySymbol(p.symbol0) || shortAddr(p.token0)} / {displaySymbol(p.symbol1) || shortAddr(p.token1)}</div>
                <div className="mono text-xs text-ink-400">{shortAddr(p.address, 6)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-ink-400">APR 24h</div>
                <div className="text-lg font-semibold text-bull">{Number(p.apr_24h || 0).toFixed(2)}%</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Mini label="TVL" value={fmtUSD(p.tvl_usd)} />
              <Mini label="Volume 24h" value={fmtUSD(p.volume_usd_24h)} />
              <Mini label="Fees 24h" value={fmtUSD(p.fees_usd_24h)} />
              <Mini label="Fee tier" value="0.30%" />
            </div>
            <div className="mt-4 flex gap-2">
              <Link href={`/pools/${p.address}`} className="btn-primary flex-1 justify-center">Add liquidity</Link>
              <Link href={`/charts/${p.address}`} className="btn-outline">Chart</Link>
            </div>
          </article>
        ))}
        {list.items.length === 0 && <div className="card p-8 text-center text-ink-400 sm:col-span-2 xl:col-span-3">No active farms.</div>}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-850 border border-white/5 p-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
