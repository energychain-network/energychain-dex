'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useChannelStream } from '@/lib/ws';
import { api } from '@/lib/api';
import { txURL } from '@/lib/chain';
import { displayPair, fmtUSD, shortAddr, timeAgo } from '@/lib/format';

type SwapEvent = {
  pair: string;
  tx: string;
  block_time: number;
  height: number;
  sender: string;
  recipient: string;
  amount0_in: string;
  amount1_in: string;
  amount0_out: string;
  amount1_out: string;
  price: string;
  side: number;
  amount_usd: string;
};

// Pair payloads on the swap firehose are address-only (the indexer doesn't
// embed symbols on every event). We pull the pair list once on mount so that
// the Pair column can show the human label "ECY/USDT" instead of a raw 0x…
// hash. Fetched via the public REST endpoint so it shares the API cache.
function usePairLookup() {
  const [map, setMap] = useState<Record<string, { sym0: string; sym1: string }>>({});
  useEffect(() => {
    let alive = true;
    api.listPairs('tvl', 200)
      .then((r) => {
        if (!alive) return;
        const m: Record<string, { sym0: string; sym1: string }> = {};
        for (const p of r.items as any[]) m[p.address.toLowerCase()] = { sym0: p.symbol0 || '', sym1: p.symbol1 || '' };
        setMap(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return map;
}

export function LiveTrades({ initial = [] as any[], max = 30 }: { initial?: any[]; max?: number }) {
  const stream = useChannelStream<SwapEvent>('dex:swaps', max);
  const items = stream.length > 0 ? stream : (initial as SwapEvent[]);
  const pairs = usePairLookup();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulseDot" />
          <h3 className="text-sm font-medium">Live trades</h3>
        </div>
        <span className="text-xs text-ink-400">streaming via WebSocket</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400">
            <tr className="bg-white/[0.02]">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Pair</th>
              <th className="px-4 py-2 font-medium">Side</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Trader</th>
              <th className="px-4 py-2 font-medium text-right">Tx</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((s, i) => (
              <tr key={`${s.tx}-${i}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-ink-300">{timeAgo(Number(s.block_time))}</td>
                <td className="px-4 py-2">
                  <Link href={`/charts/${s.pair}`} className="text-ink-100 hover:text-energy-400">
                    {(() => {
                      const p = pairs[(s.pair || '').toLowerCase()];
                      return p && (p.sym0 || p.sym1)
                        ? <span className="font-medium">{displayPair(p.sym0, p.sym1)}</span>
                        : <span className="mono text-xs">{shortAddr(s.pair, 4)}</span>;
                    })()}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span className={s.side === 0 ? 'text-bull' : 'text-bear'}>
                    {s.side === 0 ? 'Buy' : 'Sell'}
                  </span>
                </td>
                <td className="px-4 py-2 text-ink-100">{fmtUSD(s.amount_usd)}</td>
                <td className="px-4 py-2 mono text-xs text-ink-300">{shortAddr(s.sender, 4)}</td>
                <td className="px-4 py-2 text-right">
                  <a className="mono text-xs text-ink-400 hover:text-ink-200" href={txURL(s.tx)} target="_blank" rel="noreferrer">
                    {shortAddr(s.tx, 4)}
                  </a>
                </td>
              </tr>
            ))}
            {(items || []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-400 text-sm">No trades yet — make one to see it here in real time.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
