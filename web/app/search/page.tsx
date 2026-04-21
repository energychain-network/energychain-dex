import Link from 'next/link';
import { api } from '@/lib/api';
import { shortAddr } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q || '').trim();
  const results = q.length >= 2 ? await api.search(q).catch(() => ({ items: [] as any[] })) : { items: [] };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Search results</h1>
        <p className="mt-1 text-sm text-ink-400">Query: <span className="mono">{q || '—'}</span></p>
      </header>

      <div className="card divide-y divide-white/5">
        {results.items.length === 0 && (
          <div className="px-4 py-12 text-center text-ink-400">
            {q ? `No matches for “${q}”.` : 'Start typing in the header search to find tokens, pairs or transactions.'}
          </div>
        )}
        {results.items.map((h: any) => {
          const href = h.kind === 'pair' ? `/pools/${h.id}` : h.kind === 'token' ? `/tokens/${h.id}` : `/charts/${h.id}`;
          return (
            <Link key={`${h.kind}-${h.id}`} href={href} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-white/5">
              <div className="min-w-0">
                <div className="truncate font-medium">{h.title}</div>
                <div className="truncate text-xs text-ink-400">{h.subtitle}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="chip uppercase">{h.kind}</span>
                <span className="mono text-ink-400">{shortAddr(h.id, 6)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
