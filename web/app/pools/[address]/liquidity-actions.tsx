'use client';

import { useState, useMemo } from 'react';
import { useAccount, usePublicClient, useWalletClient, useReadContract } from 'wagmi';
import { maxUint256 } from 'viem';
import { ADDR, energyChain } from '@/lib/chain';
import { ERC20_ABI, ROUTER_ABI } from '@/lib/abi';
import { displaySymbol, fmtNum, fromBaseUnits, toBaseUnits, shortAddr } from '@/lib/format';
import { trackTx } from '@/lib/tx-store';

// Minimal but functional add / remove liquidity. Symmetric: pricing of the
// second side is auto-calculated from current reserves so users don't accidentally
// shift the curve.
export function LiquidityActions({ pair }: { pair: any }) {
  const [tab, setTab] = useState<'add' | 'remove'>('add');
  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-white/5">
        <TabButton on={tab === 'add'} onClick={() => setTab('add')}>Add liquidity</TabButton>
        <TabButton on={tab === 'remove'} onClick={() => setTab('remove')}>Remove</TabButton>
      </div>
      {tab === 'add' ? <AddLiquidity pair={pair} /> : <RemoveLiquidity pair={pair} />}
    </div>
  );
}

function TabButton({ on, onClick, children }: any) {
  return (
    <button onClick={onClick} className={`flex-1 px-4 py-3 text-sm transition ${on ? 'bg-white/5 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>
      {children}
    </button>
  );
}

function AddLiquidity({ pair }: { pair: any }) {
  const { address } = useAccount();
  const wc = useWalletClient({ chainId: energyChain.id }).data;
  const pc = usePublicClient();
  const [amt0, setAmt0] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Symmetric ratio: amount1 = amount0 * reserve1 / reserve0
  const amt1 = useMemo(() => {
    if (!amt0 || !pair.reserve0 || pair.reserve0 === '0') return '';
    const a0 = toBaseUnits(amt0, 18);
    const r0 = BigInt(String(pair.reserve0).split('.')[0] || '0');
    const r1 = BigInt(String(pair.reserve1).split('.')[0] || '0');
    if (r0 === 0n) return '';
    return fromBaseUnits(((a0 * r1) / r0).toString(), 18, 8);
  }, [amt0, pair.reserve0, pair.reserve1]);

  const allow0 = useReadContract({
    address: pair.token0 as `0x${string}`,
    abi: ERC20_ABI, functionName: 'allowance',
    args: address && [address, ADDR.router],
    query: { enabled: Boolean(address) },
  });
  const allow1 = useReadContract({
    address: pair.token1 as `0x${string}`,
    abi: ERC20_ABI, functionName: 'allowance',
    args: address && [address, ADDR.router],
    query: { enabled: Boolean(address) },
  });

  async function approve(token: `0x${string}`) {
    if (!wc || !pc) return;
    await trackTx({
      kind: 'approve',
      title: 'Approve LP token',
      description: 'Granting router unlimited spend allowance',
      chainId: pc.chain?.id,
      run: async () => {
        const h = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.router, maxUint256] });
        return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
      },
    });
  }

  async function add() {
    if (!wc || !pc || !address || !amt0 || !amt1) return;
    try {
      setBusy(true); setMsg({ tone: 'info', text: 'Preparing…' });
      const a0 = toBaseUnits(amt0, 18);
      const a1 = toBaseUnits(amt1, 18);
      if ((allow0.data ?? 0n) < a0) { setMsg({ tone: 'info', text: 'Approving token0…' }); await approve(pair.token0); await allow0.refetch(); }
      if ((allow1.data ?? 0n) < a1) { setMsg({ tone: 'info', text: 'Approving token1…' }); await approve(pair.token1); await allow1.refetch(); }

      // 1% slippage on minimums to absorb intra-block price drift.
      const min0 = (a0 * 99n) / 100n;
      const min1 = (a1 * 99n) / 100n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      setMsg({ tone: 'info', text: 'Simulating…' });
      const sim = await pc.simulateContract({
        account: address,
        address: ADDR.router, abi: ROUTER_ABI, functionName: 'addLiquidity',
        args: [pair.token0, pair.token1, a0, a1, min0, min1, address, deadline],
      });
      setMsg({ tone: 'info', text: 'Awaiting signature…' });
      const rcpt = await trackTx({
        kind: 'add-liquidity',
        title: `Add liquidity ${displaySymbol(pair.symbol0)}/${displaySymbol(pair.symbol1)}`,
        description: `${amt0} ${displaySymbol(pair.symbol0)} + ${amt1} ${displaySymbol(pair.symbol1)}`,
        chainId: pc.chain?.id,
        run: async () => {
          const h = await wc.writeContract(sim.request);
          return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
        },
      });
      const hash = (rcpt as { transactionHash: `0x${string}` }).transactionHash;
      setMsg({ tone: 'ok', text: `Added: ${shortAddr(hash, 6)}` });
      setAmt0('');
    } catch (e: any) {
      setMsg({ tone: 'err', text: e?.shortMessage || e?.message || 'Add liquidity failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-5">
      <Field label={`Amount of ${displaySymbol(pair.symbol0) || shortAddr(pair.token0)}`} value={amt0} onChange={setAmt0} />
      <Field label={`Amount of ${displaySymbol(pair.symbol1) || shortAddr(pair.token1)} (auto)`} value={amt1} readOnly />
      <p className="text-xs text-ink-400">Both sides are required at the current pool ratio. The auto-quoted amount uses the latest synced reserves.</p>
      <button onClick={add} disabled={!address || busy || !amt0 || !amt1} className="btn-primary w-full">{busy ? 'Working…' : address ? 'Add liquidity' : 'Connect wallet'}</button>
      {msg && <Notice {...msg} />}
    </div>
  );
}

function RemoveLiquidity({ pair }: { pair: any }) {
  const { address } = useAccount();
  const wc = useWalletClient({ chainId: energyChain.id }).data;
  const pc = usePublicClient();
  const [pct, setPct] = useState(50);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const lpBal = useReadContract({
    address: pair.address as `0x${string}`,
    abi: ERC20_ABI, functionName: 'balanceOf',
    args: address && [address],
    query: { enabled: Boolean(address) },
  });
  const lpAllow = useReadContract({
    address: pair.address as `0x${string}`,
    abi: ERC20_ABI, functionName: 'allowance',
    args: address && [address, ADDR.router],
    query: { enabled: Boolean(address) },
  });

  async function remove() {
    if (!wc || !pc || !address || !lpBal.data) return;
    try {
      setBusy(true); setMsg({ tone: 'info', text: 'Preparing…' });
      const amount = (lpBal.data * BigInt(pct)) / 100n;
      if ((lpAllow.data ?? 0n) < amount) {
        setMsg({ tone: 'info', text: 'Approving LP token…' });
        await trackTx({
          kind: 'approve',
          title: 'Approve LP token',
          chainId: pc.chain?.id,
          run: async () => {
            const h = await wc.writeContract({ address: pair.address, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.router, maxUint256] });
            return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
          },
        });
        await lpAllow.refetch();
      }
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const sim = await pc.simulateContract({
        account: address,
        address: ADDR.router, abi: ROUTER_ABI, functionName: 'removeLiquidity',
        args: [pair.token0, pair.token1, amount, 0n, 0n, address, deadline],
      });
      const rcpt = await trackTx({
        kind: 'remove-liquidity',
        title: `Remove ${pct}% liquidity`,
        description: `${displaySymbol(pair.symbol0)}/${displaySymbol(pair.symbol1)}`,
        chainId: pc.chain?.id,
        run: async () => {
          const h = await wc.writeContract(sim.request);
          return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
        },
      });
      const hash = (rcpt as { transactionHash: `0x${string}` }).transactionHash;
      setMsg({ tone: 'ok', text: `Removed: ${shortAddr(hash, 6)}` });
    } catch (e: any) {
      setMsg({ tone: 'err', text: e?.shortMessage || e?.message || 'Remove failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-5">
      <div className="rounded-2xl bg-ink-850 border border-white/5 p-4">
        <div className="text-xs text-ink-400">Your LP balance</div>
        <div className="mt-1 text-xl font-semibold mono">{lpBal.data ? fromBaseUnits(lpBal.data.toString(), 18, 8) : '—'}</div>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-ink-400">
          <span>Withdraw</span><span>{pct}%</span>
        </div>
        <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="mt-2 w-full accent-energy-500" />
        <div className="mt-2 flex gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => setPct(p)} className={`btn-ghost px-2 py-1 text-xs ${pct === p ? 'ring-1 ring-energy-500' : ''}`}>{p}%</button>
          ))}
        </div>
      </div>
      <button onClick={remove} disabled={!address || busy || !lpBal.data} className="btn-primary w-full">{busy ? 'Working…' : address ? `Remove ${pct}%` : 'Connect wallet'}</button>
      {msg && <Notice {...msg} />}
    </div>
  );
}

function Field({ label, value, onChange, readOnly }: any) {
  return (
    <div className="rounded-2xl bg-ink-850 border border-white/5 p-4">
      <div className="text-xs text-ink-400">{label}</div>
      <input value={value} onChange={(e) => onChange?.(e.target.value.replace(/[^0-9.]/g, ''))} readOnly={readOnly} placeholder="0.0" className="mt-1 w-full bg-transparent text-2xl outline-none" />
    </div>
  );
}

function Notice({ tone, text }: { tone: 'ok' | 'err' | 'info'; text: string }) {
  const cls = tone === 'ok' ? 'border-bull/30 bg-bull/10 text-bull-400' : tone === 'err' ? 'border-bear/30 bg-bear/10 text-bear-400' : 'border-white/10 bg-white/[0.03] text-ink-300';
  return <div className={`rounded-xl border px-3 py-2 text-xs ${cls}`}>{text}</div>;
}
