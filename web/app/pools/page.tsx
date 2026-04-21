import Link from 'next/link';
import { api } from '@/lib/api';
import { PairsTable } from '@/components/pairs-table';

export const revalidate = 10;

export default async function PoolsPage({ searchParams }: { searchParams: { sort?: string } }) {
  const sort = (searchParams.sort as any) || 'tvl';
  const list = await api.listPairs(sort, 100).catch(() => ({ items: [] as any[] }));
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Liquidity pools</h1>
          <p className="mt-1 text-sm text-ink-400">Provide liquidity to earn 0.30% of every swap.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {[
            { id: 'tvl', label: 'TVL' },
            { id: 'volume', label: 'Volume' },
            { id: 'apr', label: 'APR' },
            { id: 'new', label: 'Newest' },
          ].map((s) => (
            <Link
              key={s.id}
              href={`/pools?sort=${s.id}`}
              className={`rounded-md px-2.5 py-1 ${sort === s.id ? 'bg-energy-500/15 text-energy-400' : 'text-ink-400 hover:text-ink-100 hover:bg-white/5'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </header>
      <PairsTable items={list.items} />
    </div>
  );
}
