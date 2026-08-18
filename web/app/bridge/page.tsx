'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  nativeApi,
  type BridgeChain,
  type BridgeAsset,
  type BridgeInbound,
  type BridgeOutbound,
  type BridgeParams,
  type Denom,
} from '@/lib/native-api';
import {
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Globe,
  Coins,
  Info,
  TriangleAlert,
  Inbox,
} from 'lucide-react';
import { MSGS } from '@/lib/cosmos-msgs';
import { msg } from '@/lib/cosmos';
import { amt, epoch } from '@/lib/native-format';
import { shortAddr, toBaseUnits, fromBaseUnits } from '@/lib/format';
import { useCosmos } from '@/lib/cosmos-wallet';
import { useNativeTx } from '@/components/native/use-native-tx';
import { Field, Select, SubmitButton, TxResult } from '@/components/native/ui';
import { PageHeader, EmptyBlock, StatusPill } from '@/components/page-header';

type Tab = 'deposit' | 'withdraw';

export default function BridgePage() {
  const { address } = useCosmos();
  const [chains, setChains] = useState<BridgeChain[]>([]);
  const [assets, setAssets] = useState<BridgeAsset[]>([]);
  const [params, setParams] = useState<BridgeParams | null>(null);
  const [inbounds, setInbounds] = useState<BridgeInbound[]>([]);
  const [outbounds, setOutbounds] = useState<BridgeOutbound[]>([]);
  const [denoms, setDenoms] = useState<Denom[]>([]);
  const [netBridged, setNetBridged] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('deposit');

  const load = () => {
    nativeApi.bridgeChains().then((r) => setChains(r.chains ?? [])).catch(() => {});
    nativeApi.bridgeAssets().then((r) => setAssets(r.assets ?? [])).catch(() => {});
    nativeApi.bridgeParams().then((r) => setParams(r.params)).catch(() => {});
    nativeApi.bridgeInbounds().then((r) => setInbounds(r.inbounds ?? [])).catch(() => {});
    nativeApi.bridgeOutbounds().then((r) => setOutbounds(r.outbounds ?? [])).catch(() => {});
    nativeApi.denoms().then((r) => setDenoms(r.items ?? [])).catch(() => {});
  };
  useEffect(() => {
    load();
    const h = setInterval(load, 15000);
    return () => clearInterval(h);
  }, []);

  // Per-asset net bridged outstanding (minted - burned).
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      assets.map((a) =>
        nativeApi.bridgeNetBridged(a.denom).then((r) => [a.denom, r.balance] as const).catch(() => [a.denom, '0'] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setNetBridged(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const decOf = useMemo(() => {
    const m: Record<string, number> = {};
    denoms.forEach((d) => {
      m[d.id] = d.decimals;
    });
    return m;
  }, [denoms]);
  const assetById = useMemo(() => {
    const m: Record<string, BridgeAsset> = {};
    assets.forEach((a) => {
      m[a.id] = a;
    });
    return m;
  }, [assets]);
  const decOfAsset = (assetId: string) => decOf[assetById[assetId]?.denom] ?? 6;
  const chainOf = (id: string) => chains.find((c) => c.id === id);

  const myInbounds = address ? inbounds.filter((i) => i.recipient === address) : inbounds;
  const myOutbounds = address ? outbounds.filter((o) => o.sender === address) : outbounds;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 space-y-6">
      <PageHeader
        icon={ArrowLeftRight}
        title={<>跨链桥 <span className="text-ink-400 font-normal">Bridge</span></>}
        subtitle="把以太坊等外链的 USDC / USDT 跨入本链，按 1:1 铸造本链稳定币，用于认购、募资与加池子；出金时销毁稳定币、外链释放等额抵押。"
      />

      {params?.paused && (
        <div className="flex items-center gap-2.5 rounded-xl border border-bear/20 bg-bear/10 px-4 py-3 text-sm text-bear-300">
          <TriangleAlert size={16} className="shrink-0" />
          跨链桥当前已全局暂停（治理风控）。新入金/出金暂不可用。
        </div>
      )}

      {/* supported chains + bridged assets */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
            <Globe size={15} className="text-energy-400" /> 支持的外链
          </div>
          {chains.length === 0 ? (
            <EmptyBlock icon={Globe} title="尚未注册外链" className="py-8" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="bg-white/[0.02]">
                  <th className="th py-2">链</th>
                  <th className="th py-2">标识</th>
                  <th className="th py-2 text-center">多签门限</th>
                  <th className="th py-2 text-right">状态</th>
                </tr>
              </thead>
              <tbody>
                {chains.map((c) => (
                  <tr key={c.id} className="tr-row">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 mono text-xs text-ink-400">{c.chain_ref}</td>
                    <td className="px-4 py-2.5 text-center mono text-xs">{c.threshold}/{c.attestors.length}</td>
                    <td className="px-4 py-2.5 text-right"><StatusPill status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
            <Coins size={15} className="text-energy-400" /> 可跨链资产
          </div>
          {assets.length === 0 ? (
            <EmptyBlock icon={Coins} title="尚未注册资产" className="py-8" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="bg-white/[0.02]">
                  <th className="th py-2">本链稳定币</th>
                  <th className="th py-2 text-right">已桥接发行量</th>
                  <th className="th py-2 text-right">状态</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="tr-row">
                    <td className="px-4 py-2.5 font-medium uppercase">{a.denom}</td>
                    <td className="px-4 py-2.5 text-right mono">{amt(netBridged[a.denom], decOf[a.denom] ?? 6)}</td>
                    <td className="px-4 py-2.5 text-right"><StatusPill status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm w-fit">
        {([
          { id: 'deposit', label: '入金 Deposit', icon: <ArrowDownToLine size={14} /> },
          { id: 'withdraw', label: '出金 Withdraw', icon: <ArrowUpFromLine size={14} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition-colors ${
              tab === t.id ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'deposit' ? (
        <DepositPanel
          inbounds={myInbounds}
          chainOf={chainOf}
          assetById={assetById}
          decOfAsset={decOfAsset}
          onDone={load}
          address={address}
        />
      ) : (
        <WithdrawPanel
          assets={assets}
          chains={chains}
          decOfAsset={decOfAsset}
          outbounds={myOutbounds}
          chainOf={chainOf}
          paused={!!params?.paused}
          onDone={load}
        />
      )}
    </div>
  );
}

// ---- deposit (inbound mint) -----------------------------------------------

function DepositPanel({
  inbounds,
  chainOf,
  assetById,
  decOfAsset,
  onDone,
  address,
}: {
  inbounds: BridgeInbound[];
  chainOf: (id: string) => BridgeChain | undefined;
  assetById: Record<string, BridgeAsset>;
  decOfAsset: (assetId: string) => number;
  onDone: () => void;
  address?: string | null;
}) {
  const tx = useNativeTx();

  const release = async (id: string) => {
    if (!address) return;
    const ok = await tx.run([msg(MSGS.BridgeRelease.typeUrl, { caller: address, inboundId: id })]);
    if (ok) setTimeout(onDone, 1500);
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-300 space-y-2">
        <div className="flex items-center gap-2 font-medium text-ink-100">
          <Info size={15} className="text-energy-400" /> 如何入金
        </div>
        <ol className="list-decimal pl-5 space-y-1 text-ink-400">
          <li>在外链（如以太坊）将 USDC / USDT 转入该链对应的官方托管合约。</li>
          <li>见证人多签对这笔存款进行链上见证，达到门限后状态变为 ATTESTED。</li>
          <li>在下方点击「领取」即可在本链 1:1 铸造稳定币到你的地址（任何人都可触发铸造，受储备金与限额约束）。</li>
        </ol>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
          <ArrowDownToLine size={15} className="text-bull-400" />
          {address ? '我的入金' : '最近入金'}
        </div>
        {inbounds.length === 0 ? (
          <EmptyBlock icon={Inbox} title="暂无入金记录" className="py-8" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th py-2">来源链</th>
                <th className="th py-2">收款人</th>
                <th className="th py-2 text-right">金额</th>
                <th className="th py-2 text-center">见证</th>
                <th className="th py-2 text-right">状态</th>
                <th className="th py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {inbounds.map((i) => {
                const dec = decOfAsset(i.asset_id);
                const denom = assetById[i.asset_id]?.denom ?? '';
                const attested = i.status.includes('ATTESTED');
                const released = i.status.includes('RELEASED');
                return (
                  <tr key={i.id} className="tr-row">
                    <td className="px-4 py-2.5">{chainOf(i.src_chain_id)?.name ?? `#${i.src_chain_id}`}</td>
                    <td className="px-4 py-2.5 mono text-xs">{shortAddr(i.recipient, 6)}</td>
                    <td className="px-4 py-2.5 text-right mono">{amt(i.amount, dec)} <span className="text-ink-500 uppercase">{denom}</span></td>
                    <td className="px-4 py-2.5 text-center text-xs text-ink-400">{i.attestations.length}</td>
                    <td className="px-4 py-2.5 text-right"><StatusPill status={i.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      {released ? (
                        <span className="text-xs text-ink-500">{epoch(i.released_at)}</span>
                      ) : attested && address ? (
                        <button
                          onClick={() => release(i.id)}
                          disabled={tx.pending}
                          className="rounded-lg bg-bull px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-bull/90 disabled:opacity-50"
                        >
                          {tx.pending ? '…' : '领取'}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-500">{attested ? '连接钱包领取' : '待见证'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <TxResult tx={tx} />
    </div>
  );
}

// ---- withdraw (outbound burn) ---------------------------------------------

function WithdrawPanel({
  assets,
  chains,
  decOfAsset,
  outbounds,
  chainOf,
  paused,
  onDone,
}: {
  assets: BridgeAsset[];
  chains: BridgeChain[];
  decOfAsset: (assetId: string) => number;
  outbounds: BridgeOutbound[];
  chainOf: (id: string) => BridgeChain | undefined;
  paused: boolean;
  onDone: () => void;
}) {
  const tx = useNativeTx();
  const activeAssets = assets.filter((a) => a.status.includes('ACTIVE'));
  const activeChains = chains.filter((c) => c.status.includes('ACTIVE'));
  const [assetId, setAssetId] = useState('');
  const [chainId, setChainId] = useState('');
  const [amount, setAmount] = useState('');
  const [destAddr, setDestAddr] = useState('');
  const [bal, setBal] = useState('0');

  useEffect(() => {
    if (!assetId && activeAssets.length) setAssetId(activeAssets[0].id);
    if (!chainId && activeChains.length) setChainId(activeChains[0].id);
  }, [activeAssets, activeChains, assetId, chainId]);

  // Available balance (raw minimal units) of the selected asset's stablecoin.
  const denomOf = (id: string) => assets.find((a) => a.id === id)?.denom ?? '';
  useEffect(() => {
    const denom = denomOf(assetId);
    if (!tx.address || !denom) { setBal('0'); return; }
    nativeApi.denomBalance(denom, tx.address).then((r) => setBal(r.amount || '0')).catch(() => setBal('0'));
  }, [tx.address, assetId, tx.txhash]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!tx.address || !assetId || !chainId) return;
    const dec = decOfAsset(assetId);
    const base = toBaseUnits(amount, dec).toString();
    const ok = await tx.run([
      msg(MSGS.BridgeLock.typeUrl, {
        sender: tx.address,
        assetId,
        amount: base,
        destChainId: chainId,
        destAddr,
      }),
    ]);
    if (ok) {
      setAmount('');
      setDestAddr('');
      setTimeout(onDone, 1500);
    }
  };

  const dec = decOfAsset(assetId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4 space-y-4 h-fit">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ArrowUpFromLine size={15} className="text-bear-400" /> 出金到外链
        </div>
        <Select
          label="资产"
          value={assetId}
          onChange={setAssetId}
          options={activeAssets.map((a) => ({ value: a.id, label: a.denom.toUpperCase() }))}
        />
        <Select
          label="目标链"
          value={chainId}
          onChange={setChainId}
          options={activeChains.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Field label={`数量 (${denomOf(assetId).toUpperCase() || '稳定币'})`} value={amount} onChange={setAmount} type="number" placeholder="0.0"
          hint={`可用 ${amt(bal, dec)} ${denomOf(assetId).toUpperCase()}`}
          right={bal && bal !== '0' ? (
            <button type="button" onClick={() => setAmount(fromBaseUnits(bal, dec))}
              className="text-[11px] text-energy-400 hover:text-energy-300">最大</button>
          ) : undefined} />
        <Field label="目标链收款地址" value={destAddr} onChange={setDestAddr} placeholder="0x…" hint="外链（如以太坊）接收抵押的地址" />
        <SubmitButton
          tx={tx}
          label={paused ? '已暂停' : '销毁并出金'}
          onClick={submit}
          disabled={paused || !amount || !destAddr || !assetId || !chainId}
          variant="bear"
        />
        <TxResult tx={tx} />
        <p className="text-[11px] text-ink-500">
          出金会销毁本链稳定币，并由中继在目标链释放等额 USDC / USDT 到你填写的地址。
        </p>
      </div>

      <div className="card overflow-hidden h-fit">
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
          <ArrowUpFromLine size={15} className="text-bear-400" />
          {tx.address ? '我的出金' : '最近出金'}
        </div>
        {outbounds.length === 0 ? (
          <EmptyBlock icon={Inbox} title="暂无出金记录" className="py-8" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="bg-white/[0.02]">
                <th className="th py-2">目标链</th>
                <th className="th py-2">收款地址</th>
                <th className="th py-2 text-right">金额</th>
                <th className="th py-2 text-right">时间</th>
              </tr>
            </thead>
            <tbody>
              {outbounds.map((o) => (
                <tr key={o.nonce} className="tr-row">
                  <td className="px-4 py-2.5">{chainOf(o.dest_chain_id)?.name ?? `#${o.dest_chain_id}`}</td>
                  <td className="px-4 py-2.5 mono text-xs">{shortAddr(o.dest_addr, 6)}</td>
                  <td className="px-4 py-2.5 text-right mono">{amt(o.amount, decOfAsset(o.asset_id))}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-ink-400">{epoch(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
