import Link from 'next/link';
import { nativeApi } from '@/lib/native-api';
import { amt, statusBadge, toneClass, epoch } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';

export const revalidate = 15;

export default async function DevicePage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const [devices, readings] = await Promise.all([
    nativeApi.devices().catch(() => ({ items: [] })),
    nativeApi.readings(id, 100).catch(() => ({ items: [] })),
  ]);
  const device = devices.items.find((d) => d.id === id);
  const sb = statusBadge(device?.status);

  return (
    <div className="space-y-4">
      <Link href="/energy?tab=devices" className="text-xs text-ink-400 hover:text-ink-100">← 返回能源</Link>
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{id}</h1>
          {device && <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>}
        </div>
        {device && <p className="mt-1 text-sm text-ink-400">{device.device_type} · 运营方 {shortAddr(device.operator, 6)} · {device.jurisdiction || '—'}</p>}
      </header>

      {device && (
        <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Info k="固件" v={device.firmware || '—'} />
          <Info k="辖区" v={device.jurisdiction || '—'} />
          <Info k="证明哈希" v={device.attestation_hash ? shortAddr(device.attestation_hash, 6) : '—'} mono />
          <Info k="注册时间" v={epoch(device.created_at)} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">读数 Readings</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400"><tr className="bg-white/[0.02]">
            <th className="px-4 py-2">#</th><th className="px-4 py-2">周期</th><th className="px-4 py-2">单位</th>
            <th className="px-4 py-2 text-right">IoT 值</th><th className="px-4 py-2 text-right">运营值</th><th className="px-4 py-2 text-right">校验</th>
          </tr></thead>
          <tbody>
            {readings.items.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-4 py-2 mono">{r.id}</td>
                <td className="px-4 py-2 text-xs text-ink-400">{epoch(r.period_start)} → {epoch(r.period_end)}</td>
                <td className="px-4 py-2">{r.unit}</td>
                <td className="px-4 py-2 text-right mono">{amt(r.iot_value, 0)}</td>
                <td className="px-4 py-2 text-right mono">{amt(r.operational_value, 0)}</td>
                <td className="px-4 py-2 text-right">{r.verified ? <span className="chip border-bull/20 bg-bull/10 text-bull-400">已校验</span> : <span className="chip">未校验</span>}</td>
              </tr>
            ))}
            {readings.items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-400">暂无读数。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div><div className="text-xs text-ink-400">{k}</div><div className={`mt-0.5 ${mono ? 'mono text-xs' : 'font-medium'}`}>{v}</div></div>;
}
