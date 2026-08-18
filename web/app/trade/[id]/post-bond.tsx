'use client';

// PostBondPanel: shown on a PENDING_BOND market. The designated operator
// escrows params.listing_bond (MsgPostBond) to open trading; everyone else
// sees an explanatory notice. The bond is refunded in full when governance
// delists the market.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { useCosmos } from '@/lib/cosmos-wallet';
import type { Market } from '@/lib/native-api';
import { SubmitButton, TxResult } from '@/components/native/ui';

export function PostBondPanel({ market }: { market: Market }) {
  const { address, connect, sign } = useCosmos();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txhash, setTxhash] = useState<string | null>(null);

  const isOperator = !!address && address === market.operator;

  const submit = async () => {
    setPending(true);
    setError(null);
    setTxhash(null);
    try {
      if (!address) await connect();
      const res = await sign([
        msg(MSGS.PostBond.typeUrl, { operator: market.operator, marketId: market.id }),
      ]);
      setTxhash(res.transactionHash);
      // Indexer picks the ACTIVE status up on its next snapshot.
      setTimeout(() => router.refresh(), 2500);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const tx = { pending, error, txhash, reset: () => { setError(null); setTxhash(null); } };

  return (
    <div className="card space-y-3 border-amber-400/20 bg-amber-400/5 p-5">
      <div className="text-sm font-medium text-amber-200">市场待缴上市押金</div>
      <p className="text-xs leading-relaxed text-ink-400">
        该市场已由治理创建，但尚未开启交易：需由运营方
        <span className="mono text-ink-200"> {market.operator || '—'} </span>
        缴纳上市押金（链上参数 <span className="mono">listing_bond</span>，默认 10,000 ECY）后进入交易状态。
        押金在治理批准退市时全额退还。
      </p>
      {isOperator ? (
        <>
          <SubmitButton tx={tx} label="缴纳上市押金 · 开启交易" onClick={submit} />
          <TxResult tx={tx} />
        </>
      ) : (
        <div className="text-xs text-ink-500">
          {address ? '当前钱包不是该市场的运营方，无法缴纳押金。' : '连接运营方钱包后可在此缴纳押金。'}
        </div>
      )}
    </div>
  );
}
