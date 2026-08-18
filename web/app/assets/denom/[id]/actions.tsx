'use client';

import { useEffect, useState } from 'react';
import type { Denom } from '@/lib/native-api';
import { nativeApi } from '@/lib/native-api';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { toBaseUnits, fromBaseUnits } from '@/lib/format';
import { amt } from '@/lib/native-format';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';

type Tab = 'transfer' | 'mint' | 'burn' | 'redeem';

export function DenomActions({ denom }: { denom: Denom }) {
  const [tab, setTab] = useState<Tab>('transfer');
  const tx = useNativeTx();
  const dec = denom.decimals;
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!tx.address) { setBalance(null); return; }
    nativeApi.denomBalance(denom.id, tx.address).then((r) => setBalance(r.amount)).catch(() => setBalance(null));
  }, [tx.address, denom.id, tx.txhash]);

  const submit = async () => {
    if (!tx.address) return;
    const v = amount ? toBaseUnits(amount, dec).toString() : '0';
    let m;
    if (tab === 'transfer') m = msg(MSGS.StableTransfer.typeUrl, { from: tx.address, denomId: denom.id, to, amount: v });
    else if (tab === 'mint') m = msg(MSGS.StableMint.typeUrl, { minter: tx.address, denomId: denom.id, recipient: to || tx.address, amount: v });
    else if (tab === 'burn') m = msg(MSGS.StableBurn.typeUrl, { holder: tx.address, denomId: denom.id, amount: v });
    else m = msg(MSGS.StableRequestRedemption.typeUrl, { holder: tx.address, denomId: denom.id, amount: v, memo });
    const ok = await tx.run([m]);
    if (ok) setAmount('');
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transfer', label: '转账' },
    { id: 'mint', label: '铸造' },
    { id: 'burn', label: '销毁' },
    { id: 'redeem', label: '赎回' },
  ];

  return (
    <div className="card p-4 space-y-4 h-fit lg:sticky lg:top-20">
      {balance !== null && (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-ink-300">
          可用余额 <span className="mono float-right text-ink-100">{amt(balance, dec)} {denom.symbol}</span>
        </div>
      )}
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-xs">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); tx.reset(); }}
            className={`flex-1 rounded-md px-2 py-1.5 ${tab === t.id ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>{t.label}</button>
        ))}
      </div>

      {(tab === 'transfer' || tab === 'mint') && (
        <Field label={tab === 'mint' ? '接收地址 (默认自己)' : '接收地址'} value={to} onChange={setTo} placeholder="energy1…" />
      )}
      <Field label={`数量 (${denom.symbol || denom.id})`} value={amount} onChange={setAmount} type="number" placeholder="0.0"
        hint={balance !== null ? `可用 ${amt(balance, dec)} ${denom.symbol || denom.id}` : undefined}
        right={tab !== 'mint' && balance && balance !== '0' ? (
          <button type="button" onClick={() => setAmount(fromBaseUnits(balance, dec))}
            className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
        ) : undefined} />
      {tab === 'redeem' && <Field label="备注 (可选)" value={memo} onChange={setMemo} placeholder="赎回到银行账户…" />}

      <SubmitButton
        tx={tx}
        label={{ transfer: '发送', mint: '铸造', burn: '销毁', redeem: '申请赎回' }[tab]}
        onClick={submit}
        disabled={!amount || ((tab === 'transfer') && !to)}
        variant={tab === 'burn' || tab === 'redeem' ? 'bear' : 'primary'}
      />
      <TxResult tx={tx} />
    </div>
  );
}
