'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useAccount, useBalance, usePublicClient, useWalletClient, useReadContract } from 'wagmi';
import { useSearchParams } from 'next/navigation';
import { api, type Quote } from '@/lib/api';
import { displaySymbol, fmtNum, fromBaseUnits, shortAddr, toBaseUnits } from '@/lib/format';
import { TokenPicker, type SimpleToken } from '@/components/token-picker';
import { ADDR } from '@/lib/chain';
import { ERC20_ABI, ROUTER_ABI } from '@/lib/abi';
import { maxUint256 } from 'viem';
import { trackTx } from '@/lib/tx-store';

const NATIVE: SimpleToken = { address: '0x0000000000000000000000000000000000000000', symbol: 'ECY', name: 'EnergyChain', decimals: 18 };

// Next.js requires components that consume `useSearchParams` to be inside a
// Suspense boundary; otherwise the entire route falls back to client-side
// rendering and `next build` refuses to prerender. We split the page into a
// shell that owns the boundary and an inner client component that does the
// work. This keeps the static page metadata available while still letting the
// inner widget read query params for share-link UX (?in=&out=).
export default function SwapPage() {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-ink-400">Loading swap…</div>}>
      <SwapPageInner />
    </Suspense>
  );
}

function SwapPageInner() {
  const params = useSearchParams();
  const [tokenIn, setTokenIn] = useState<SimpleToken | null>(null);
  const [tokenOut, setTokenOut] = useState<SimpleToken | null>(null);
  const [pickFor, setPickFor] = useState<null | 'in' | 'out'>(null);
  const [amountIn, setAmountIn] = useState('');
  // `slippageMode === 'auto'` derives the effective slippage from current
  // price impact: tight pools (impact < 0.5%) get 0.5% slippage; impact-heavy
  // routes scale up to 3% so the trade actually clears without forcing the
  // user to reach for the settings cog. Manual mode keeps whatever value the
  // user dialed in.
  const [slippageMode, setSlippageMode] = useState<'auto' | 'manual'>('auto');
  const [manualSlippage, setManualSlippage] = useState(0.5); // %
  const [deadlineMin, setDeadlineMin] = useState(20);
  const [showSettings, setShowSettings] = useState(false);
  const [acceptedHighImpact, setAcceptedHighImpact] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [txState, setTxState] = useState<'idle' | 'approving' | 'simulating' | 'pending' | 'success' | 'error'>('idle');
  const [txMsg, setTxMsg] = useState<string>('');

  const { address } = useAccount();
  const pc = usePublicClient();
  const wc = useWalletClient().data;

  // Bootstrap default tokens from query params or defaults.
  useEffect(() => {
    const from = params.get('in');
    const to = params.get('out');
    (async () => {
      try {
        if (from) setTokenIn(await api.getToken(from));
        else setTokenIn(NATIVE);
        if (to) setTokenOut(await api.getToken(to));
      } catch {}
    })();
  }, [params]);

  // Fetch quote on input change (debounced).
  useEffect(() => {
    if (!tokenIn || !tokenOut || !amountIn) { setQuote(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        setQuoting(true); setQuoteErr(null);
        const inAddr = tokenIn.address === NATIVE.address ? ADDR.wecy : tokenIn.address;
        const outAddr = tokenOut.address === NATIVE.address ? ADDR.wecy : tokenOut.address;
        const raw = toBaseUnits(amountIn, tokenIn.decimals);
        if (raw === 0n) { setQuote(null); return; }
        const q = await api.quote({ token_in: inAddr, token_out: outAddr, amount_in: raw.toString(), max_hops: 3 });
        setQuote(q);
      } catch (e: any) {
        setQuote(null); setQuoteErr(e?.message || 'no route');
      } finally {
        setQuoting(false);
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [tokenIn, tokenOut, amountIn]);

  const balanceIn = useBalance({
    address,
    token: tokenIn && tokenIn.address !== NATIVE.address ? (tokenIn.address as `0x${string}`) : undefined,
    chainId: undefined,
  });

  const allowance = useReadContract({
    address: tokenIn && tokenIn.address !== NATIVE.address ? (tokenIn.address as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && [address, ADDR.router],
    query: { enabled: Boolean(address && tokenIn && tokenIn.address !== NATIVE.address) },
  });

  const amountInRaw = useMemo(() => (tokenIn && amountIn ? toBaseUnits(amountIn, tokenIn.decimals) : 0n), [tokenIn, amountIn]);
  const needsApprove = tokenIn && tokenIn.address !== NATIVE.address && (allowance.data ?? 0n) < amountInRaw;
  // Reset the high-impact acknowledgement whenever the trade parameters
  // change so users have to reconfirm every time they materially alter the
  // outgoing transaction (defensive against accidental "OK" toggling).
  useEffect(() => { setAcceptedHighImpact(false); }, [tokenIn?.address, tokenOut?.address, amountIn, slippageMode, manualSlippage]);
  // Smart slippage: pick the tightest value that still leaves headroom for
  // the post-quote price drift (~3× current impact, capped to a sensible
  // 0.1%-3% band). Manual mode bypasses this.
  const impactPct = quote ? Number(quote.price_impact) * 100 : 0;
  const autoSlippage = useMemo(() => {
    if (!quote) return 0.5;
    const target = Math.min(3, Math.max(0.1, impactPct * 3));
    return Math.round(target * 100) / 100;
  }, [quote, impactPct]);
  const slippage = slippageMode === 'auto' ? autoSlippage : manualSlippage;
  const highImpact = impactPct >= 5; // ≥ 5 % is a hard warning gate
  const moderateImpact = impactPct >= 1 && impactPct < 5; // soft warning
  const minOut = useMemo(() => {
    if (!quote) return 0n;
    const out = BigInt(quote.amount_out);
    const num = BigInt(Math.round(10000 - slippage * 100));
    return (out * num) / 10000n;
  }, [quote, slippage]);

  async function handleApprove() {
    if (!wc || !pc || !tokenIn || !address) return;
    try {
      setTxState('approving'); setTxMsg('Approving token spend…');
      await trackTx({
        kind: 'approve',
        title: `Approve ${displaySymbol(tokenIn.symbol)}`,
        description: 'Granting router unlimited spend allowance',
        chainId: pc.chain?.id,
        run: async () => {
          const hash = await wc.writeContract({
            address: tokenIn.address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [ADDR.router, maxUint256],
          });
          return { hash, wait: pc.waitForTransactionReceipt({ hash }) };
        },
      });
      await allowance.refetch();
      setTxState('idle'); setTxMsg('Approved.');
    } catch (e: any) {
      setTxState('error'); setTxMsg(e?.shortMessage || e?.message || 'Approve failed');
    }
  }

  async function handleSwap() {
    if (!wc || !pc || !tokenIn || !tokenOut || !quote || !address) return;
    try {
      const path = quote.path.map((p, i) =>
        // Swap-out leg uses WECY where the user picked native.
        (i === 0 && tokenIn.address === NATIVE.address) || (i === quote.path.length - 1 && tokenOut.address === NATIVE.address)
          ? (ADDR.wecy as `0x${string}`)
          : (p as `0x${string}`),
      );
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMin * 60);

      setTxState('simulating'); setTxMsg('Simulating transaction…');
      let req: any;
      if (tokenIn.address === NATIVE.address) {
        req = await pc.simulateContract({
          account: address,
          address: ADDR.router, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
          args: [minOut, path, address, deadline],
          value: amountInRaw,
        });
      } else if (tokenOut.address === NATIVE.address) {
        req = await pc.simulateContract({
          account: address,
          address: ADDR.router, abi: ROUTER_ABI, functionName: 'swapExactTokensForETH',
          args: [amountInRaw, minOut, path, address, deadline],
        });
      } else {
        req = await pc.simulateContract({
          account: address,
          address: ADDR.router, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens',
          args: [amountInRaw, minOut, path, address, deadline],
        });
      }
      setTxState('pending'); setTxMsg('Awaiting wallet signature…');
      const receipt = await trackTx({
        kind: 'swap',
        title: `Swap ${displaySymbol(tokenIn.symbol)} → ${displaySymbol(tokenOut.symbol)}`,
        description: amountIn ? `Sending ${amountIn} ${displaySymbol(tokenIn.symbol)}` : undefined,
        chainId: pc.chain?.id,
        run: async () => {
          const hash = await wc.writeContract(req.request);
          return { hash, wait: pc.waitForTransactionReceipt({ hash }) };
        },
      });
      const hash = (receipt as { transactionHash: `0x${string}` }).transactionHash;
      setTxState('success'); setTxMsg(`Confirmed: ${shortAddr(hash, 6)}`);
      setAmountIn('');
    } catch (e: any) {
      setTxState('error'); setTxMsg(e?.shortMessage || e?.message || 'Swap failed');
    }
  }

  const switchSides = () => {
    const a = tokenIn, b = tokenOut;
    setTokenIn(b); setTokenOut(a); setAmountIn('');
  };

  const balanceText = balanceIn?.data ? fromBaseUnits(balanceIn.data.value.toString(), tokenIn?.decimals ?? 18, 6) : '0';

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,480px)_1fr] md:gap-6">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-base font-semibold">Swap</h2>
          <button onClick={() => setShowSettings((s) => !s)} className="text-ink-400 hover:text-ink-100" title="Settings">⚙</button>
        </div>
        {showSettings && (
          <div className="border-b border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center justify-between text-xs text-ink-400">
              <span>Slippage tolerance</span>
              <span className="text-ink-300">Effective: <span className="font-medium text-ink-100">{slippage.toFixed(2)}%</span></span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setSlippageMode('auto')}
                className={`btn-ghost px-3 py-1 text-xs ${slippageMode === 'auto' ? 'ring-1 ring-bull-500 text-bull-300' : ''}`}
              >Auto</button>
              {[0.1, 0.5, 1.0].map((p) => (
                <button
                  key={p}
                  onClick={() => { setSlippageMode('manual'); setManualSlippage(p); }}
                  className={`btn-ghost px-3 py-1 text-xs ${slippageMode === 'manual' && manualSlippage === p ? 'ring-1 ring-energy-500' : ''}`}
                >{p}%</button>
              ))}
              <input
                type="number" step="0.1"
                value={manualSlippage}
                onChange={(e) => { setSlippageMode('manual'); setManualSlippage(Number(e.target.value) || 0); }}
                className="input w-20"
              />
            </div>
            {slippageMode === 'auto' && quote && (
              <div className="mt-2 text-[11px] text-ink-400">
                Auto-derived from current price impact ({impactPct.toFixed(3)}%). Switch to Manual to override.
              </div>
            )}
            <div className="mt-4 text-xs text-ink-400">Transaction deadline (minutes)</div>
            <input type="number" value={deadlineMin} onChange={(e) => setDeadlineMin(Math.max(1, Number(e.target.value) || 1))} className="input mt-2 w-24" />
          </div>
        )}

        <div className="space-y-3 p-5">
          <TokenAmount
            label="You pay"
            token={tokenIn}
            amount={amountIn}
            onAmount={setAmountIn}
            onPick={() => setPickFor('in')}
            balance={balanceText}
            onMax={() => balanceIn?.data && setAmountIn(fromBaseUnits(balanceIn.data.value.toString(), tokenIn?.decimals ?? 18, 8))}
          />
          <div className="flex justify-center">
            <button onClick={switchSides} className="rounded-full border border-white/10 bg-ink-900 p-2 hover:bg-white/5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 3v18M7 21l-4-4M7 21l4-4M17 21V3M17 3l-4 4M17 3l4 4"/></svg>
            </button>
          </div>
          <TokenAmount
            label="You receive"
            token={tokenOut}
            amount={quote ? fromBaseUnits(quote.amount_out, tokenOut?.decimals ?? 18, 8) : ''}
            onAmount={() => {}}
            onPick={() => setPickFor('out')}
            readOnly
          />

          <QuoteSummary quote={quote} quoting={quoting} err={quoteErr} slippage={slippage} minOut={minOut} tokenOut={tokenOut} />

          {quote && moderateImpact && !highImpact && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Heads up: this swap moves the pool by {impactPct.toFixed(2)}%. You may receive notably less than the quoted amount.
            </div>
          )}
          {quote && highImpact && (
            <label className="flex items-start gap-2 rounded-xl border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acceptedHighImpact}
                onChange={(e) => setAcceptedHighImpact(e.target.checked)}
              />
              <span>
                <span className="font-semibold text-bear-200">High price impact ({impactPct.toFixed(2)}%).</span>{' '}
                You will likely receive far less than the spot price. Confirm you understand this trade is unlikely to be reversible.
              </span>
            </label>
          )}

          <ActionButton
            address={address}
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            amountIn={amountIn}
            quote={quote}
            needsApprove={Boolean(needsApprove)}
            onApprove={handleApprove}
            onSwap={handleSwap}
            txState={txState}
            disabled={highImpact && !acceptedHighImpact}
          />

          {txMsg && (
            <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
              txState === 'error' ? 'border-bear/30 bg-bear/10 text-bear-400' :
              txState === 'success' ? 'border-bull/30 bg-bull/10 text-bull-400' :
              'border-white/10 bg-white/[0.03] text-ink-300'
            }`}>{txMsg}</div>
          )}
        </div>
      </div>

      <RouteVisualizer quote={quote} tokenIn={tokenIn} tokenOut={tokenOut} />

      <TokenPicker
        open={pickFor !== null}
        onClose={() => setPickFor(null)}
        onSelect={(t) => (pickFor === 'in' ? setTokenIn(t) : setTokenOut(t))}
        exclude={pickFor === 'in' ? tokenOut?.address : tokenIn?.address}
      />
    </div>
  );
}

function TokenAmount({ label, token, amount, onAmount, onPick, balance, onMax, readOnly }: {
  label: string; token: SimpleToken | null; amount: string; onAmount: (s: string) => void;
  onPick: () => void; balance?: string; onMax?: () => void; readOnly?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-ink-850/80 border border-white/5 p-4">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>{label}</span>
        {balance !== undefined && (
          <button className="hover:text-energy-400" onClick={onMax}>Balance: {balance}</button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => onAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          readOnly={readOnly}
          className="w-full bg-transparent text-3xl font-medium text-ink-100 outline-none"
        />
        <button onClick={onPick} className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">
          {token ? <>
            <Avatar label={displaySymbol(token.symbol)} />
            <span className="font-medium">{displaySymbol(token.symbol)}</span>
          </> : <span>Select token</span>}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
    </div>
  );
}

function QuoteSummary({ quote, quoting, err, slippage, minOut, tokenOut }: {
  quote: Quote | null; quoting: boolean; err: string | null; slippage: number; minOut: bigint; tokenOut: SimpleToken | null;
}) {
  if (quoting) return <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-ink-400">Routing…</div>;
  if (err && !quote) return <div className="rounded-xl border border-bear/20 bg-bear/10 px-3 py-2 text-xs text-bear-400">{err}</div>;
  if (!quote || !tokenOut) return null;
  const impact = Number(quote.price_impact);
  const impactColor = impact > 0.05 ? 'text-bear' : impact > 0.01 ? 'text-energy-400' : 'text-bull';
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-sm">
      <Row k="Rate" v={`1 ≈ ${fmtNum(Number(fromBaseUnits(quote.amount_out, tokenOut.decimals, 8)) / Number(fromBaseUnits(quote.amount_in, 18, 8)) || 0)} ${displaySymbol(tokenOut.symbol)}`} />
      <Row k="Price impact" v={<span className={impactColor}>{(impact * 100).toFixed(3)}%</span>} />
      <Row k="Min received" v={`${fromBaseUnits(minOut.toString(), tokenOut.decimals, 6)} ${displaySymbol(tokenOut.symbol)}`} />
      <Row k="Hops" v={String(quote.hops)} />
      <Row k="Pool fee (total)" v={`${(quote.fee_bps_total / 100).toFixed(2)}%`} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-ink-400 text-xs">{k}</span>
      <span className="text-ink-100 text-xs">{v}</span>
    </div>
  );
}

function ActionButton({ address, tokenIn, tokenOut, amountIn, quote, needsApprove, onApprove, onSwap, txState, disabled }: any) {
  if (!address) return <button disabled className="btn-primary w-full">Connect wallet first</button>;
  if (!tokenIn || !tokenOut) return <button disabled className="btn-primary w-full">Select tokens</button>;
  if (!amountIn || amountIn === '0') return <button disabled className="btn-primary w-full">Enter amount</button>;
  if (!quote) return <button disabled className="btn-primary w-full">No route</button>;
  if (needsApprove) return <button onClick={onApprove} className="btn-primary w-full">{txState === 'approving' ? 'Approving…' : `Approve ${displaySymbol(tokenIn.symbol)}`}</button>;
  if (disabled) return <button disabled className="btn-primary w-full opacity-60">Acknowledge price impact to continue</button>;
  return <button onClick={onSwap} disabled={txState === 'pending' || txState === 'simulating'} className="btn-primary w-full">
    {txState === 'simulating' ? 'Simulating…' : txState === 'pending' ? 'Submitting…' : `Swap ${displaySymbol(tokenIn.symbol)} → ${displaySymbol(tokenOut.symbol)}`}
  </button>;
}

function RouteVisualizer({ quote, tokenIn, tokenOut }: any) {
  if (!quote) {
    return (
      <div className="card flex flex-col items-center justify-center p-8 text-center text-ink-400">
        <span className="text-3xl">🛣️</span>
        <h3 className="mt-3 text-sm">Route preview</h3>
        <p className="mt-1 text-xs">Pick two tokens to see the optimal swap path and pool flow.</p>
      </div>
    );
  }
  return (
    <div className="card p-6">
      <h3 className="text-sm font-medium">Route</h3>
      <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
        {quote.path.map((p: string, i: number) => (
          <div key={p + i} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <Avatar label={i === 0 ? displaySymbol(tokenIn?.symbol) || '?' : i === quote.path.length - 1 ? displaySymbol(tokenOut?.symbol) || '?' : '?'} />
              <span className="mt-1 text-[10px] mono text-ink-400">{shortAddr(p, 3)}</span>
            </div>
            {i < quote.path.length - 1 && (
              <div className="flex flex-col items-center">
                <svg width="40" height="14" viewBox="0 0 40 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-energy-400">
                  <path d="M2 7h32M30 3l4 4-4 4" />
                </svg>
                <span className="text-[10px] text-ink-400">0.30%</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-xl bg-white/[0.02] p-3 text-xs text-ink-400">
        Pools used: {quote.pairs.map((p: string) => shortAddr(p, 4)).join(' → ')}
      </div>
    </div>
  );
}

function Avatar({ label }: { label: string }) {
  let h = 0; for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: `hsl(${h},60%,45%)` }}>
      {label.slice(0, 2).toUpperCase() || '??'}
    </span>
  );
}
