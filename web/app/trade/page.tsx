import Link from 'next/link';
import { CandlestickChart, ChevronRight, CirclePlus, ShieldCheck, Timer, Landmark } from 'lucide-react';
import { nativeApi } from '@/lib/native-api';
import { price } from '@/lib/native-format';
import { PageHeader, EmptyRow, PairBadge, StatusPill } from '@/components/page-header';

export const revalidate = 10;

export default async function TradePage() {
  const markets = await nativeApi.markets().catch(() => ({ items: [] }));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CandlestickChart}
        title={<>交易 <span className="text-ink-400 font-normal">Trade</span></>}
        subtitle="基于频繁批量拍卖 (FBA) 的链上订单簿，统一清算价撮合，抗抢跑。"
      >
        <Link href="/issue?tab=market" className="btn-outline text-sm shrink-0">
          <CirclePlus size={15} /> 创建市场
        </Link>
      </PageHeader>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="text-left">
            <tr className="bg-white/[0.02]">
              <th className="th">市场</th>
              <th className="th text-right">最近清算价</th>
              <th className="th text-right">手续费</th>
              <th className="th text-right">批次间隔</th>
              <th className="th text-right">状态</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody>
            {markets.items.map((m) => {
              const priceExp = 6 + (m.quote_decimals ?? 6) - (m.base_decimals ?? 6);
              const baseSym = m.base_symbol || m.base_denom;
              const quoteSym = m.quote_symbol || m.quote_denom;
              return (
                <tr key={m.id} className="tr-row group">
                  <td className="td">
                    <Link href={`/trade/${m.id}`} className="flex items-center gap-3">
                      <PairBadge base={baseSym} quote={quoteSym} />
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:text-energy-400 transition-colors">
                          {baseSym} <span className="text-ink-500">/</span> {quoteSym}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
                          #{m.id}
                          {m.base_kind === 'rwa' && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-energy-500/20 bg-energy-500/10 px-1.5 py-px text-[10px] font-medium text-energy-400">
                              <Landmark size={10} /> RWA
                            </span>
                          )}
                          {m.require_kyc && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/20 bg-sky-400/10 px-1.5 py-px text-[10px] font-medium text-sky-300">
                              <ShieldCheck size={10} /> KYC
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="td text-right mono text-base">{price(m.last_clearing_price, priceExp)}</td>
                  <td className="td text-right text-ink-300">{(m.fee_bps / 100).toFixed(2)}%</td>
                  <td className="td text-right">
                    <span className="inline-flex items-center gap-1.5 text-ink-300">
                      <Timer size={13} className="text-ink-500" />
                      {m.batch_interval ? `${m.batch_interval}s` : '每块'}
                    </span>
                  </td>
                  <td className="td text-right"><StatusPill status={m.status} /></td>
                  <td className="td pr-4 text-right text-ink-600 group-hover:text-energy-400 transition-colors">
                    <ChevronRight size={16} />
                  </td>
                </tr>
              );
            })}
            {markets.items.length === 0 && (
              <EmptyRow
                colSpan={6}
                icon={CandlestickChart}
                title="暂无交易市场"
                hint="通过治理提案创建首个订单簿市场后，将在此展示。"
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
