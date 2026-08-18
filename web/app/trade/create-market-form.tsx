'use client';

import { useEffect, useState } from 'react';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg, fetchGovModuleAddress } from '@/lib/cosmos';
import { useCosmos } from '@/lib/cosmos-wallet';
import { nativeApi } from '@/lib/native-api';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';

type Kind = 'rwa' | 'stable';

export function CreateMarketForm() {
  const { address, connect, submitGov } = useCosmos();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txhash, setTxhash] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('rwa');
  const [tokenId, setTokenId] = useState('');
  const [baseDenom, setBaseDenom] = useState('');
  const [quoteDenom, setQuoteDenom] = useState('');
  const [feeBps, setFeeBps] = useState('10');
  const [minBaseQty, setMinBaseQty] = useState('1');
  const [batchInterval, setBatchInterval] = useState('1');
  const [operator, setOperator] = useState('');

  // Default the operator to the connected wallet (it posts the listing bond).
  useEffect(() => {
    if (address && !operator) setOperator(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const [tokenLabel, setTokenLabel] = useState<string | null>(null);
  const [existingMarket, setExistingMarket] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'rwa' || !/^\d+$/.test(tokenId)) {
      setTokenLabel(null);
      setQuoteDenom('');
      setExistingMarket(null);
      return;
    }
    let active = true;
    nativeApi.rwaToken(tokenId).then(async (t) => {
      if (!active) return;
      setTokenLabel(`${t.symbol} (#${t.id})`);
      setQuoteDenom(t.settlement_denom || '');
      const base = `rwa/${t.id}`;
      const mkts = await nativeApi.markets().catch(() => ({ items: [] }));
      const hit = mkts.items.find((m) => m.base_denom === base);
      setExistingMarket(hit ? String(hit.id) : null);
    }).catch(() => {
      if (active) { setTokenLabel(null); setExistingMarket(null); }
    });
    return () => { active = false; };
  }, [kind, tokenId]);

  const resolvedBase = kind === 'rwa' ? (tokenId ? `rwa/${tokenId}` : '') : baseDenom.trim();
  const resolvedQuote = quoteDenom.trim();

  const submit = async () => {
    setPending(true);
    setError(null);
    setTxhash(null);
    try {
      if (!address) await connect();
      const gov = await fetchGovModuleAddress();
      if (!gov) throw new Error('gov 模块地址为空');
      const title = `Create market ${resolvedBase}/${resolvedQuote}`;
      const inner = msg(MSGS.CreateMarket.typeUrl, {
        authority: gov,
        baseDenom: resolvedBase,
        quoteDenom: resolvedQuote,
        feeBps,
        minBaseQty,
        batchInterval,
        requireKyc: false,
        policyId: '',
        operator: operator.trim(),
      });
      const res = await submitGov(title, title, [inner]);
      setTxhash(res.transactionHash);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const tx = { pending, error, txhash, reset: () => { setError(null); setTxhash(null); } };

  return (
    <div className="card p-5 space-y-3">
      <p className="text-xs leading-relaxed text-ink-400">
        订单簿市场由链上 <span className="mono">x/market</span> 模块创建，需通过<strong className="text-ink-300">治理提案</strong>提交。
        任意地址可发起提案；验证者投票通过后市场进入<strong className="text-ink-300">待缴押金</strong>状态，
        需由运营方（operator）缴纳上市押金（默认 10,000 ECY，治理可调）后方可开启交易；退市时押金全额退还。
        RWA 交易对的报价币必须为该代币的结算稳定币，且 operator 必须是该代币的发行人（admin）。
      </p>

      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => setKind('rwa')} className={`rounded-full px-3 py-1.5 ${kind === 'rwa' ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>RWA 代币</button>
        <button type="button" onClick={() => setKind('stable')} className={`rounded-full px-3 py-1.5 ${kind === 'stable' ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>稳定币对</button>
      </div>

      {kind === 'rwa' ? (
        <>
          <Field label="RWA 代币 ID" value={tokenId} onChange={setTokenId} type="number" placeholder="4"
            hint={tokenLabel ? `${tokenLabel} · 结算币 ${quoteDenom || '—'}` : undefined} />
          {existingMarket && (
            <div className="text-xs text-amber-300">该代币已有市场 #{existingMarket}，无需重复创建。</div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base denom" value={baseDenom} onChange={setBaseDenom} placeholder="usd" />
          <Field label="Quote denom" value={quoteDenom} onChange={setQuoteDenom} placeholder="eur" />
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="手续费 (bps)" value={feeBps} onChange={setFeeBps} type="number" />
        <Field label="最小数量" value={minBaseQty} onChange={setMinBaseQty} type="number" />
        <Field label="批次间隔 (s)" value={batchInterval} onChange={setBatchInterval} type="number" />
      </div>

      <Field label="运营方 Operator（缴纳上市押金的地址）" value={operator} onChange={setOperator}
        placeholder="energy1…" hint="提案通过后需由该地址缴纳上市押金开启交易；RWA 市场必须填代币发行人地址" />

      {resolvedBase && resolvedQuote && (
        <div className="text-xs text-ink-400">
          将创建：<span className="mono text-ink-200">{resolvedBase} / {resolvedQuote}</span>
        </div>
      )}

      <SubmitButton tx={tx} label="提交治理提案 · 创建市场" onClick={submit} disabled={!resolvedBase || !resolvedQuote || !!existingMarket} />
      <TxResult tx={tx} />
    </div>
  );
}
