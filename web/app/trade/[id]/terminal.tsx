'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { nativeApi, type Market, type OrderBook, type MarketTrade, type Order } from '@/lib/native-api';
import { MSGS, OrderSide } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { amt, price as fmtPriceDec, scaleUp, scaleDownPlain } from '@/lib/native-format';
import { timeAgo } from '@/lib/format';
import { useChannel } from '@/lib/ws';
import { useCosmos } from '@/lib/cosmos-wallet';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, SubmitButton, TxResult } from '@/components/native/ui';

// PriceScale (1e6) is the chain's fixed price scaling: a market price is quote
// micro-units per 1 base unit, scaled by PriceScale.
const PRICE_SCALE_EXP = 6;

// MarketDecimals derives the human<->raw scaling for a market's legs:
//   raw quantity = human quantity * 10^qtyExp        (qtyExp = base decimals)
//   raw price    = human price    * 10^priceExp      (priceExp = 6 + quoteDec - baseDec)
// Falling back to 6/6 reproduces the legacy stable/stable behaviour exactly.
type MarketDecimals = {
  baseDec: number; quoteDec: number; priceExp: number; qtyExp: number;
  baseSym: string; quoteSym: string; isRWA: boolean;
};
function marketDecimals(m: Market): MarketDecimals {
  const baseDec = m.base_decimals ?? 6;
  const quoteDec = m.quote_decimals ?? 6;
  return {
    baseDec, quoteDec,
    priceExp: PRICE_SCALE_EXP + quoteDec - baseDec,
    qtyExp: baseDec,
    baseSym: m.base_symbol || m.base_denom,
    quoteSym: m.quote_symbol || m.quote_denom,
    isRWA: m.base_kind === 'rwa',
  };
}

export function MarketTerminal({
  market, initialBook, initialTrades,
}: {
  market: Market;
  initialBook: OrderBook;
  initialTrades: MarketTrade[];
}) {
  const [book, setBook] = useState<OrderBook>(initialBook);
  const [trades, setTrades] = useState<MarketTrade[]>(initialTrades);
  const d = useMemo(() => marketDecimals(market), [market]);

  // Live refresh on batch clears and order activity for this market.
  const clear = useChannel<any>('dex:clears');
  const order = useChannel<any>('dex:orders');
  useEffect(() => {
    if (clear && String(clear.market_id) === String(market.id)) {
      setTrades((t) => [{ market_id: String(market.id), height: clear.height, block_time: clear.block_time, price: String(clear.price), qty: String(clear.qty) }, ...t].slice(0, 50));
      nativeApi.orderBook(market.id).then(setBook).catch(() => {});
    }
  }, [clear, market.id]);
  useEffect(() => {
    if (order && String(order.market_id) === String(market.id)) {
      nativeApi.orderBook(market.id).then(setBook).catch(() => {});
    }
  }, [order, market.id]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1fr]">
      <Depth book={book} d={d} />
      <div className="space-y-4">
        <OrderForm market={market} d={d} />
        <OpenOrders market={market} d={d} />
      </div>
      <Trades trades={trades} d={d} />
    </div>
  );
}

function Depth({ book, d }: { book: OrderBook; d: MarketDecimals }) {
  const maxQty = useMemo(() => {
    const all = [...book.bids, ...book.asks].map((l) => Number(l.quantity));
    return Math.max(1, ...all);
  }, [book]);
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 px-4 py-2.5 text-sm font-medium">订单簿 Order book</div>
      <div className="grid grid-cols-3 px-4 py-1.5 text-[11px] text-ink-500">
        <span>价格 ({d.quoteSym})</span><span className="text-right">数量 ({d.baseSym})</span><span className="text-right">订单数</span>
      </div>
      <div className="max-h-[180px] overflow-y-auto">
        {book.asks.slice().reverse().map((l, i) => <Level key={`a${i}`} l={l} max={maxQty} d={d} sell />)}
      </div>
      <div className="border-y border-white/5 px-4 py-1.5 text-center text-xs text-ink-400">价差 Spread</div>
      <div className="max-h-[180px] overflow-y-auto">
        {book.bids.map((l, i) => <Level key={`b${i}`} l={l} max={maxQty} d={d} />)}
      </div>
      {book.bids.length === 0 && book.asks.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-ink-400">订单簿为空。</div>
      )}
    </div>
  );
}

function Level({ l, max, d, sell }: { l: { price: string; quantity: string; orders: number }; max: number; d: MarketDecimals; sell?: boolean }) {
  const pct = Math.min(100, (Number(l.quantity) / max) * 100);
  return (
    <div className="relative grid grid-cols-3 px-4 py-1 text-xs">
      <div className={`absolute inset-y-0 right-0 ${sell ? 'bg-bear/10' : 'bg-bull/10'}`} style={{ width: `${pct}%` }} />
      <span className={`relative mono ${sell ? 'text-bear-400' : 'text-bull-400'}`}>{fmtPriceDec(l.price, d.priceExp)}</span>
      <span className="relative text-right mono">{amt(l.quantity, d.baseDec)}</span>
      <span className="relative text-right text-ink-400">{l.orders}</span>
    </div>
  );
}

function OrderForm({ market, d }: { market: Market; d: MarketDecimals }) {
  const tx = useNativeTx();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  // Available balances (raw base-units) for the connected wallet.
  const [quoteBal, setQuoteBal] = useState('0'); // quote stable balance
  const [baseBal, setBaseBal] = useState('0');    // base rwa units / stable balance

  const refreshBal = useCallback(async () => {
    if (!tx.address) { setQuoteBal('0'); setBaseBal('0'); return; }
    try {
      const p = await nativeApi.portfolio(tx.address);
      const q = p.stable_balances?.find((b) => b.denom_id === market.quote_denom);
      setQuoteBal(q?.amount ?? '0');
      if (d.isRWA) {
        const rb = p.rwa_balances?.find((b) => String(b.token_id) === String(market.base_token_id));
        setBaseBal(rb?.amount ?? '0');
      } else {
        const sb = p.stable_balances?.find((b) => b.denom_id === market.base_denom);
        setBaseBal(sb?.amount ?? '0');
      }
    } catch { /* keep previous */ }
  }, [tx.address, market.quote_denom, market.base_denom, market.base_token_id, d.isRWA]);
  useEffect(() => { refreshBal(); }, [refreshBal, tx.txhash]);

  const submit = async () => {
    if (!tx.address) return;
    const rawPrice = scaleUp(price, d.priceExp);
    const rawQty = scaleUp(qty, d.qtyExp);
    if (rawPrice === '0' || rawQty === '0') return;
    const m = msg(MSGS.PlaceOrder.typeUrl, {
      owner: tx.address,
      marketId: market.id,
      side: side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
      price: rawPrice,
      quantity: rawQty,
    });
    const ok = await tx.run([m]);
    if (ok) setQty('');
  };

  // Max: SELL fills the whole base balance; BUY needs a price to size against
  // the quote balance: qty = floor(quoteBal * PriceScale / rawPrice).
  const setMax = () => {
    if (side === 'sell') {
      setQty(scaleDownPlain(baseBal, d.qtyExp));
      return;
    }
    const rawPrice = scaleUp(price, d.priceExp);
    if (rawPrice === '0') return;
    try {
      const maxQtyRaw = (BigInt(quoteBal || '0') * (10n ** BigInt(PRICE_SCALE_EXP))) / BigInt(rawPrice);
      setQty(scaleDownPlain(maxQtyRaw.toString(), d.qtyExp));
    } catch { /* ignore */ }
  };

  const availLabel = side === 'buy'
    ? `可用 ${scaleDownPlain(quoteBal, d.quoteDec)} ${d.quoteSym}`
    : `可用 ${scaleDownPlain(baseBal, d.baseDec)} ${d.baseSym}`;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-xs">
        <button onClick={() => setSide('buy')} className={`flex-1 rounded-md px-2 py-1.5 ${side === 'buy' ? 'bg-bull/20 text-bull-300' : 'text-ink-400'}`}>买入 Buy</button>
        <button onClick={() => setSide('sell')} className={`flex-1 rounded-md px-2 py-1.5 ${side === 'sell' ? 'bg-bear/20 text-bear-300' : 'text-ink-400'}`}>卖出 Sell</button>
      </div>
      <Field label={`限价 Price (${d.quoteSym} / ${d.baseSym})`} value={price} onChange={setPrice} type="number" placeholder="0.0" />
      <div className="space-y-1">
        <Field label={`数量 Qty (${d.baseSym})`} value={qty} onChange={setQty} type="number" placeholder="0" />
        <div className="flex items-center justify-between text-[11px] text-ink-500">
          <span>{tx.address ? availLabel : '连接钱包后显示可用余额'}</span>
          <button type="button" onClick={setMax} className="text-energy-400 hover:underline disabled:opacity-40" disabled={!tx.address || (side === 'buy' && !price)}>最大 Max</button>
        </div>
      </div>
      <p className="text-[11px] text-ink-500">订单进入下一批次按统一清算价撮合。{d.isRWA ? '该市场以 RWA 证券代币为标的,每笔成交强制过合规闸门。' : ''}</p>
      <SubmitButton tx={tx} label={side === 'buy' ? '提交买单 Buy' : '提交卖单 Sell'} onClick={submit} disabled={!price || !qty} variant={side === 'buy' ? 'bull' : 'bear'} />
      <TxResult tx={tx} />
    </div>
  );
}

function OpenOrders({ market, d }: { market: Market; d: MarketDecimals }) {
  const { address } = useCosmos();
  const tx = useNativeTx();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!address) { setOrders([]); return; }
    nativeApi.ordersByOwner(address).then((r) => setOrders(r.items.filter((o) => String(o.market_id) === String(market.id)))).catch(() => {});
  }, [address, market.id, tx.txhash]);

  const cancel = async (id: string) => {
    if (!address) return;
    await tx.run([msg(MSGS.CancelOrder.typeUrl, { owner: address, orderId: id })]);
  };

  if (!address) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 px-4 py-2.5 text-sm font-medium">我的挂单 Open orders</div>
      <table className="w-full text-xs">
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-white/5">
              <td className={`px-3 py-2 ${o.side.includes('BUY') ? 'text-bull-400' : 'text-bear-400'}`}>{o.side.includes('BUY') ? '买' : '卖'}</td>
              <td className="px-3 py-2 text-right mono">{fmtPriceDec(o.price, d.priceExp)}</td>
              <td className="px-3 py-2 text-right mono">{amt(o.quantity, d.baseDec)}</td>
              <td className="px-3 py-2 text-right text-ink-400">{amt(o.filled, d.baseDec)} 已成</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => cancel(o.id)} disabled={tx.pending} className="text-bear-400 hover:underline disabled:opacity-50">撤单</button>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-400">暂无挂单。</td></tr>}
        </tbody>
      </table>
      <TxResult tx={tx} />
    </div>
  );
}

function Trades({ trades, d }: { trades: MarketTrade[]; d: MarketDecimals }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 px-4 py-2.5 text-sm font-medium">清算成交 Clears</div>
      <div className="grid grid-cols-3 px-4 py-1.5 text-[11px] text-ink-500">
        <span>清算价 ({d.quoteSym})</span><span className="text-right">成交量 ({d.baseSym})</span><span className="text-right">时间</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {trades.map((t, i) => (
          <div key={`${t.height}-${i}`} className="grid grid-cols-3 px-4 py-1.5 text-xs border-t border-white/5">
            <span className="mono text-energy-400">{fmtPriceDec(t.price, d.priceExp)}</span>
            <span className="text-right mono">{amt(t.qty, d.baseDec)}</span>
            <span className="text-right text-ink-400">{timeAgo(t.block_time)}</span>
          </div>
        ))}
        {trades.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-400">暂无成交。</div>}
      </div>
    </div>
  );
}
