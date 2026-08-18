'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CirclePlus, Landmark, CircleDollarSign, Rocket, CandlestickChart, Waves } from 'lucide-react';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { nativeApi } from '@/lib/native-api';
import { toBaseUnits } from '@/lib/format';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult, ConnectGate } from '@/components/native/ui';
import { PageHeader } from '@/components/page-header';
import { CreateMarketForm } from '../trade/create-market-form';

type Tab = 'denom' | 'token' | 'offering' | 'mincast' | 'market';

export default function IssuePage() {
  return (
    <Suspense fallback={<div className="card p-12 text-center text-sm text-ink-400">加载中…</div>}>
      <IssueInner />
    </Suspense>
  );
}

function IssueInner() {
  const sp = useSearchParams();
  const initial = (sp.get('tab') as Tab) || 'token';
  const [tab, setTab] = useState<Tab>(['denom', 'token', 'offering', 'mincast', 'market'].includes(initial) ? initial : 'token');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'token', label: 'RWA 代币', icon: <Landmark size={13} /> },
    { id: 'denom', label: '稳定币', icon: <CircleDollarSign size={13} /> },
    { id: 'offering', label: '募资', icon: <Rocket size={13} /> },
    { id: 'market', label: '订单簿市场', icon: <CandlestickChart size={13} /> },
    { id: 'mincast', label: 'Mincast 市场', icon: <Waves size={13} /> },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader
        icon={CirclePlus}
        title={<>发行 <span className="text-ink-400 font-normal">Issue</span></>}
        subtitle="在链上原生模块创建资产、募资项目或联合曲线市场。需要相应权限或满足合规策略。"
      />

      <div className="flex flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'tab-pill-on' : 'tab-pill-off'}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <ConnectGate>
        {tab === 'token' && <CreateToken />}
        {tab === 'denom' && <CreateDenom />}
        {tab === 'offering' && <CreateOffering />}
        {tab === 'market' && <CreateMarketForm />}
        {tab === 'mincast' && <CreateMincast />}
      </ConnectGate>
    </div>
  );
}

function CreateToken() {
  const tx = useNativeTx();
  const [v, setV] = useState({ symbol: '', name: '', assetClass: '', decimals: '0', settlementDenom: '', policyId: '', metadataUri: '', requireKyc: false });
  const submit = () => tx.run([msg(MSGS.CreateToken.typeUrl, {
    admin: tx.address, symbol: v.symbol, name: v.name, assetClass: v.assetClass, decimals: v.decimals,
    settlementDenom: v.settlementDenom, policyId: v.policyId, requireKyc: v.requireKyc, metadataUri: v.metadataUri,
  })]);
  return (
    <div className="card p-5 space-y-3">
      <Field label="代号 Symbol" value={v.symbol} onChange={(x) => setV({ ...v, symbol: x })} placeholder="SOLAR-A" />
      <Field label="名称 Name" value={v.name} onChange={(x) => setV({ ...v, name: x })} placeholder="Solar Farm A 2026" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="资产类别" value={v.assetClass} onChange={(x) => setV({ ...v, assetClass: x })} placeholder="renewable" />
        <Field label="精度" value={v.decimals} onChange={(x) => setV({ ...v, decimals: x })} type="number" />
      </div>
      <Field label="结算稳定币 ID" value={v.settlementDenom} onChange={(x) => setV({ ...v, settlementDenom: x })} placeholder="usd1" />
      <Field label="合规策略 ID (可选)" value={v.policyId} onChange={(x) => setV({ ...v, policyId: x })} placeholder="kyc-accredited" />
      <Field label="元数据 URI (可选)" value={v.metadataUri} onChange={(x) => setV({ ...v, metadataUri: x })} placeholder="ipfs://…" />
      <label className="flex items-center gap-2 text-sm text-ink-300">
        <input type="checkbox" checked={v.requireKyc} onChange={(e) => setV({ ...v, requireKyc: e.target.checked })} /> 要求 KYC
      </label>
      <SubmitButton tx={tx} label="创建 RWA 代币" onClick={submit} disabled={!v.symbol || !v.name} />
      <TxResult tx={tx} />
    </div>
  );
}

function CreateDenom() {
  const tx = useNativeTx();
  const [v, setV] = useState({ id: '', symbol: '', decimals: '6', pegCurrency: 'USD', policyId: '' });
  const submit = () => tx.run([msg(MSGS.CreateDenom.typeUrl, {
    authority: tx.address, id: v.id, symbol: v.symbol, decimals: v.decimals, pegCurrency: v.pegCurrency, admin: tx.address, policyId: v.policyId,
  })]);
  return (
    <div className="card p-5 space-y-3">
      <Field label="Denom ID" value={v.id} onChange={(x) => setV({ ...v, id: x })} placeholder="usd1" />
      <Field label="代号 Symbol" value={v.symbol} onChange={(x) => setV({ ...v, symbol: x })} placeholder="USD1" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="精度" value={v.decimals} onChange={(x) => setV({ ...v, decimals: x })} type="number" />
        <Field label="锚定货币" value={v.pegCurrency} onChange={(x) => setV({ ...v, pegCurrency: x })} placeholder="USD" />
      </div>
      <Field label="合规策略 ID (可选)" value={v.policyId} onChange={(x) => setV({ ...v, policyId: x })} />
      <SubmitButton tx={tx} label="创建稳定币" onClick={submit} disabled={!v.id || !v.symbol} />
      <TxResult tx={tx} />
    </div>
  );
}

// <input type="datetime-local"> uses local-time "YYYY-MM-DDTHH:mm"; the chain
// wants unix seconds. These helpers convert both ways without pulling a date lib.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toUnixSeconds(local: string): string {
  if (!local) return '';
  const ms = new Date(local).getTime();
  return Number.isNaN(ms) ? '' : String(Math.floor(ms / 1000));
}

function CreateOffering() {
  const tx = useNativeTx();
  const [v, setV] = useState({ tokenId: '', unitPrice: '', softCap: '', hardCap: '', startAt: '', endAt: '', totalTranches: '1', requiredInjection: '0', injectionInterval: '0' });

  // Resolve the settlement denom + decimals from the chosen RWA token so the
  // price/cap inputs can be entered in human units (e.g. "1.5" = 1.5 usdc).
  const [settle, setSettle] = useState<{ denom: string; dec: number } | null>(null);
  useEffect(() => {
    if (!/^\d+$/.test(v.tokenId)) { setSettle(null); return; }
    let active = true;
    nativeApi.rwaToken(v.tokenId).then(async (t) => {
      if (!t.settlement_denom) { if (active) setSettle(null); return; }
      try { const d = await nativeApi.denom(t.settlement_denom); if (active) setSettle({ denom: t.settlement_denom, dec: d.decimals ?? 6 }); }
      catch { if (active) setSettle({ denom: t.settlement_denom, dec: 6 }); }
    }).catch(() => { if (active) setSettle(null); });
    return () => { active = false; };
  }, [v.tokenId]);
  const sdec = settle?.dec ?? 6;
  const sden = settle?.denom ?? '结算币';

  // Default the window to now → +30 days on mount (client-only, avoids SSR
  // hydration mismatch from new Date()).
  useEffect(() => {
    const now = new Date();
    const in30d = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    setV((prev) => ({ ...prev, startAt: prev.startAt || toLocalInput(now), endAt: prev.endAt || toLocalInput(in30d) }));
  }, []);

  const startUnix = toUnixSeconds(v.startAt);
  const endUnix = toUnixSeconds(v.endAt);
  const badWindow = !!startUnix && !!endUnix && Number(endUnix) <= Number(startUnix);

  const submit = () => tx.run([msg(MSGS.CreateOffering.typeUrl, {
    issuer: tx.address, tokenId: v.tokenId,
    unitPrice: toBaseUnits(v.unitPrice || '0', sdec).toString(),
    softCap: toBaseUnits(v.softCap || '0', sdec).toString(),
    hardCap: toBaseUnits(v.hardCap || '0', sdec).toString(),
    startTime: startUnix, endTime: endUnix, totalTranches: v.totalTranches, requiredInjection: v.requiredInjection, injectionInterval: v.injectionInterval,
  })]);
  return (
    <div className="card p-5 space-y-3">
      <Field label="标的 RWA 代币 ID" value={v.tokenId} onChange={(x) => setV({ ...v, tokenId: x })} type="number"
        hint={settle ? `结算币 ${sden}（金额按其单位输入，如 1 = 1 ${sden}）` : undefined} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`单价 (${sden}/单位)`} value={v.unitPrice} onChange={(x) => setV({ ...v, unitPrice: x })} type="number" placeholder="0.0" />
        <Field label="期数 Tranches" value={v.totalTranches} onChange={(x) => setV({ ...v, totalTranches: x })} type="number" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`软顶 Soft cap (${sden})`} value={v.softCap} onChange={(x) => setV({ ...v, softCap: x })} type="number" placeholder="0.0" />
        <Field label={`硬顶 Hard cap (${sden})`} value={v.hardCap} onChange={(x) => setV({ ...v, hardCap: x })} type="number" placeholder="0.0" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="开始时间" value={v.startAt} onChange={(x) => setV({ ...v, startAt: x })} type="datetime-local" hint={startUnix ? `unix ${startUnix}` : undefined} />
        <Field label="结束时间" value={v.endAt} onChange={(x) => setV({ ...v, endAt: x })} type="datetime-local" hint={endUnix ? `unix ${endUnix}` : undefined} />
      </div>
      {badWindow && <div className="text-[11px] text-bear-300">结束时间必须晚于开始时间</div>}
      <SubmitButton tx={tx} label="发起募资" onClick={submit} disabled={!v.tokenId || !v.hardCap || !startUnix || !endUnix || badWindow} />
      <TxResult tx={tx} />
    </div>
  );
}

function CreateMincast() {
  const tx = useNativeTx();
  const [v, setV] = useState({ denom: '', name: '', settlementDenom: '', initialPrice: '', mintFeeBps: '0', meltFeeBps: '0', policyId: '', requireKyc: false });

  // Resolve settlement decimals so the initial price is entered in human units.
  const [sdec, setSdec] = useState(6);
  useEffect(() => {
    if (!v.settlementDenom) { setSdec(6); return; }
    let active = true;
    nativeApi.denom(v.settlementDenom).then((d) => { if (active) setSdec(d.decimals ?? 6); }).catch(() => { if (active) setSdec(6); });
    return () => { active = false; };
  }, [v.settlementDenom]);

  const submit = () => tx.run([msg(MSGS.MincastCreateMarket.typeUrl, {
    admin: tx.address, denom: v.denom, name: v.name, settlementDenom: v.settlementDenom,
    initialPrice: toBaseUnits(v.initialPrice || '0', sdec).toString(),
    mintFeeBps: v.mintFeeBps, meltFeeBps: v.meltFeeBps, policyId: v.policyId, requireKyc: v.requireKyc,
  })]);
  return (
    <div className="card p-5 space-y-3">
      <Field label="代币 Denom" value={v.denom} onChange={(x) => setV({ ...v, denom: x })} placeholder="carbon1" />
      <Field label="名称 Name" value={v.name} onChange={(x) => setV({ ...v, name: x })} placeholder="Carbon Credit Curve" />
      <Field label="结算稳定币 ID" value={v.settlementDenom} onChange={(x) => setV({ ...v, settlementDenom: x })} placeholder="usd1" />
      <Field label={`初始价 (${v.settlementDenom || '结算币'}/单位)`} value={v.initialPrice} onChange={(x) => setV({ ...v, initialPrice: x })} type="number" placeholder="0.0" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="铸造费 (bps)" value={v.mintFeeBps} onChange={(x) => setV({ ...v, mintFeeBps: x })} type="number" />
        <Field label="熔毁费 (bps)" value={v.meltFeeBps} onChange={(x) => setV({ ...v, meltFeeBps: x })} type="number" />
      </div>
      <Field label="合规策略 ID (可选)" value={v.policyId} onChange={(x) => setV({ ...v, policyId: x })} />
      <label className="flex items-center gap-2 text-sm text-ink-300">
        <input type="checkbox" checked={v.requireKyc} onChange={(e) => setV({ ...v, requireKyc: e.target.checked })} /> 要求 KYC
      </label>
      <SubmitButton tx={tx} label="创建 Mincast 市场" onClick={submit} disabled={!v.denom || !v.name} />
      <TxResult tx={tx} />
    </div>
  );
}
