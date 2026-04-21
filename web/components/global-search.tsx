'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { shortAddr } from '@/lib/format';

type Hit = { kind: 'token' | 'pair' | 'tx'; id: string; title: string; subtitle: string };

// Header global search. Debounces user input, talks to /search, and routes to
// the appropriate detail page on selection. Keyboard navigable (↑/↓/Enter/Esc).
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const tRef = useRef<any>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    if (!q || q.length < 2) { setHits([]); return; }
    tRef.current = setTimeout(async () => {
      try {
        setBusy(true);
        const res = await api.search(q);
        setHits((res.items || []) as Hit[]);
        setActive(0);
      } catch { setHits([]); }
      finally { setBusy(false); }
    }, 180);
  }, [q]);

  function go(h: Hit) {
    setOpen(false); setQ('');
    if (h.kind === 'pair') router.push(`/pools/${h.id}`);
    else if (h.kind === 'token') router.push(`/tokens/${h.id}`);
    else router.push(`/charts/${h.id}`);
  }

  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <div className="relative">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Search tokens, pairs or tx hash"
          className="input pl-8 pr-3 h-9 text-sm"
        />
      </div>
      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 mt-2 max-h-96 overflow-auto card divide-y divide-white/5 z-40">
          {busy && hits.length === 0 && (
            <div className="px-4 py-3 text-xs text-ink-400">Searching…</div>
          )}
          {!busy && hits.length === 0 && (
            <div className="px-4 py-3 text-xs text-ink-400">No matches.</div>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}`}
              onClick={() => go(h)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm transition ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{h.title}</div>
                <div className="truncate text-xs text-ink-400">{h.subtitle}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="chip uppercase">{h.kind}</span>
                <span className="mono text-ink-400">{shortAddr(h.id, 4)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
