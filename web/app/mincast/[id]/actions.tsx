'use client';

import { useEffect, useState } from 'react';
import type { MincastMarket, MincastQuote } from '@/lib/native-api';
import { nativeApi } from '@/lib/native-api';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { amt, price } from '@/lib/native-format';
import { fromBaseUnits, toBaseUnits } from '@/lib/format';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';

type Tab = 'mint' | 'melt' | 'invest';

// Mincast units are whole units (0 decimals); the settlement leg uses the
// stablecoin's decimals (sdec). All inputs below are HUMAN units — e.g. type
// "1" for 1 usdc — and are scaled to chain minimal units only on submit.
const UNIT_DEC = 0;

export function MincastActions({ market, sdec = 6 }: { market: MincastMarket; sdec?: number }) {
  const [tab, setTab] = useState<Tab>('mint');
  const tx = useNativeTx();
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('2592000'); // 30d
  const [apy, setApy] = useState('500'); // 5%
  const [quote, setQuote] = useState<MincastQuote | null>(null);

  // Connected wallet's available balances (raw minimal units): settlement (paid
  // when minting) and mincast units (burned when melting / locked when
  // investing). Refreshed on connect and after each tx.
  const [bal, setBal] = useState<{ settle: string; units: string } | null>(null);
  useEffect(() => {
    if (!tx.address) { setBal(null); return; }
    let active = true;
    nativeApi.portfolio(tx.address).then((p) => {
      if (!active) return;
      const s = p.stable_balances?.find((b) => String(b.denom_id) === String(market.settlement_denom));
      const u = p.mincast_balances?.find((b) => String(b.market_id) === String(market.id));
      setBal({ settle: s?.amount ?? '0', units: u?.amount ?? '0' });
    }).catch(() => { /* keep previous */ });
    return () => { active = false; };
  }, [tx.address, tx.txhash, market.id, market.settlement_denom]);

  // Max prefills the field with the human-unit balance for the active leg.
  const maxBtn = (raw: string, dec: number) =>
    raw && raw !== '0' ? (
      <button type="button" onClick={() => setAmount(fromBaseUnits(raw, dec))}
        className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
    ) : undefined;
  const settleHint = bal ? `可用 ${amt(bal.settle, sdec)} ${market.settlement_denom}` : undefined;
  const unitsHint = bal ? `可用 ${amt(bal.units, UNIT_DEC)} ${market.denom}` : undefined;

  // Convert the human input to chain minimal units for the active leg: mint pays
  // settlement (sdec), melt/invest move units (UNIT_DEC).
  const rawAmount = () => (tab === 'mint' ? toBaseUnits(amount, sdec) : toBaseUnits(amount, UNIT_DEC)).toString();

  // Live quote preview for mint/melt (debounced). The quote API takes raw units.
  useEffect(() => {
    if (tab === 'invest' || !amount || Number(amount) <= 0) { setQuote(null); return; }
    const raw = (tab === 'mint' ? toBaseUnits(amount, sdec) : toBaseUnits(amount, UNIT_DEC)).toString();
    const h = setTimeout(() => {
      nativeApi.mincastQuote(market.id, tab === 'mint', raw).then(setQuote).catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(h);
  }, [tab, amount, market.id, sdec]);

  const submit = async () => {
    if (!tx.address) return;
    const v = rawAmount();
    let m;
    if (tab === 'mint') m = msg(MSGS.MincastMint.typeUrl, { buyer: tx.address, marketId: market.id, payAmount: v, minUnitsOut: '0' });
    else if (tab === 'melt') m = msg(MSGS.MincastMelt.typeUrl, { seller: tx.address, marketId: market.id, units: v, minSettlementOut: '0' });
    else m = msg(MSGS.MincastOpenInvest.typeUrl, { investor: tx.address, marketId: market.id, units: v, termSeconds: term, apyBps: apy });
    const ok = await tx.run([m]);
    if (ok) { setAmount(''); setQuote(null); }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'mint', label: '铸造 Mint' },
    { id: 'melt', label: '熔毁 Melt' },
    { id: 'invest', label: '投资 Invest' },
  ];

  return (
    <div className="card p-4 space-y-4 h-fit lg:sticky lg:top-20">
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-xs">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setAmount(''); setQuote(null); tx.reset(); }}
            className={`flex-1 rounded-md px-2 py-1.5 ${tab === t.id ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'mint' && <Field label={`支付 (${market.settlement_denom})`} value={amount} onChange={setAmount} type="number" placeholder="0.0"
        hint={settleHint} right={maxBtn(bal?.settle ?? '', sdec)} />}
      {tab === 'melt' && <Field label={`熔毁数量 (${market.denom})`} value={amount} onChange={setAmount} type="number" placeholder="0"
        hint={unitsHint} right={maxBtn(bal?.units ?? '', UNIT_DEC)} />}
      {tab === 'invest' && (
        <>
          <Field label={`投资数量 (${market.denom})`} value={amount} onChange={setAmount} type="number" placeholder="0"
            hint={unitsHint} right={maxBtn(bal?.units ?? '', UNIT_DEC)} />
          <Field label="锁定期 (秒)" value={term} onChange={setTerm} type="number" />
          <Field label="年化收益 APY (bps)" value={apy} onChange={setApy} type="number" hint="500 = 5%" />
        </>
      )}

      {quote && (tab !== 'invest') && (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs space-y-1">
          {quote.units !== undefined && <Row k={tab === 'mint' ? '预计获得' : '熔毁数量'} v={amt(quote.units, 0)} />}
          {quote.settlement !== undefined && <Row k={tab === 'mint' ? '支付' : '预计结算'} v={amt(quote.settlement, sdec)} />}
          {quote.fee !== undefined && <Row k="手续费" v={amt(quote.fee, sdec)} />}
          {quote.floor_price !== undefined && <Row k="保底价" v={price(quote.floor_price, sdec)} />}
        </div>
      )}

      <SubmitButton
        tx={tx}
        label={{ mint: '铸造', melt: '熔毁', invest: '开启投资' }[tab]}
        onClick={submit}
        disabled={!amount}
        variant={tab === 'melt' ? 'bear' : tab === 'mint' ? 'bull' : 'primary'}
      />
      <TxResult tx={tx} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink-400">{k}</span><span className="mono text-ink-100">{v}</span></div>;
}
