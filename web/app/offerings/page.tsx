import Link from 'next/link';
import { Rocket, CirclePlus, CalendarClock, Tag, ArrowUpRight } from 'lucide-react';
import { nativeApi } from '@/lib/native-api';
import { amt, epoch } from '@/lib/native-format';
import { PageHeader, EmptyBlock, AssetBadge, StatusPill } from '@/components/page-header';

export const revalidate = 10;

export default async function OfferingsPage() {
  const offerings = await nativeApi.offerings().catch(() => ({ items: [] }));
  const denoms = await nativeApi.denoms().catch(() => ({ items: [] }));
  const dec: Record<string, number> = {};
  for (const d of denoms.items) dec[d.id] = d.decimals;
  const sdecOf = (id: string) => dec[id] ?? 6;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Rocket}
        title={<>募资 <span className="text-ink-400 font-normal">Offerings</span></>}
        subtitle="RWA 首次发行 (IRO)：认购、按软/硬顶分配、分期注资与收益分发。"
      >
        <Link href="/issue?tab=offering" className="btn-outline text-sm">
          <CirclePlus size={15} /> 发起募资
        </Link>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        {offerings.items.map((o) => {
          const pct = Number(o.hard_cap) > 0 ? Math.min(100, (Number(o.raised) / Number(o.hard_cap)) * 100) : 0;
          const softPct = Number(o.hard_cap) > 0 ? Math.min(100, (Number(o.soft_cap) / Number(o.hard_cap)) * 100) : 0;
          const sdec = sdecOf(o.denom);
          return (
            <Link
              key={o.id}
              href={`/offerings/${o.id}`}
              className="card card-hover group p-5 hover:border-energy-500/30"
            >
              <div className="flex items-center gap-3">
                <AssetBadge symbol={`T${o.token_id}`} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium group-hover:text-energy-400 transition-colors">募资 #{o.id}</span>
                    <ArrowUpRight size={14} className="shrink-0 text-ink-600 opacity-0 -translate-y-0.5 translate-x-0.5 transition group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-energy-400" />
                  </div>
                  <div className="text-xs text-ink-400">标的代币 #{o.token_id}</div>
                </div>
                <StatusPill status={o.status} />
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex items-baseline justify-between text-xs text-ink-400">
                  <span>
                    已募 <span className="mono text-sm text-ink-100">{amt(o.raised, sdec)}</span>
                  </span>
                  <span className="mono text-energy-400">{pct.toFixed(pct > 0 && pct < 1 ? 1 : 0)}%</span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-energy-500 to-energy-400 transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="absolute inset-y-0 w-px bg-amber-300/90" style={{ left: `${softPct}%` }} title="软顶" />
                </div>
                <div className="flex justify-between text-xs text-ink-500">
                  <span>软顶 <span className="mono text-ink-400">{amt(o.soft_cap, sdec)}</span></span>
                  <span>硬顶 <span className="mono text-ink-400">{amt(o.hard_cap, sdec)}</span></span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1.5">
                  <Tag size={12} className="text-ink-500" />
                  单价 <span className="mono text-ink-200">{amt(o.unit_price, sdec)}</span> {o.denom}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock size={12} className="text-ink-500" />
                  截止 {epoch(o.end_time)}
                </span>
              </div>
            </Link>
          );
        })}
        {offerings.items.length === 0 && (
          <div className="card sm:col-span-2">
            <EmptyBlock icon={Rocket} title="暂无募资项目" hint="点击右上角「发起募资」创建首个 RWA 首次发行。" />
          </div>
        )}
      </div>
    </div>
  );
}
