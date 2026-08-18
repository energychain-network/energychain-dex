'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { OfferingReturnClaim, RwaToken } from '@/lib/native-api';
import { nativeApi } from '@/lib/native-api';
import { amt } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { useNativeTx } from '@/components/native/use-native-tx';

export function OfferingReturnsTable({ token, sdec }: { token: RwaToken; sdec: number }) {
  const tx = useNativeTx();
  const [rows, setRows] = useState<OfferingReturnClaim[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tx.address) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await nativeApi.rwaOfferingReturns(token.id, tx.address);
      setRows(res.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tx.address, token.id]);

  useEffect(() => {
    refresh();
  }, [refresh, tx.txhash]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 px-4 py-3 text-sm font-medium">
        募资收益领取 <span className="text-xs font-normal text-ink-400">Offering Claim returns</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-400">
          <tr className="bg-white/[0.02]">
            <th className="px-4 py-2">募资</th>
            <th className="px-4 py-2">投资者</th>
            <th className="px-4 py-2 text-right">单位</th>
            <th className="px-4 py-2 text-right">领取收益</th>
          </tr>
        </thead>
        <tbody>
          {!tx.address && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-ink-400">连接钱包后显示您的募资收益领取记录。</td>
            </tr>
          )}
          {tx.address && loading && rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-ink-400">加载中…</td>
            </tr>
          )}
          {tx.address && !loading && rows.map((r) => {
            const claimed = r.returns_claimed !== '0' && r.returns_claimed !== '';
            return (
              <tr key={r.offering_id} className="border-t border-white/5">
                <td className="px-4 py-2 mono">
                  <Link href={`/offerings/${r.offering_id}`} className="hover:text-energy-400">#{r.offering_id}</Link>
                </td>
                <td className="px-4 py-2 mono text-xs">{shortAddr(r.investor, 5)}</td>
                <td className="px-4 py-2 text-right mono">{amt(r.units, token.decimals)}</td>
                <td className="px-4 py-2 text-right mono">
                  {claimed ? (
                    <span>{amt(r.returns_claimed, sdec)} {r.denom}</span>
                  ) : r.claimable !== '0' && r.claimable !== '' ? (
                    <span className="text-amber-300">{amt(r.claimable, sdec)} {r.denom} 待领</span>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {tx.address && !loading && rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-ink-400">暂无募资收益领取记录。</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
