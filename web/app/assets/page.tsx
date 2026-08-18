import Link from 'next/link';
import { Coins, CirclePlus, Landmark, ShieldCheck, CircleDollarSign, ChevronRight } from 'lucide-react';
import { nativeApi } from '@/lib/native-api';
import { amt } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { PageHeader, EmptyRow, AssetBadge, StatusPill } from '@/components/page-header';

export const revalidate = 15;

export default async function AssetsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = searchParams?.tab === 'stable' ? 'stable' : 'rwa';
  const [denoms, tokens] = await Promise.all([
    nativeApi.denoms().catch(() => ({ items: [] })),
    nativeApi.rwaTokens().catch(() => ({ items: [] })),
  ]);
  // settlement denom id → decimals, to render RWA redemption prices in
  // human settlement units.
  const dec: Record<string, number> = {};
  for (const d of denoms.items) dec[d.id] = d.decimals;
  const sdecOf = (id: string) => dec[id] ?? 6;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Coins}
        title={<>资产 <span className="text-ink-400 font-normal">Assets</span></>}
        subtitle="链上原生发行的稳定币 (stableusd) 与真实世界资产代币 (rwatoken)。"
      >
        <div className="tabstrip">
          <Link href="/assets?tab=rwa" className={tab === 'rwa' ? 'tab-pill-on' : 'tab-pill-off'}>
            <Landmark size={13} /> RWA 代币
          </Link>
          <Link href="/assets?tab=stable" className={tab === 'stable' ? 'tab-pill-on' : 'tab-pill-off'}>
            <CircleDollarSign size={13} /> 稳定币
          </Link>
        </div>
        <Link href="/issue" className="btn-outline text-sm">
          <CirclePlus size={15} /> 发行资产
        </Link>
      </PageHeader>

      {tab === 'rwa' ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th">代币</th>
                <th className="th">类别</th>
                <th className="th text-right">总供应</th>
                <th className="th text-right">赎回价</th>
                <th className="th">结算币</th>
                <th className="th text-right">状态</th>
                <th className="th w-8" />
              </tr>
            </thead>
            <tbody>
              {tokens.items.map((t) => (
                <tr key={t.id} className="tr-row group">
                  <td className="td">
                    <Link href={`/assets/rwa/${t.id}`} className="flex items-center gap-3">
                      <AssetBadge symbol={t.symbol} />
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:text-energy-400 transition-colors">{t.symbol}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
                          <span className="truncate">{t.name}</span>
                          {t.require_kyc && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/20 bg-sky-400/10 px-1.5 py-px text-[10px] font-medium text-sky-300">
                              <ShieldCheck size={10} /> KYC
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="td">
                    {t.asset_class
                      ? <span className="chip text-[11px]">{t.asset_class}</span>
                      : <span className="text-ink-500">—</span>}
                  </td>
                  <td className="td text-right mono">{amt(t.total_supply, t.decimals)}</td>
                  <td className="td text-right mono">{amt(t.redemption_price, sdecOf(t.settlement_denom))}</td>
                  <td className="td mono text-xs text-ink-300">{t.settlement_denom || '—'}</td>
                  <td className="td text-right"><StatusPill status={t.status} /></td>
                  <td className="td pr-4 text-right text-ink-600 group-hover:text-energy-400 transition-colors">
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}
              {tokens.items.length === 0 && (
                <EmptyRow colSpan={7} icon={Landmark} title="暂无 RWA 代币" hint="点击右上角「发行资产」创建首个真实世界资产代币。" />
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th">稳定币</th>
                <th className="th">锚定</th>
                <th className="th text-right">精度</th>
                <th className="th text-right">流通供应</th>
                <th className="th">管理员</th>
                <th className="th text-right">状态</th>
                <th className="th w-8" />
              </tr>
            </thead>
            <tbody>
              {denoms.items.map((d) => (
                <tr key={d.id} className="tr-row group">
                  <td className="td">
                    <Link href={`/assets/denom/${d.id}`} className="flex items-center gap-3">
                      <AssetBadge symbol={d.symbol || d.id} />
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:text-energy-400 transition-colors">{d.symbol || d.id}</span>
                        <span className="mono block text-xs text-ink-400">{d.id}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="td">
                    {d.peg_currency
                      ? <span className="chip text-[11px]">{d.peg_currency}</span>
                      : <span className="text-ink-500">—</span>}
                  </td>
                  <td className="td text-right text-ink-300">{d.decimals}</td>
                  <td className="td text-right mono">{amt(d.supply, d.decimals)}</td>
                  <td className="td mono text-xs text-ink-300">{shortAddr(d.admin, 6)}</td>
                  <td className="td text-right"><StatusPill status={d.status} /></td>
                  <td className="td pr-4 text-right text-ink-600 group-hover:text-energy-400 transition-colors">
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}
              {denoms.items.length === 0 && (
                <EmptyRow colSpan={7} icon={CircleDollarSign} title="暂无稳定币" hint="点击右上角「发行资产」创建首个链上稳定币。" />
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
