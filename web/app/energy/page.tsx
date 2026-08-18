import Link from 'next/link';
import { Zap, SatelliteDish, Cpu, Users, Radio, Clock, Landmark } from 'lucide-react';
import { nativeApi } from '@/lib/native-api';
import { amt, epoch } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { PageHeader, EmptyBlock, EmptyRow, StatusPill } from '@/components/page-header';

export const revalidate = 15;

export default async function EnergyPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = searchParams?.tab || 'topics';
  const [devices, providers, topics] = await Promise.all([
    nativeApi.devices().catch(() => ({ items: [] })),
    nativeApi.providers().catch(() => ({ items: [] })),
    nativeApi.topics().catch(() => ({ items: [] })),
  ]);

  const tabs = [
    { id: 'topics', label: '预言机', icon: <SatelliteDish size={13} /> },
    { id: 'devices', label: '设备/电表', icon: <Cpu size={13} /> },
    { id: 'providers', label: '数据提供方', icon: <Users size={13} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Zap}
        title={<>能源数据 <span className="text-ink-400 font-normal">Energy</span></>}
        subtitle="AssetHub 链上能源计量：IoT 设备、电表读数、聚合预言机与数据提供方质押。"
      >
        <div className="tabstrip">
          {tabs.map((t) => (
            <Link key={t.id} href={`/energy?tab=${t.id}`} className={tab === t.id ? 'tab-pill-on' : 'tab-pill-off'}>
              {t.icon} {t.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      {tab === 'topics' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.items.map((t) => (
            <div key={t.id} className="card card-hover p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/5 bg-white/[0.03] text-energy-400">
                    <Radio size={15} />
                  </span>
                  <span className="mono truncate text-sm font-medium">{t.id}</span>
                </div>
                <span className={`chip shrink-0 ${t.has_value ? 'border-bull/20 bg-bull/10 text-bull-400' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${t.has_value ? 'bg-bull-400 animate-pulseDot' : 'bg-ink-400'}`} />
                  {t.has_value ? '有效' : '待定'}
                </span>
              </div>
              <div className="mt-1.5 truncate text-xs text-ink-400">{t.description || '—'}</div>
              <div className="mono mt-4 text-2xl font-semibold tracking-tight">{amt(t.value, 0)}</div>
              <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1.5">
                  <Users size={12} className="text-ink-500" /> 来源 {t.source_count}/{t.min_sources}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={12} className="text-ink-500" /> {epoch(t.updated_at)}
                </span>
              </div>
            </div>
          ))}
          {topics.items.length === 0 && (
            <div className="card sm:col-span-2 lg:col-span-3">
              <EmptyBlock icon={SatelliteDish} title="暂无预言机主题" hint="注册数据提供方并推送首个喂价后展示。" />
            </div>
          )}
        </div>
      )}

      {tab === 'devices' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th">设备</th>
                <th className="th">类型</th>
                <th className="th">运营方</th>
                <th className="th">辖区</th>
                <th className="th text-right">状态</th>
              </tr>
            </thead>
            <tbody>
              {devices.items.map((d) => (
                <tr key={d.id} className="tr-row group">
                  <td className="td">
                    <Link href={`/energy/device/${d.id}`} className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/5 bg-white/[0.03] text-ink-300">
                        <Cpu size={13} />
                      </span>
                      <span className="font-medium group-hover:text-energy-400 transition-colors">{d.id}</span>
                    </Link>
                  </td>
                  <td className="td"><span className="chip text-[11px]">{d.device_type}</span></td>
                  <td className="td mono text-xs text-ink-300">{shortAddr(d.operator, 5)}</td>
                  <td className="td text-ink-300">{d.jurisdiction || '—'}</td>
                  <td className="td text-right"><StatusPill status={d.status} /></td>
                </tr>
              ))}
              {devices.items.length === 0 && <EmptyRow colSpan={5} icon={Cpu} title="暂无设备" hint="通过 assethub 模块注册 IoT 设备与电表。" />}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'providers' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th">地址</th>
                <th className="th">角色</th>
                <th className="th">名称</th>
                <th className="th text-right">质押</th>
                <th className="th text-right">违规</th>
                <th className="th text-right">状态</th>
              </tr>
            </thead>
            <tbody>
              {providers.items.map((p) => (
                <tr key={p.address} className="tr-row">
                  <td className="td mono text-xs">{shortAddr(p.address, 6)}</td>
                  <td className="td"><span className="chip text-[11px]">{p.role}</span></td>
                  <td className="td">{p.display_name || '—'}</td>
                  <td className="td text-right mono">
                    <span className="inline-flex items-center gap-1.5">
                      <Landmark size={12} className="text-ink-500" />
                      {amt(p.bond, 0)}
                    </span>
                  </td>
                  <td className="td text-right">
                    {p.infractions > 0
                      ? <span className="text-bear-400 font-medium">{p.infractions}</span>
                      : <span className="text-ink-500">0</span>}
                  </td>
                  <td className="td text-right"><StatusPill status={p.status} /></td>
                </tr>
              ))}
              {providers.items.length === 0 && <EmptyRow colSpan={6} icon={Users} title="暂无数据提供方" hint="注册喂价/计量/公证节点并缴纳可罚没保证金。" />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
