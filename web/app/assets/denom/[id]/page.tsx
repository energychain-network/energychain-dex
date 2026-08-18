import Link from 'next/link';
import { notFound } from 'next/navigation';
import { nativeApi } from '@/lib/native-api';
import { amt, statusBadge, toneClass } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { DenomActions } from './actions';

export const revalidate = 10;

export default async function DenomPage({ params }: { params: { id: string } }) {
  const denom = await nativeApi.denom(params.id).catch(() => null);
  if (!denom) notFound();
  const sb = statusBadge(denom.status);

  return (
    <div className="space-y-4">
      <Link href="/assets?tab=stable" className="text-xs text-ink-400 hover:text-ink-100">← 返回资产</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{denom.symbol || denom.id}</h1>
            <span className={`chip ${toneClass(sb.tone)}`}>{sb.label}</span>
          </div>
          <p className="mt-1 mono text-xs text-ink-400">{denom.id}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 card p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Info k="锚定货币" v={denom.peg_currency || '—'} />
          <Info k="精度" v={String(denom.decimals)} />
          <Info k="流通供应" v={amt(denom.supply, denom.decimals)} />
          <Info k="储备充足率要求" v={`${(denom.required_ratio_bps / 100).toFixed(2)}%`} />
          <Info k="储备预言机" v={denom.reserve_topic || '—'} mono />
          <Info k="合规策略" v={denom.policy_id || '—'} mono />
          <Info k="管理员" v={shortAddr(denom.admin, 6)} mono />
          <Info k="铸币方数" v={String(denom.minters?.length || 0)} />
        </div>
        <DenomActions denom={denom} />
      </div>
    </div>
  );
}

function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-400">{k}</div>
      <div className={`mt-0.5 ${mono ? 'mono text-xs break-all' : 'font-medium'}`}>{v}</div>
    </div>
  );
}
