import Link from 'next/link';
import { notFound } from 'next/navigation';
import { nativeApi } from '@/lib/native-api';
import { amt, price, statusBadge, toneClass } from '@/lib/native-format';
import { shortAddr, timeAgo } from '@/lib/format';
import { Sparkline } from '@/components/native/sparkline';
import { MincastActions } from './actions';

export const revalidate = 5;

export default async function MincastMarketPage({ params }: { params: { id: string } }) {
  const market = await nativeApi.mincastMarket(params.id).catch(() => null);
  if (!market) notFound();
  const trades = await nativeApi.mincastTrades(params.id, 60).catch(() => ({ items: [] }));
  // The treasury / floor price / settlement legs are denominated in the
  // settlement stablecoin's base units; fetch its decimals so amounts are
  // shown in human units instead of raw micro-units.
  const sDenom = await nativeApi.denom(market.settlement_denom).catch(() => null);
  const sdec = sDenom?.decimals ?? 6;
  const sb = statusBadge(market.status);

  // Floor-price curve: oldest → newest, scaled into settlement units.
  const floorSeries = [...trades.items]
    .reverse()
    .map((t) => Number(t.floor_price) / 10 ** sdec)
    .filter((n) => Number.isFinite(n));

  return (
    <div className="space-y-4">
      <Link href="/mincast" className="text-xs text-ink-400 hover:text-ink-100">← 返回 Mincast</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{market.name || market.denom}</h1>
            <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>
            {market.require_kyc && <span className="chip">KYC</span>}
          </div>
          <p className="mt-1 mono text-xs text-ink-400">{market.denom} · 结算 {market.settlement_denom}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Info k={`保底价 (${market.settlement_denom})`} v={price(market.floor_price, sdec)} />
            <Info k={`初始价 (${market.settlement_denom})`} v={price(market.initial_price, sdec)} />
            <Info k="供应" v={amt(market.supply, 0)} />
            <Info k={`资金库 (${market.settlement_denom})`} v={amt(market.treasury, sdec)} />
            <Info k={`奖励池 (${market.settlement_denom})`} v={amt(market.reward_pool, sdec)} />
            <Info k="铸造费" v={`${(market.mint_fee_bps / 100).toFixed(2)}%`} />
            <Info k="熔毁费" v={`${(market.melt_fee_bps / 100).toFixed(2)}%`} />
            <Info k="管理员" v={shortAddr(market.admin, 6)} mono />
          </div>

          <div className="card p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium">保底价走势 Floor Price</div>
              <div className="mono text-lg font-semibold text-bull-400">{price(market.floor_price, sdec)}</div>
            </div>
            <div className="mt-3">
              <Sparkline values={floorSeries} />
            </div>
            <p className="mt-2 text-xs text-ink-400">手续费持续注入底池，保底价随成交单调抬升（近 {floorSeries.length} 笔成交）。</p>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">近期交易</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-400"><tr className="bg-white/[0.02]">
                <th className="px-4 py-2">动作</th><th className="px-4 py-2">账户</th>
                <th className="px-4 py-2 text-right">数量</th><th className="px-4 py-2 text-right">结算额</th>
                <th className="px-4 py-2 text-right">保底价</th><th className="px-4 py-2 text-right">时间</th>
              </tr></thead>
              <tbody>
                {trades.items.map((t, i) => (
                  <tr key={`${t.height}-${i}`} className="border-t border-white/5">
                    <td className={`px-4 py-2 ${t.action === 'mint' ? 'text-bull-400' : 'text-bear-400'}`}>{t.action === 'mint' ? '铸造' : '熔毁'}</td>
                    <td className="px-4 py-2 mono text-xs">{shortAddr(t.account, 5)}</td>
                    <td className="px-4 py-2 text-right mono">{amt(t.units, 0)}</td>
                    <td className="px-4 py-2 text-right mono">{amt(t.settlement, sdec)}</td>
                    <td className="px-4 py-2 text-right mono">{price(t.floor_price, sdec)}</td>
                    <td className="px-4 py-2 text-right text-xs text-ink-400">{timeAgo(t.block_time)}</td>
                  </tr>
                ))}
                {trades.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-400">暂无交易。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <MincastActions market={market} sdec={sdec} />
      </div>
    </div>
  );
}

function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div><div className="text-xs text-ink-400">{k}</div><div className={`mt-0.5 ${mono ? 'mono text-xs' : 'font-medium'}`}>{v}</div></div>;
}
