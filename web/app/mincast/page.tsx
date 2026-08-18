import Link from 'next/link';
import { Waves, ShieldCheck, Coins, Vault, Percent, ArrowUpRight } from 'lucide-react';
import { nativeApi } from '@/lib/native-api';
import { amt, price } from '@/lib/native-format';
import { PageHeader, EmptyBlock, AssetBadge, StatusPill } from '@/components/page-header';

export const revalidate = 10;

export default async function MincastPage() {
  const markets = await nativeApi.mincastMarkets().catch(() => ({ items: [] }));
  // settlement denom id → decimals, so treasury / floor price render in
  // human units rather than raw base units.
  const denoms = await nativeApi.denoms().catch(() => ({ items: [] }));
  const dec: Record<string, number> = {};
  for (const d of denoms.items) dec[d.id] = d.decimals;
  const sdecOf = (id: string) => dec[id] ?? 6;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Waves}
        title={<>Mincast <span className="text-ink-400 font-normal">联合曲线</span></>}
        subtitle="基于联合曲线 (bonding curve) 的即时铸造/熔毁市场，价格随供应连续变化，并提供保底价与定期投资收益。"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {markets.items.map((m) => {
          const sdec = sdecOf(m.settlement_denom);
          return (
            <Link
              key={m.id}
              href={`/mincast/${m.id}`}
              className="card card-hover group p-5 hover:border-energy-500/30"
            >
              <div className="flex items-center gap-3">
                <AssetBadge symbol={m.denom} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium group-hover:text-energy-400 transition-colors">
                      {m.name || m.denom}
                    </span>
                    <ArrowUpRight size={14} className="shrink-0 text-ink-600 opacity-0 -translate-y-0.5 translate-x-0.5 transition group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-energy-400" />
                  </div>
                  <div className="mono text-xs text-ink-400">{m.denom}</div>
                </div>
                <StatusPill status={m.status} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <Stat icon={<ShieldCheck size={13} />} k="保底价" v={price(m.floor_price, sdec)} accent />
                <Stat icon={<Coins size={13} />} k="供应" v={amt(m.supply, 0)} />
                <Stat icon={<Vault size={13} />} k="资金库" v={amt(m.treasury, sdec)} />
                <Stat icon={<Percent size={13} />} k="铸/熔费" v={`${(m.mint_fee_bps / 100).toFixed(1)} / ${(m.melt_fee_bps / 100).toFixed(1)}%`} />
              </div>
            </Link>
          );
        })}
        {markets.items.length === 0 && (
          <div className="card sm:col-span-2 lg:col-span-3">
            <EmptyBlock icon={Waves} title="暂无 Mincast 市场" hint="在「发行 → Mincast 市场」创建首条联合曲线。" />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, k, v, accent }: { icon: React.ReactNode; k: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-500">{icon}{k}</div>
      <div className={`mono mt-1 ${accent ? 'text-energy-400 font-medium' : 'text-ink-100'}`}>{v}</div>
    </div>
  );
}
