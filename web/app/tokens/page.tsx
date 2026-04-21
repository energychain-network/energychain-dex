import Link from 'next/link';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';
import { TokenAvatar } from '@/components/token-avatar';

export const revalidate = 15;

// `?verified=1` filters to operator-curated tokens (trust_score>=2). Anyone
// listing a brand new ERC20 lands at trust_score=1 by default, so this
// search-param toggle is the user-facing equivalent of the swap-page
// safety filter.
export default async function TokensPage({ searchParams }: { searchParams?: { verified?: string } }) {
  const verifiedOnly = searchParams?.verified === '1';
  const list = await api.listTokens(200, verifiedOnly).catch(() => ({ items: [] as any[] }));
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tokens</h1>
          <p className="mt-1 text-sm text-ink-400">Tokens with at least one active liquidity pool on EnergySwap.</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
          <Link
            href="/tokens"
            className={`rounded-full px-3 py-1.5 ${!verifiedOnly ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
          >All</Link>
          <Link
            href="/tokens?verified=1"
            className={`rounded-full px-3 py-1.5 ${verifiedOnly ? 'bg-bull/15 text-bull-300' : 'text-ink-400 hover:text-ink-100'}`}
          >Verified only</Link>
        </div>
      </header>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400">
            <tr className="bg-white/[0.02]">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Token</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Volume 24h</th>
              <th className="px-4 py-3 text-right">Tags</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((t: any, i: number) => (
              <tr key={t.address} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-xs text-ink-400">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link href={`/tokens/${t.address}`} className="flex items-center gap-2 font-medium hover:text-energy-400">
                    <TokenAvatar address={t.address} symbol={t.symbol} logoUrl={t.logo_url} size={24} />
                    <span>{displaySymbol(t.symbol) || shortAddr(t.address)}</span>
                  </Link>
                  <div className="ml-8 text-xs text-ink-400">{t.symbol?.toUpperCase() === 'WECY' ? 'EnergyChain (native)' : t.name}</div>
                </td>
                <td className="px-4 py-3 mono text-xs text-ink-300">{shortAddr(t.address, 6)}</td>
                <td className="px-4 py-3 text-right">{Number(t.price_usd) > 0 ? fmtUSD(t.price_usd, { precision: 6 }) : '—'}</td>
                <td className="px-4 py-3 text-right">{fmtUSD(t.volume_usd_24h)}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  {t.wrapped_native && <span className="chip">Native</span>}
                  {t.stablecoin && <span className="chip">Stable</span>}
                  {t.trust_score >= 2 && <span className="chip border-bull/20 bg-bull/10 text-bull-400">Verified</span>}
                  {t.trust_score === 1 && <span className="chip border-amber-400/20 bg-amber-400/5 text-amber-300">Auto</span>}
                </td>
              </tr>
            ))}
            {list.items.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-ink-400">No tokens indexed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
