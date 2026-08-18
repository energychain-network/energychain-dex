'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type CandlestickSeriesPartialOptions,
  type HistogramSeriesPartialOptions,
} from 'lightweight-charts';
import { api, type Candle } from '@/lib/api';
import { useChannel } from '@/lib/ws';

const GRANS = [
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
];

export function TradingView({
  pairAddress,
  initialCandles,
  quoteInverted = false,
}: {
  pairAddress: string;
  initialCandles: Candle[];
  // The indexer stores every candle as token1-per-token0. Uniswap orders a
  // pair's tokens by address, so which side that puts on top is arbitrary: for
  // the ECY pools it lands on "ECY per USDT", a series that falls while ECY
  // appreciates and contradicts the USD price shown beside the chart. Set this
  // to plot the reciprocal, quoting ECY in the asset it trades against.
  quoteInverted?: boolean;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [priceSeries, setPriceSeries] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [volSeries, setVolSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const [granularity, setGranularity] = useState('5m');
  const [candles, setCandles] = useState<Candle[]>(initialCandles || []);

  // Chart bootstrap.
  useEffect(() => {
    if (!chartRef.current) return;
    const c = createChart(chartRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8a92ad',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      crosshair: { mode: 1 },
    });
    const candleOpts: CandlestickSeriesPartialOptions = {
      upColor: '#22c5a4',
      downColor: '#f6477b',
      borderUpColor: '#22c5a4',
      borderDownColor: '#f6477b',
      wickUpColor: '#22c5a4',
      wickDownColor: '#f6477b',
    };
    const ps = c.addCandlestickSeries(candleOpts);
    const volOpts: HistogramSeriesPartialOptions = {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: 'rgba(138, 146, 173, 0.5)',
    };
    const vs = c.addHistogramSeries(volOpts);
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    setChart(c); setPriceSeries(ps); setVolSeries(vs);
    return () => c.remove();
  }, []);

  // Reload data when granularity changes.
  useEffect(() => {
    api.candles(pairAddress, granularity, 500).then((r) => setCandles(r.items)).catch(() => {});
  }, [pairAddress, granularity]);

  // Push data into the series. Inversion happens here rather than on the stored
  // candles so the WebSocket path below keeps working in the indexer's own price
  // space. Taking reciprocals swaps the extremes — the lowest rate is the
  // highest price — so high and low trade places.
  useEffect(() => {
    if (!priceSeries || !volSeries || !candles) return;
    const shaped = candles.map((c) => {
      const o = Number(c.o), h = Number(c.h), l = Number(c.l), cl = Number(c.c);
      const flip = quoteInverted && o > 0 && h > 0 && l > 0 && cl > 0;
      return {
        time: c.t as Time,
        open: flip ? 1 / o : o,
        high: flip ? 1 / l : h,
        low: flip ? 1 / h : l,
        close: flip ? 1 / cl : cl,
        volume: Number(c.v_usd) || Number(c.v),
      };
    });
    const cdata: CandlestickData[] = shaped.map(({ time, open, high, low, close }) => ({
      time, open, high, low, close,
    }));
    const vdata: HistogramData[] = shaped.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34,197,164,0.45)' : 'rgba(246,71,123,0.45)',
    }));
    priceSeries.setData(cdata);
    volSeries.setData(vdata);
  }, [priceSeries, volSeries, candles, quoteInverted]);

  // Live update: append/update the last candle from WebSocket swap events.
  // This keeps the chart in sync with the indexer without re-fetching.
  const live = useChannel<any>('dex:swaps');
  useEffect(() => {
    if (!live || !priceSeries || !volSeries) return;
    if (String(live.pair).toLowerCase() !== pairAddress.toLowerCase()) return;
    const t = bucketStart(Number(live.block_time), granularity);
    const price = Number(live.price);
    const vol = Number(live.amount_usd);
    const last = candles[candles.length - 1];
    if (!last || last.t < t) {
      const next: Candle = { t, o: String(price), h: String(price), l: String(price), c: String(price), v: '0', v_usd: String(vol), n: 1 };
      const merged = [...candles, next].slice(-500);
      setCandles(merged);
    } else if (last.t === t) {
      const updated: Candle = {
        ...last,
        h: String(Math.max(Number(last.h), price)),
        l: String(Math.min(Number(last.l), price)),
        c: String(price),
        v_usd: String(Number(last.v_usd) + vol),
        n: last.n + 1,
      };
      setCandles([...candles.slice(0, -1), updated]);
    }
  }, [live, pairAddress, granularity]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 scrollbar-none">
          {GRANS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${granularity === g.id ? 'bg-energy-500/15 text-energy-400' : 'text-ink-400 hover:text-ink-100 hover:bg-white/5'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-ink-400">
          <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulseDot" />
          <span className="hidden xs:inline sm:inline">live</span>
        </div>
      </div>
      <div ref={chartRef} className="h-[320px] w-full sm:h-[460px]" />
    </div>
  );
}

// Mirrors aggregator.bucketSpec.Floor on the indexer side. We MUST agree with
// the server's definition or live updates will land in a different candle than
// the historical data and produce ghosted bars.
function bucketStart(ts: number, gran: string): number {
  if (gran === '1d') {
    const d = new Date(ts * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  }
  if (gran === '1w') {
    const d = new Date(ts * 1000);
    const dayOfWeek = d.getUTCDay(); // 0 = Sunday
    const offset = (dayOfWeek + 6) % 7; // Monday = 0
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset) / 1000);
  }
  const map: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
  const w = map[gran] || 60;
  return Math.floor(ts / w) * w;
}
