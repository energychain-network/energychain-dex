import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtUSD } from '@/lib/format';
import { KPICard } from '@/components/kpi-card';
import { PairsTable } from '@/components/pairs-table';
import { LiveTrades } from '@/components/live-trades';

export const revalidate = 10;

export default async function HomePage() {
  const [overview, top, recent] = await Promise.all([
    api.overview().catch(() => null),
    api.listPairs('tvl', 8).catch(() => ({ items: [] as any[] })),
    api.recentSwaps(20).catch(() => ({ items: [] as any[] })),
  ]);
  return (
    <div className="space-y-10">
      <Hero />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPICard label="Total volume 24h" value={fmtUSD(overview?.volume_usd_24h)} accent="energy" />
        <KPICard label="Total liquidity"  value={fmtUSD(overview?.tvl_usd)} accent="bull" />
        <KPICard label="Trades 24h"       value={String(overview?.trades_24h ?? 0)} sub="across all pairs" />
        <KPICard label="Listed assets"    value={String(overview?.tokens ?? 0)} sub={`${overview?.pairs ?? 0} pools`} />
      </section>

      <section>
        <SectionTitle title="Top pools by TVL" href="/pools" />
        <PairsTable items={top.items ?? []} max={8} />
      </section>

      <section>
        <SectionTitle title="Live trades" href="/charts" />
        <LiveTrades initial={recent.items} max={30} />
      </section>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden card p-8 md:p-12">
      <div className="absolute inset-0 -z-10 bg-mesh-1 opacity-90" />
      <div className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <span className="chip">Built for EnergyChain · UniV2 AMM</span>
          <h1 className="mt-4 text-4xl md:text-5xl font-semibold leading-tight tracking-tight">
            Trade the energy economy.<br />
            <span className="bg-gradient-to-r from-energy-300 via-energy-400 to-energy-600 bg-clip-text text-transparent">
              Liquid. Transparent. Fast.
            </span>
          </h1>
          <p className="mt-4 max-w-lg text-ink-300">
            Swap, provide liquidity, and analyze on-chain markets — backed by a dedicated indexer
            so charts load in milliseconds, even on long histories.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/swap" className="btn-primary">
              Launch Swap
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </Link>
            <Link href="/pools" className="btn-outline">Explore pools</Link>
            <Link href="/portfolio" className="btn-ghost">My portfolio</Link>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="card relative bg-ink-900/60 p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-400">SAMPLE QUOTE</span>
              <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulseDot" /> live</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-ink-850 p-4">
                <div className="text-xs text-ink-400">You pay</div>
                <div className="mt-1 text-2xl font-semibold">100 ECY</div>
              </div>
              <div className="rounded-xl bg-ink-850 p-4">
                <div className="text-xs text-ink-400">You receive</div>
                <div className="mt-1 text-2xl font-semibold">98.41 USDT</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="Price impact" value="0.04%" tone="bull" />
              <Stat label="Fee" value="0.30%" />
              <Stat label="Min received" value="98.20" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  const color = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-ink-100';
  return (
    <div className="rounded-lg bg-white/[0.03] py-2">
      <div className="text-ink-400">{label}</div>
      <div className={`mt-0.5 font-medium ${color}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm uppercase tracking-wider text-ink-400">{title}</h2>
      {href && <Link href={href} className="text-xs text-ink-400 hover:text-energy-400">View all →</Link>}
    </div>
  );
}
