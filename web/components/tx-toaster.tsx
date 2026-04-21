'use client';

import { useEffect } from 'react';
import { useTxStore, type TxStatus } from '@/lib/tx-store';

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_BASE || 'http://localhost:3000';

const STATUS_AUTODISMISS_MS: Record<TxStatus, number | null> = {
  pending: null, // never auto-dismiss while in flight
  success: 8000,
  error: 10000,
};

const ICON: Record<TxStatus, string> = {
  pending: '◐',
  success: '✓',
  error: '✕',
};

const RING: Record<TxStatus, string> = {
  pending: 'border-energy-500/40 bg-energy-500/10 text-energy-200',
  success: 'border-bull/40 bg-bull/10 text-bull-300',
  error: 'border-bear/40 bg-bear/10 text-bear-300',
};

export function TxToaster() {
  const toasts = useTxStore((s) => s.toasts);
  const dismiss = useTxStore((s) => s.dismiss);

  // Schedule auto-dismiss timers per terminal toast. We register a timer for
  // every success/error toast and clean up on re-render or store change to
  // avoid leaking timeouts on rapid sequences (e.g. approve→swap).
  useEffect(() => {
    const timers = toasts
      .map((t) => {
        const ms = STATUS_AUTODISMISS_MS[t.status];
        if (ms === null) return null;
        // Compute remaining time so a long-lived toast doesn't get re-extended
        // every render.
        const elapsed = Date.now() - t.updatedAt;
        const remaining = Math.max(0, ms - elapsed);
        return setTimeout(() => dismiss(t.id), remaining);
      })
      .filter((x): x is ReturnType<typeof setTimeout> => x !== null);
    return () => { timers.forEach(clearTimeout); };
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => {
        const explorerHref = t.hash ? `${EXPLORER}/tx/${t.hash}` : null;
        const short = t.hash ? `${t.hash.slice(0, 8)}…${t.hash.slice(-4)}` : null;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${RING[t.status]}`}
            role="status"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  t.status === 'pending' ? 'animate-spin' : ''
                }`}
                aria-hidden
              >
                {ICON[t.status]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-ink-100">{t.title}</p>
                  <button
                    onClick={() => dismiss(t.id)}
                    className="text-ink-500 hover:text-ink-200"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
                {t.description && (
                  <p className="mt-0.5 text-xs text-ink-300">{t.description}</p>
                )}
                {explorerHref && short && (
                  <a
                    href={explorerHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block font-mono text-[11px] text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline"
                  >
                    {short}
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
