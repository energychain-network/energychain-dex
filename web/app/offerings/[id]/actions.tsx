'use client';

import { useCallback, useEffect, useState } from 'react';
import { nativeApi, type Offering } from '@/lib/native-api';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { useCosmos } from '@/lib/cosmos-wallet';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';
import { amt } from '@/lib/native-format';
import { fromBaseUnits, toBaseUnits } from '@/lib/format';

export function OfferingActions({ offering, sdec }: { offering: Offering; sdec: number }) {
  const tx = useNativeTx();
  const { address } = useCosmos();
  // The chain requires the contribution to be an exact multiple of unit_price
  // (allocated units = amount / unit_price). So we let the investor pick a whole
  // number of units and derive the contribution, which is always valid.
  const [units, setUnits] = useState('');

  // The server-rendered snapshot can be stale: other investors keep subscribing,
  // so its raised/cap would mislead the "remaining" math and let the user submit
  // an amount the chain rejects with a cap violation. Track the live offering and
  // refresh it on mount, on an interval, and right after our own tx.
  const [live, setLive] = useState<Offering>(offering);
  const refresh = useCallback(async () => {
    try { setLive(await nativeApi.offering(offering.id)); } catch { /* keep last good snapshot */ }
  }, [offering.id]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Investor's settlement balance (raw minimal units) so we can show what they
  // can afford and cap the "max" button at the lesser of cap-room and balance.
  const [bal, setBal] = useState('0');
  useEffect(() => {
    if (!address) { setBal('0'); return; }
    nativeApi.denomBalance(offering.denom, address).then((r) => setBal(r.amount || '0')).catch(() => setBal('0'));
  }, [address, offering.denom, tx.txhash]);

  const isIssuer = address && address.toLowerCase() === live.issuer.toLowerCase();
  const isOpen = live.status === 'OFFERING_STATUS_OPEN';

  const unitPrice = (() => { try { return BigInt(live.unit_price || '0'); } catch { return 0n; } })();
  const remaining = (() => {
    try { const r = BigInt(live.hard_cap || '0') - BigInt(live.raised || '0'); return r > 0n ? r : 0n; } catch { return 0n; }
  })();
  const capUnits = unitPrice > 0n ? remaining / unitPrice : 0n;
  const affordUnits = unitPrice > 0n ? (() => { try { return BigInt(bal) / unitPrice; } catch { return 0n; } })() : 0n;
  const maxUnits = capUnits < affordUnits ? capUnits : affordUnits;

  const validUnits = /^\d+$/.test(units) && BigInt(units) > 0n;
  const cost = validUnits ? (BigInt(units) * unitPrice).toString() : '0';
  const overCap = validUnits && BigInt(cost) > remaining;
  const overBal = validUnits && (() => { try { return BigInt(cost) > BigInt(bal); } catch { return false; } })();

  const sub = async () => {
    if (!address || !validUnits || overCap || overBal) return;
    const ok = await tx.run([msg(MSGS.Subscribe.typeUrl, { investor: address, offeringId: live.id, amount: cost })]);
    if (ok) setUnits('');
    refresh();
  };
  const simple = (typeUrl: string, key: 'investor' | 'issuer' = 'investor') =>
    async () => { if (address) { await tx.run([msg(typeUrl, { [key]: address, offeringId: live.id })]); refresh(); } };

  return (
    <div className="card p-4 space-y-4 h-fit lg:sticky lg:top-20">
      <div>
        <div className="text-sm font-medium mb-2">认购 Subscribe</div>
        <Field label="认购单位数 (units)" value={units} onChange={setUnits} type="number" placeholder="0"
          hint={`单价 ${amt(live.unit_price, sdec)} ${live.denom} / 单位 · 可用 ${amt(bal, sdec)} ${live.denom}`}
          right={isOpen && maxUnits > 0n ? (
            <button type="button" onClick={() => setUnits(maxUnits.toString())}
              className="text-[11px] text-energy-400 hover:text-energy-300">最大 {maxUnits.toString()}</button>
          ) : undefined} />
        <div className="mt-1 text-[11px] text-ink-500">
          出资合计 <span className="text-ink-300 mono">{amt(cost, sdec)} {live.denom}</span>
          <span className="text-ink-600"> · 剩余 {amt(remaining.toString(), sdec)} {live.denom}（额度内最多 {capUnits.toString()} 单位）</span>
        </div>
        {overBal && <div className="mt-1 text-[11px] text-bear-300">余额不足，按可用余额最多认购 {affordUnits.toString()} 单位</div>}
        {overCap && !overBal && <div className="mt-1 text-[11px] text-bear-300">超过剩余额度，最多认购 {capUnits.toString()} 单位</div>}
        {!isOpen && <div className="mt-1 text-[11px] text-bear-300">该募资已结束（{live.status.replace('OFFERING_STATUS_', '')}），无法认购</div>}
        {isOpen && capUnits === 0n && <div className="mt-1 text-[11px] text-bear-300">已募满，无剩余额度</div>}
        <div className="mt-2">
          <SubmitButton tx={tx} label="认购" onClick={sub} disabled={!isOpen || !validUnits || overCap || overBal} variant="bull" />
        </div>
      </div>

      <div className="divider" />
      <div className="space-y-2">
        <div className="text-sm font-medium">投资者操作</div>
        <ActionBtn label="领取分配 (Claim allocation)" onClick={simple(MSGS.ClaimAllocation.typeUrl)} tx={tx} disabled={!address} />
        <ActionBtn label="领取收益 (Claim returns)" onClick={simple(MSGS.ClaimReturns.typeUrl)} tx={tx} disabled={!address} />
        <ActionBtn label="申请退款 (Claim refund)" onClick={simple(MSGS.ClaimRefund.typeUrl)} tx={tx} disabled={!address} />
      </div>

      {isIssuer && (
        <>
          <div className="divider" />
          <div className="space-y-2">
            <div className="text-sm font-medium text-energy-400">发行方操作</div>
            <ActionBtn label="释放期款 (Release tranche)" onClick={simple(MSGS.ReleaseTranche.typeUrl, 'issuer')} tx={tx} disabled={!address} />
            <IssuerInject offering={offering} tx={tx} address={address!} sdec={sdec} bal={bal} />
          </div>
        </>
      )}

      <TxResult tx={tx} />
    </div>
  );
}

function ActionBtn({ label, onClick, tx, disabled }: { label: string; onClick: () => void; tx: ReturnType<typeof useNativeTx>; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={tx.pending || disabled}
      className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50">
      {label}
    </button>
  );
}

function IssuerInject({ offering, tx, address, sdec, bal }: { offering: Offering; tx: ReturnType<typeof useNativeTx>; address: string; sdec: number; bal: string }) {
  const [v, setV] = useState('');
  return (
    <div className="space-y-2 pt-1">
      <Field label={`注资金额 (${offering.denom})`} value={v} onChange={setV} type="number" placeholder="0.0"
        hint={`可用 ${amt(bal, sdec)} ${offering.denom}`}
        right={bal && bal !== '0' ? (
          <button type="button" onClick={() => setV(fromBaseUnits(bal, sdec))}
            className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
        ) : undefined} />
      <button onClick={async () => { if (await tx.run([msg(MSGS.InjectReturn.typeUrl, { issuer: address, offeringId: offering.id, amount: toBaseUnits(v, sdec).toString() })])) setV(''); }}
        disabled={tx.pending || !v}
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50">
        注入收益 (Inject return)
      </button>
    </div>
  );
}
