'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { CircleDollarSign, Landmark, Waves, ScrollText, TrendingUp, ShieldCheck, ShieldX, ShieldAlert, BadgeCheck, Globe, Inbox } from 'lucide-react';
import { nativeApi, type NativePortfolio, type IdentityAccount } from '@/lib/native-api';
import { amt, price, epoch } from '@/lib/native-format';
import { shortAddr } from '@/lib/format';
import { useCosmos } from '@/lib/cosmos-wallet';
import { StatusPill, EmptyBlock, AssetBadge } from '@/components/page-header';

export function NativePortfolioSection() {
  const { address, connect, connecting } = useCosmos();
  const [data, setData] = useState<NativePortfolio | null>(null);
  const [kyc, setKyc] = useState<IdentityAccount | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) { setData(null); setKyc(null); return; }
    setLoading(true);
    Promise.all([
      nativeApi.portfolio(address).then(setData).catch(() => setData(null)),
      nativeApi.identityAccount(address).then(setKyc).catch(() => setKyc(null)),
    ]).finally(() => setLoading(false));
  }, [address]);

  if (!address) {
    return (
      <div className="card p-6 text-center space-y-3">
        <p className="text-sm text-ink-300">连接 Cosmos 钱包查看您的链上原生资产组合 (稳定币 / RWA / Mincast / 挂单 / 认购)。</p>
        <button className="btn-primary" disabled={connecting} onClick={() => connect().catch(() => {})}>
          {connecting ? '连接中…' : '连接 Keplr'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-ink-400">Cosmos 地址</div>
          <div className="mono text-sm">{shortAddr(address, 8)}</div>
        </div>
        <KycBadge kyc={kyc} />
      </div>

      <Balances title="稳定币 Stablecoins" icon={CircleDollarSign} rows={(data?.stable_balances ?? []).map((b) => ({
        key: b.denom_id, name: b.symbol || b.denom_id, sub: b.denom_id, amount: amt(b.amount, b.decimals),
        href: `/assets/denom/${b.denom_id}`,
      }))} />
      <Balances title="RWA 代币" icon={Landmark} rows={(data?.rwa_balances ?? []).map((b) => ({
        key: b.token_id, name: b.symbol, sub: b.name, amount: amt(b.amount, b.decimals), href: `/assets/rwa/${b.token_id}`,
      }))} />
      <Balances title="Mincast 持仓" icon={Waves} rows={(data?.mincast_balances ?? []).map((b) => ({
        key: b.market_id, name: b.name || b.denom, sub: `保底价 ${price(b.floor_price)}`, amount: amt(b.amount, 0), href: `/mincast/${b.market_id}`,
      }))} />

      {(data?.open_orders?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
            <ScrollText size={15} className="text-energy-400" /> 挂单 Open orders
          </div>
          <table className="w-full text-sm">
            <tbody>
              {data!.open_orders.map((o) => (
                <tr key={o.id} className="border-t border-white/5">
                  <td className="px-4 py-2"><Link href={`/trade/${o.market_id}`} className="hover:text-energy-400">市场 #{o.market_id}</Link></td>
                  <td className={`px-4 py-2 ${o.side.includes('BUY') ? 'text-bull-400' : 'text-bear-400'}`}>{o.side.includes('BUY') ? '买' : '卖'}</td>
                  <td className="px-4 py-2 text-right mono">{price(o.price)}</td>
                  <td className="px-4 py-2 text-right mono">{price(o.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data?.invests?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
            <TrendingUp size={15} className="text-energy-400" /> Mincast 投资
          </div>
          <table className="w-full text-sm">
            <thead className="text-left"><tr className="bg-white/[0.02]">
              <th className="th py-2">市场</th><th className="th py-2 text-right">本金</th>
              <th className="th py-2 text-right">APY</th><th className="th py-2 text-right">到期</th><th className="th py-2 text-right">状态</th>
            </tr></thead>
            <tbody>
              {data!.invests.map((iv) => (
                <tr key={iv.id} className="tr-row">
                  <td className="px-4 py-2.5"><Link href={`/mincast/${iv.market_id}`} className="hover:text-energy-400">#{iv.market_id}</Link></td>
                  <td className="px-4 py-2.5 text-right mono">{amt(iv.principal_units, 0)}</td>
                  <td className="px-4 py-2.5 text-right text-bull-400">{(iv.apy_bps / 100).toFixed(2)}%</td>
                  <td className="px-4 py-2.5 text-right text-xs text-ink-400">{epoch(iv.maturity)}</td>
                  <td className="px-4 py-2.5 text-right"><StatusPill status={iv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && <p className="text-xs text-ink-400">加载中…</p>}
    </div>
  );
}

function KycBadge({ kyc }: { kyc: IdentityAccount | null }) {
  if (!kyc || kyc.exists === false) {
    return (
      <span className="chip border-amber-400/20 bg-amber-400/5 text-amber-300">
        <ShieldAlert size={12} /> 未完成 KYC
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {kyc.kyc_cleared ? (
        <span className="chip border-bull/20 bg-bull/10 text-bull-400"><ShieldCheck size={12} /> KYC 通过</span>
      ) : (
        <span className="chip border-bear/20 bg-bear/10 text-bear-400"><ShieldX size={12} /> KYC 未通过</span>
      )}
      {kyc.accredited && <span className="chip"><BadgeCheck size={12} /> 合格投资者</span>}
      {kyc.jurisdiction && <span className="chip"><Globe size={12} /> {kyc.jurisdiction}</span>}
    </div>
  );
}

function Balances({ title, icon: Icon, rows }: { title: string; icon: LucideIcon; rows: { key: string; name: string; sub: string; amount: string; href: string }[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-medium">
        <Icon size={15} className="text-energy-400" /> {title}
      </div>
      {rows.length === 0 ? (
        <EmptyBlock icon={Inbox} title="无持仓" className="py-6" />
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="tr-row group">
                <td className="px-4 py-2.5">
                  <Link href={r.href} className="flex items-center gap-2.5">
                    <AssetBadge symbol={r.name} size={28} />
                    <span>
                      <span className="block font-medium group-hover:text-energy-400 transition-colors">{r.name}</span>
                      <span className="block text-xs text-ink-400">{r.sub}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right mono text-base">{r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
