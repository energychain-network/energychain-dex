import Link from 'next/link';
import { api } from '@/lib/api';
import { displaySymbol, fmtUSD, shortAddr } from '@/lib/format';

export const revalidate = 15;

export default async function TokenDetail({ params }: { params: { address: string } }) {
  const addr = params.address.toLowerCase();
  const [token, pairsAll] = await Promise.all([
    api.getToken(addr).catch(() => null),
    api.listPairs('tvl', 200).catch(() => ({ items: [] as any[] })),
  ]);
  if (!token) return <div className="card p-8 text-center text-ink-400">Token not found.</div>;

  const pairs = pairsAll.items.filter(
    (p: any) => p.token0.toLowerCase() === addr || p.token1.toLowerCase() === addr,
  );
  const tvl = pairs.reduce((acc: number, p: any) => acc + Number(p.tvl_usd || 0), 0);
  const vol = pairs.reduce((acc: number, p: any) => acc + Number(p.volume_usd_24h || 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{displaySymbol(token.symbol) || shortAddr(token.address)}</h1>
            {token.wrapped_native && <span className="chip">Native gas token</span>}
            {token.stablecoin && <span className="chip">Stablecoin</span>}
            <span className="chip mono">{shortAddr(token.address, 6)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-400">
            {token.wrapped_native
              ? `EnergyChain native gas token (wrapped as ${token.symbol} for ERC-20 pools)`
              : token.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/swap?in=${token.address}`} className="btn-primary">Swap</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Price" value={Number(token.price_usd) > 0 ? fmtUSD(token.price_usd, { precision: 6 }) : '—'} />
        <Stat label="Pools" value={String(pairs.length)} />
        <Stat label="TVL across pools" value={fmtUSD(tvl)} />
        <Stat label="Volume 24h" value={fmtUSD(vol)} />
      </section>

      <section>
        <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-400">Pools containing {displaySymbol(token.symbol)}</h3>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400">
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3">Pair</th>
                <th className="px-4 py-3 text-right">TVL</th>
                <th className="px-4 py-3 text-right">Volume 24h</th>
                <th className="px-4 py-3 text-right">APR</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody>
              {pairs.map((p: any) => (
                <tr key={p.address} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    <Link href={`/pools/${p.address}`} className="hover:text-energy-400">
                      {displaySymbol(p.symbol0) || shortAddr(p.token0)} / {displaySymbol(p.symbol1) || shortAddr(p.token1)}
                    </Link>
                    <div className="mono text-xs text-ink-400">{shortAddr(p.address, 4)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{fmtUSD(p.tvl_usd)}</td>
                  <td className="px-4 py-3 text-right">{fmtUSD(p.volume_usd_24h)}</td>
                  <td className="px-4 py-3 text-right text-bull">{Number(p.apr_24h || 0).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/charts/${p.address}`} className="btn-ghost text-xs">Chart</Link>
                  </td>
                </tr>
              ))}
              {pairs.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-400">No pools yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
