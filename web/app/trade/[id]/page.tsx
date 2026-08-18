import Link from 'next/link';
import { notFound } from 'next/navigation';
import { nativeApi } from '@/lib/native-api';
import { price, statusBadge, toneClass } from '@/lib/native-format';
import { MarketChart } from './chart';
import { MarketTerminal } from './terminal';
import { PostBondPanel } from './post-bond';

export const revalidate = 0;

export default async function MarketPage({ params }: { params: { id: string } }) {
  const market = await nativeApi.market(params.id).catch(() => null);
  if (!market) notFound();
  const [book, trades, candles] = await Promise.all([
    nativeApi.orderBook(params.id).catch(() => ({ market_id: params.id, bids: [], asks: [] })),
    nativeApi.marketTrades(params.id, 50).catch(() => ({ items: [] })),
    nativeApi.marketCandles(params.id, '1h', 500).catch(() => ({ items: [], granularity: '1h' })),
  ]);
  const sb = statusBadge(market.status);
  const baseDec = market.base_decimals ?? 6;
  const quoteDec = market.quote_decimals ?? 6;
  const priceExp = 6 + quoteDec - baseDec;
  const baseSym = market.base_symbol || market.base_denom;
  const quoteSym = market.quote_symbol || market.quote_denom;
  const isRWA = market.base_kind === 'rwa';

  return (
    <div className="space-y-4">
      <Link href="/trade" className="text-xs text-ink-400 hover:text-ink-100">← 返回交易</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{baseSym} / {quoteSym}</h1>
            <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>
            {isRWA && <span className="chip border-energy-400/20 bg-energy-400/5 text-energy-300">RWA 证券</span>}
            {market.require_kyc && <span className="chip">KYC</span>}
          </div>
          <p className="mt-1 text-sm text-ink-400">
            市场 #{market.id} · 手续费 {(market.fee_bps / 100).toFixed(2)}% · 最近清算价 <span className="mono text-ink-200">{price(market.last_clearing_price, priceExp)} {quoteSym}</span>
            {isRWA && market.base_token_id != null && (
              <> · <Link href={`/assets/rwa/${market.base_token_id}`} className="text-energy-400 hover:underline">资产详情 / 领分红 →</Link></>
            )}
          </p>
        </div>
      </header>

      {market.status?.includes('PENDING_BOND') && <PostBondPanel market={market} />}

      <MarketChart marketId={market.id} initialCandles={candles.items} priceExp={priceExp} qtyExp={baseDec} />

      <MarketTerminal
        market={market}
        initialBook={book}
        initialTrades={trades.items}
      />
    </div>
  );
}
