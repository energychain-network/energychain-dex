import Link from 'next/link';
import { notFound } from 'next/navigation';
import { nativeApi } from '@/lib/native-api';
import { amt, statusBadge, toneClass, epoch } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { OfferingActions } from './actions';

export const revalidate = 5;

export default async function OfferingPage({ params }: { params: { id: string } }) {
  const offering = await nativeApi.offering(params.id).catch(() => null);
  if (!offering) notFound();
  const sb = statusBadge(offering.status);
  const pct = Number(offering.hard_cap) > 0 ? Math.min(100, (Number(offering.raised) / Number(offering.hard_cap)) * 100) : 0;
  const softPct = Number(offering.hard_cap) > 0 ? Math.min(100, (Number(offering.soft_cap) / Number(offering.hard_cap)) * 100) : 0;
  // Subscription capital / treasury / unit price are in the settlement
  // denom's base units; allocated units are in the RWA token's base units.
  const sDenom = await nativeApi.denom(offering.denom).catch(() => null);
  const token = await nativeApi.rwaToken(offering.token_id).catch(() => null);
  const sdec = sDenom?.decimals ?? 6;
  const tdec = token?.decimals ?? 0;

  return (
    <div className="space-y-4">
      <Link href="/offerings" className="text-xs text-ink-400 hover:text-ink-100">← 返回募资</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">募资 #{offering.id}</h1>
            <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>
          </div>
          <p className="mt-1 text-sm text-ink-400">标的代币 #{offering.token_id} · 发行方 {shortAddr(offering.issuer, 6)}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4 space-y-2">
            <div className="relative h-3 rounded-full bg-white/5 overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-energy-500/60" style={{ width: `${pct}%` }} />
              {/* soft-cap marker */}
              <div className="absolute inset-y-0 w-px bg-amber-300/80" style={{ left: `${softPct}%` }} title="软顶 Soft cap" />
            </div>
            <div className="flex justify-between text-sm">
              <span>已募 <span className="mono text-energy-400">{amt(offering.raised, sdec)}</span> {offering.denom} <span className="text-ink-500">({pct.toFixed(1)}%)</span></span>
              <span className="text-ink-400">软顶 {amt(offering.soft_cap, sdec)} / 硬顶 {amt(offering.hard_cap, sdec)}</span>
            </div>
          </div>

          <div className="card p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Info k="单价" v={`${amt(offering.unit_price, sdec)} ${offering.denom}`} />
            <Info k="开始" v={epoch(offering.start_time)} />
            <Info k="结束" v={epoch(offering.end_time)} />
            <Info k="已分配单位" v={amt(offering.allocated_units, tdec)} />
            <Info k="期数" v={`${offering.released_tranches}/${offering.total_tranches}`} />
            <Info k="已注资" v={`${amt(offering.injected_total, sdec)} ${offering.denom}`} />
            <Info k="资金库" v={`${amt(offering.treasury, sdec)} ${offering.denom}`} />
            <Info k="收益池" v={`${amt(offering.returns_pool, sdec)} ${offering.denom}`} />
            <Info k="成功时间" v={epoch(offering.succeeded_at)} />
          </div>

          {offering.subscriptions && offering.subscriptions.length > 0 && (
            <div className="card overflow-hidden">
              <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">认购者</div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-400"><tr className="bg-white/[0.02]">
                  <th className="px-4 py-2">投资者</th><th className="px-4 py-2 text-right">出资</th>
                  <th className="px-4 py-2 text-right">单位</th><th className="px-4 py-2 text-right">状态</th>
                </tr></thead>
                <tbody>
                  {offering.subscriptions.map((s) => (
                    <tr key={s.investor} className="border-t border-white/5">
                      <td className="px-4 py-2 mono text-xs">{shortAddr(s.investor, 5)}</td>
                      <td className="px-4 py-2 text-right mono">{amt(s.contributed, sdec)}</td>
                      <td className="px-4 py-2 text-right mono">{amt(s.units, tdec)}</td>
                      <td className="px-4 py-2 text-right text-xs">{s.refunded ? '已退款' : s.allocated ? '已分配' : '待分配'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <OfferingActions offering={offering} sdec={sdec} />
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return <div><div className="text-xs text-ink-400">{k}</div><div className="mt-0.5 font-medium">{v}</div></div>;
}
