'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import { nativeApi, type MarketCandle } from '@/lib/native-api';
import { useChannel } from '@/lib/ws';

const GRANS = [
  { id: '1m', label: '1m' }, { id: '5m', label: '5m' }, { id: '15m', label: '15m' },
  { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '1d', label: '1D' },
];

export function MarketChart({ marketId, initialCandles, priceExp = 6, qtyExp = 0 }: { marketId: string; initialCandles: MarketCandle[]; priceExp?: number; qtyExp?: number }) {
  // Clearing prices/volumes are stored raw (chain minimal units). Scale them
  // into human units so the axis matches the order book / terminal:
  //   human price  = raw / 10^priceExp (priceExp = 6 + quoteDec - baseDec)
  //   human volume = raw / 10^qtyExp   (qtyExp = base decimals)
  const sp = (v: number) => v / 10 ** priceExp;
  const sv = (v: number) => v / 10 ** qtyExp;
  const chartRef = useRef<HTMLDivElement>(null);
  const [priceSeries, setPriceSeries] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [volSeries, setVolSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const [granularity, setGranularity] = useState('1h');
  const [candles, setCandles] = useState<MarketCandle[]>(initialCandles || []);

  useEffect(() => {
    if (!chartRef.current) return;
    const c = createChart(chartRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8a92ad', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      crosshair: { mode: 1 },
    });
    const ps = c.addCandlestickSeries({
      upColor: '#22c5a4', downColor: '#f6477b', borderUpColor: '#22c5a4',
      borderDownColor: '#f6477b', wickUpColor: '#22c5a4', wickDownColor: '#f6477b',
    });
    const vs = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: 'rgba(138,146,173,0.5)' });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    setPriceSeries(ps); setVolSeries(vs);
    return () => c.remove();
  }, []);

  useEffect(() => {
    nativeApi.marketCandles(marketId, granularity, 500).then((r) => setCandles(r.items)).catch(() => {});
  }, [marketId, granularity]);

  useEffect(() => {
    if (!priceSeries || !volSeries) return;
    const cdata: CandlestickData[] = candles.map((c) => ({
      time: c.t as Time, open: sp(Number(c.o)), high: sp(Number(c.h)), low: sp(Number(c.l)), close: sp(Number(c.c)),
    }));
    const vdata: HistogramData[] = candles.map((c) => ({
      time: c.t as Time, value: sv(Number(c.v)),
      color: Number(c.c) >= Number(c.o) ? 'rgba(34,197,164,0.45)' : 'rgba(246,71,123,0.45)',
    }));
    priceSeries.setData(cdata);
    volSeries.setData(vdata);
  }, [priceSeries, volSeries, candles]);

  // Live: roll the latest candle from batch-clear prints.
  const live = useChannel<any>('dex:clears');
  useEffect(() => {
    if (!live || String(live.market_id) !== String(marketId)) return;
    const t = bucketStart(Number(live.block_time), granularity);
    const p = Number(live.price);
    const v = Number(live.qty);
    const last = candles[candles.length - 1];
    if (!last || last.t < t) {
      setCandles([...candles, { t, o: String(p), h: String(p), l: String(p), c: String(p), v: String(v), n: 1 }].slice(-500));
    } else if (last.t === t) {
      setCandles([...candles.slice(0, -1), {
        ...last, h: String(Math.max(Number(last.h), p)), l: String(Math.min(Number(last.l), p)),
        c: String(p), v: String(Number(last.v) + v), n: last.n + 1,
      }]);
    }
  }, [live, marketId, granularity]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
          {GRANS.map((g) => (
            <button key={g.id} onClick={() => setGranularity(g.id)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${granularity === g.id ? 'bg-energy-500/15 text-energy-400' : 'text-ink-400 hover:text-ink-100 hover:bg-white/5'}`}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-ink-400">
          <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulseDot" /><span>live</span>
        </div>
      </div>
      <div ref={chartRef} className="h-[300px] w-full sm:h-[420px]" />
    </div>
  );
}

function bucketStart(ts: number, gran: string): number {
  if (gran === '1d') {
    const d = new Date(ts * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  }
  const map: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
  const w = map[gran] || 3600;
  return Math.floor(ts / w) * w;
}
