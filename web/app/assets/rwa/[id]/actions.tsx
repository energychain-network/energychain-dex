'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { RwaToken, ClaimableDistribution } from '@/lib/native-api';
import { nativeApi } from '@/lib/native-api';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { toBaseUnits, fromBaseUnits } from '@/lib/format';
import { amt } from '@/lib/native-format';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';

type Tab = 'transfer' | 'mint' | 'redeem' | 'claim';

export function RwaActions({ token }: { token: RwaToken }) {
  const [tab, setTab] = useState<Tab>('transfer');
  const tx = useNativeTx();
  const dec = token.decimals;
  const isAdmin = !!tx.address && tx.address === token.admin;

  // Show the connected wallet's own balance so claimed allocations / received
  // transfers / secondary-market buys are visible right here.
  const [myUnits, setMyUnits] = useState<string | null>(null);
  // Claimable dividends — these follow the token: whoever holds at snapshot
  // time (incl. a secondary-market buyer) can claim the pro-rata payout.
  const [claimable, setClaimable] = useState<ClaimableDistribution[]>([]);
  const [totalClaimable, setTotalClaimable] = useState('0');
  // Secondary order-book market for this token (if an authority created one).
  const [marketId, setMarketId] = useState<string | null>(null);
  // Settlement denom decimals (dividends/fund amounts are in this denom).
  const [settleDec, setSettleDec] = useState(6);

  const refresh = useCallback(async () => {
    if (!tx.address) { setMyUnits(null); setClaimable([]); setTotalClaimable('0'); return; }
    try {
      const p = await nativeApi.portfolio(tx.address);
      const row = p.rwa_balances?.find((b) => String(b.token_id) === String(token.id));
      setMyUnits(row?.amount ?? '0');
    } catch { /* keep */ }
    try {
      const c = await nativeApi.rwaClaimable(token.id, tx.address);
      setClaimable((c.items || []).filter((d) => !d.claimed && d.amount !== '0'));
      setTotalClaimable(c.total_claimable || '0');
    } catch { /* keep */ }
  }, [tx.address, token.id]);
  useEffect(() => { refresh(); }, [refresh, tx.txhash]);

  // Resolve the token's secondary market + settlement decimals once.
  useEffect(() => {
    nativeApi.markets().then((r) => {
      const m = r.items.find((x) => x.base_kind === 'rwa' && String(x.base_token_id) === String(token.id));
      setMarketId(m ? m.id : null);
    }).catch(() => {});
    if (token.settlement_denom) {
      nativeApi.denom(token.settlement_denom).then((d) => setSettleDec(d.decimals ?? 6)).catch(() => {});
    }
  }, [token.id, token.settlement_denom]);

  // shared inputs
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [warn, setWarn] = useState<string | null>(null);

  const reset = () => { setTo(''); setAmount(''); setWarn(null); tx.reset(); };

  // Available-share hint + max for transfer/redeem (you can only move what you hold).
  const holdHint = tx.address ? `可用 ${amt(myUnits ?? '0', dec)} ${token.symbol}` : undefined;
  const holdMax = myUnits && myUnits !== '0' ? (
    <button type="button" onClick={() => setAmount(fromBaseUnits(myUnits, dec))}
      className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
  ) : undefined;

  const submit = async () => {
    if (!tx.address) return;
    const units = amount ? toBaseUnits(amount, dec).toString() : '0';
    let m;
    if (tab === 'transfer') {
      setWarn(null);
      if (token.policy_id) {
        try {
          const res = await nativeApi.evaluate({ policy_id: token.policy_id, from: tx.address, to, amount: units });
          if (!res.allowed) { setWarn(`合规校验未通过：${res.reason || '该转账被策略拒绝'}`); return; }
        } catch { /* fall through; chain will enforce */ }
      }
      m = msg(MSGS.RwaTransfer.typeUrl, { from: tx.address, tokenId: token.id, to, amount: units });
    } else if (tab === 'mint') {
      m = msg(MSGS.RwaMint.typeUrl, { admin: tx.address, tokenId: token.id, recipient: to || tx.address, amount: units });
    } else {
      m = msg(MSGS.RwaRequestRedemption.typeUrl, { holder: tx.address, tokenId: token.id, units });
    }
    const ok = await tx.run([m]);
    if (ok && tab !== 'redeem') setAmount('');
  };

  const claimOne = async (distId: string) => {
    if (!tx.address) return;
    await tx.run([msg(MSGS.ClaimDistribution.typeUrl, { holder: tx.address, distributionId: distId })]);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transfer', label: '转账' },
    { id: 'mint', label: '增发' },
    { id: 'redeem', label: '赎回' },
    { id: 'claim', label: '领分红' },
  ];

  return (
    <div className="card p-4 space-y-4 h-fit lg:sticky lg:top-20">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="text-xs text-ink-400">我的持仓 My holdings</div>
        <div className="mt-0.5 text-lg font-semibold mono">
          {tx.address ? `${amt(myUnits ?? '0', dec)} ${token.symbol}` : '连接钱包后显示'}
        </div>
        {marketId && (
          <Link href={`/trade/${marketId}`} className="mt-1 inline-block text-xs text-energy-400 hover:underline">
            二级市场买卖 / 价格曲线 →
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); reset(); }}
            className={`flex-1 rounded-md px-2 py-1.5 ${tab === t.id ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'transfer' && (
        <>
          <Field label="接收地址" value={to} onChange={setTo} placeholder="energy1…" />
          <Field label={`数量 (${token.symbol})`} value={amount} onChange={setAmount} type="number" placeholder="0.0" hint={holdHint} right={holdMax} />
          {warn && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">{warn}</div>}
          <SubmitButton tx={tx} label="发送" onClick={submit} disabled={!to || !amount} />
        </>
      )}
      {tab === 'mint' && (
        <>
          <p className="text-xs text-ink-500">仅代币管理员可增发。</p>
          <Field label="接收地址 (默认自己)" value={to} onChange={setTo} placeholder="energy1…" />
          <Field label={`增发数量 (${token.symbol})`} value={amount} onChange={setAmount} type="number" placeholder="0.0" />
          <SubmitButton tx={tx} label="增发" onClick={submit} disabled={!amount} />
        </>
      )}
      {tab === 'redeem' && (
        <>
          <p className="text-xs text-ink-500">按赎回价向资金池申请赎回，可能存在延迟期。</p>
          <Field label={`赎回数量 (${token.symbol})`} value={amount} onChange={setAmount} type="number" placeholder="0.0" hint={holdHint} right={holdMax} />
          <SubmitButton tx={tx} label="申请赎回" onClick={submit} disabled={!amount} variant="bear" />
        </>
      )}
      {tab === 'claim' && (
        <div className="space-y-2">
          <p className="text-xs text-ink-500">
            分红按持仓快照分配,收益随 token 转移——你在快照时持有即可领取。
          </p>
          {!tx.address && <p className="text-xs text-ink-400">连接钱包后显示可领分红。</p>}
          {tx.address && claimable.length === 0 && (
            <p className="text-xs text-ink-400">暂无可领分红。</p>
          )}
          {claimable.map((d) => (
            <div key={d.distribution_id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-xs">
                <div className="text-ink-200 mono">#{d.distribution_id} · {amt(d.amount, settleDec)} {token.settlement_denom}</div>
                <div className="text-ink-500">快照 #{d.snapshot_id}</div>
              </div>
              <button
                onClick={() => claimOne(d.distribution_id)}
                disabled={tx.pending}
                className="rounded-md bg-bull/20 px-2.5 py-1 text-xs text-bull-300 hover:bg-bull/30 disabled:opacity-50"
              >领取</button>
            </div>
          ))}
          {tx.address && (
            <div className="pt-1 text-[11px] text-ink-500">合计可领 {amt(totalClaimable, settleDec)} {token.settlement_denom}</div>
          )}
        </div>
      )}

      <TxResult tx={tx} />

      {isAdmin && <IssuerPanel token={token} settleDec={settleDec} onDone={refresh} />}
    </div>
  );
}

// IssuerPanel exposes the snapshot-dividend lifecycle to the token admin: fund
// the dividend pool, take a holder snapshot, then create a distribution against
// that snapshot. Holders (including secondary-market buyers) then claim above.
function IssuerPanel({ token, settleDec, onDone }: { token: RwaToken; settleDec: number; onDone: () => void }) {
  const tx = useNativeTx();
  const [fund, setFund] = useState('');
  const [snapId, setSnapId] = useState('');
  const [distAmt, setDistAmt] = useState('');
  const [bal, setBal] = useState('0');

  useEffect(() => {
    if (!tx.address || !token.settlement_denom) { setBal('0'); return; }
    nativeApi.denomBalance(token.settlement_denom, tx.address).then((r) => setBal(r.amount || '0')).catch(() => setBal('0'));
  }, [tx.address, token.settlement_denom, tx.txhash]);

  const run = async (m: any, clear?: () => void) => {
    const ok = await tx.run([m]);
    if (ok) { clear?.(); onDone(); }
  };

  return (
    <div className="rounded-lg border border-energy-400/20 bg-energy-400/[0.03] p-3 space-y-3">
      <div className="text-xs font-medium text-energy-300">发行方 Issuer · 分红管理</div>

      <div className="space-y-1.5">
        <Field label={`注资分红/赎回池 (${token.settlement_denom})`} value={fund} onChange={setFund} type="number" placeholder="0.0"
          hint={`可用 ${amt(bal, settleDec)} ${token.settlement_denom}`}
          right={bal && bal !== '0' ? (
            <button type="button" onClick={() => setFund(fromBaseUnits(bal, settleDec))}
              className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
          ) : undefined} />
        <SubmitButton tx={tx} label="注资 Fund pool" disabled={!fund}
          onClick={() => run(msg(MSGS.FundPool.typeUrl, { admin: tx.address, tokenId: token.id, amount: toBaseUnits(fund || '0', settleDec).toString() }), () => setFund(''))} />
      </div>

      <div className="space-y-1.5">
        <SubmitButton tx={tx} label="打持仓快照 Take snapshot"
          onClick={() => run(msg(MSGS.TakeSnapshot.typeUrl, { admin: tx.address, tokenId: token.id }))} />
        <p className="text-[11px] text-ink-500">快照编号自增;创建分红时填入对应快照编号。</p>
      </div>

      <div className="space-y-1.5">
        <Field label="快照编号 Snapshot ID" value={snapId} onChange={setSnapId} type="number" placeholder="1" />
        <Field label={`分红总额 (${token.settlement_denom})`} value={distAmt} onChange={setDistAmt} type="number" placeholder="0.0" />
        <SubmitButton tx={tx} label="创建分红 Create distribution" variant="bull" disabled={!snapId || !distAmt}
          onClick={() => run(msg(MSGS.CreateDistribution.typeUrl, { admin: tx.address, tokenId: token.id, snapshotId: snapId, totalAmount: toBaseUnits(distAmt || '0', settleDec).toString() }), () => { setSnapId(''); setDistAmt(''); })} />
      </div>

      <TxResult tx={tx} />
    </div>
  );
}
