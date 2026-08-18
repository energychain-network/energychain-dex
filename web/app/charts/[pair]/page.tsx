import Link from 'next/link';
import { api } from '@/lib/api';
import { ADDR } from '@/lib/chain';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';
import { TradingView } from './trading-view';
import { LiveTrades } from '@/components/live-trades';

export const revalidate = 0;

export default async function PairChart({ params }: { params: { pair: string } }) {
  const [pair, candles, swaps] = await Promise.all([
    api.getPair(params.pair).catch(() => null),
    api.candles(params.pair, '5m', 500).catch(() => ({ items: [] as any[], granularity: '5m' })),
    api.pairSwaps(params.pair, 30).catch(() => ({ items: [] as any[] })),
  ]);

  if (!pair) {
    return <div className="card p-8 text-center text-ink-400">Pair not found.</div>;
  }

  // Candles arrive as token1-per-token0, and ECY always sorts into token1 in
  // these pools, so the raw series drops as ECY gains. Quote ECY in the paired
  // asset instead and label the header to match.
  const quoteInverted =
    !!ADDR.wecy && String(pair.token1).toLowerCase() === ADDR.wecy.toLowerCase();
  const base = displaySymbol(pair.symbol0) || shortAddr(pair.token0);
  const quote = displaySymbol(pair.symbol1) || shortAddr(pair.token1);
  const title = quoteInverted ? `${quote} / ${base}` : `${base} / ${quote}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <span className="chip mono">{shortAddr(pair.address, 4)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-400">UniV2 · 0.30% fee · created at block #{pair.created_height}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/swap?in=${pair.token0}&out=${pair.token1}`} className="btn-primary">Swap</Link>
          <Link href={`/pools/${pair.address}`} className="btn-outline">Manage liquidity</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="TVL" value={fmtUSD(pair.tvl_usd)} />
        <Stat label="Volume 24h" value={fmtUSD(pair.volume_usd_24h)} />
        <Stat label="Fees 24h" value={fmtUSD(pair.fees_usd_24h)} />
        <Stat label="APR" value={`${Number(pair.apr_24h || 0).toFixed(2)}%`} accent="bull" />
      </section>

      <TradingView pairAddress={pair.address} initialCandles={candles.items} quoteInverted={quoteInverted} />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <LiveTrades initial={swaps.items} max={50} />
        <div className="card p-5">
          <h3 className="text-sm font-medium">Pool composition</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row k={`${base} reserve`} v={pair.reserve0} />
            <Row k={`${quote} reserve`} v={pair.reserve1} />
            <div className="divider" />
            <Row k={`${base} price (USD est.)`} v={fmtUSD(pair.price0_usd)} />
            <Row k={`${quote} price (USD est.)`} v={fmtUSD(pair.price1_usd)} />
          </div>
        </div>
      </div>
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
  return <div className="flex justify-between"><span className="text-ink-400">{k}</span><span className="mono">{String(v)}</span></div>;
}
