import Link from 'next/link';
import { notFound } from 'next/navigation';
import { nativeApi } from '@/lib/native-api';
import { amt, statusBadge, toneClass, epoch } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { RwaActions } from './actions';
import { OfferingReturnsTable } from './offering-returns';

export const revalidate = 10;

export default async function RwaTokenPage({ params }: { params: { id: string } }) {
  const token = await nativeApi.rwaToken(params.id).catch(() => null);
  if (!token) notFound();
  const [dist, reds, sDenom] = await Promise.all([
    nativeApi.rwaDistributions(params.id).catch(() => ({ items: [] })),
    nativeApi.rwaRedemptions(params.id).catch(() => ({ items: [] })),
    nativeApi.denom(token.settlement_denom).catch(() => null),
  ]);
  const sb = statusBadge(token.status);
  // Redemption price, dividend pool, distribution totals and payouts are
  // denominated in the settlement stablecoin's base units.
  const sdec = sDenom?.decimals ?? 6;

  return (
    <div className="space-y-4">
      <Link href="/assets?tab=rwa" className="text-xs text-ink-400 hover:text-ink-100">← 返回资产</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{token.symbol}</h1>
            <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>
            {token.require_kyc && <span className="chip">KYC</span>}
          </div>
          <p className="mt-1 text-sm text-ink-400">{token.name} · {token.asset_class || '资产'}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Info k="总供应" v={amt(token.total_supply, token.decimals)} />
            <Info k="精度" v={String(token.decimals)} />
            <Info k="结算币" v={token.settlement_denom || '—'} mono />
            <Info k={`赎回价 (${token.settlement_denom})`} v={amt(token.redemption_price, sdec)} />
            <Info k="赎回延迟" v={`${token.redemption_delay_seconds || 0}s`} />
            <Info k="单户上限" v={amt(token.per_holder_cap, token.decimals)} />
            <Info k={`分红资金池 (${token.settlement_denom})`} v={amt(token.pool_balance, sdec)} />
            <Info k="合规策略" v={token.policy_id || '—'} mono />
            <Info k="管理员" v={shortAddr(token.admin, 6)} mono />
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">分红 Distributions</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-400"><tr className="bg-white/[0.02]">
                <th className="px-4 py-2">#</th><th className="px-4 py-2">快照</th><th className="px-4 py-2">币种</th>
                <th className="px-4 py-2 text-right">总额</th><th className="px-4 py-2 text-right">已领取</th><th className="px-4 py-2 text-right">时间</th>
              </tr></thead>
              <tbody>
                {dist.items.map((d: any) => (
                  <tr key={d.id} className="border-t border-white/5">
                    <td className="px-4 py-2 mono">{d.id}</td>
                    <td className="px-4 py-2 mono">{d.snapshot_id}</td>
                    <td className="px-4 py-2 mono text-xs">{d.denom}</td>
                    <td className="px-4 py-2 text-right mono">{amt(d.total_amount, sdec)}</td>
                    <td className="px-4 py-2 text-right mono">{amt(d.claimed_amount, sdec)}</td>
                    <td className="px-4 py-2 text-right text-xs text-ink-400">{epoch(d.created_at)}</td>
                  </tr>
                ))}
                {dist.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-400">暂无分红。</td></tr>}
              </tbody>
            </table>
          </div>

          <OfferingReturnsTable token={token} sdec={sdec} />

          <div className="card overflow-hidden">
            <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">赎回 Redemptions</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-400"><tr className="bg-white/[0.02]">
                <th className="px-4 py-2">#</th><th className="px-4 py-2">持有人</th>
                <th className="px-4 py-2 text-right">数量</th><th className="px-4 py-2 text-right">赔付</th>
                <th className="px-4 py-2 text-right">可执行</th><th className="px-4 py-2 text-right">状态</th>
              </tr></thead>
              <tbody>
                {reds.items.map((d: any) => {
                  const s = statusBadge(d.status);
                  return (
                    <tr key={d.id} className="border-t border-white/5">
                      <td className="px-4 py-2 mono">{d.id}</td>
                      <td className="px-4 py-2 mono text-xs">{shortAddr(d.holder, 5)}</td>
                      <td className="px-4 py-2 text-right mono">{amt(d.units, token.decimals)}</td>
                      <td className="px-4 py-2 text-right mono">{amt(d.payout, sdec)}</td>
                      <td className="px-4 py-2 text-right text-xs text-ink-400">{epoch(d.execute_after)}</td>
                      <td className="px-4 py-2 text-right"><span className={`chip ${toneClass(s.tone)}`}>{s.label}</span></td>
                    </tr>
                  );
                })}
                {reds.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-400">暂无赎回。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <RwaActions token={token} />
      </div>
    </div>
  );
}

function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-400">{k}</div>
      <div className={`mt-0.5 ${mono ? 'mono text-xs' : 'font-medium'}`}>{v}</div>
    </div>
  );
}
