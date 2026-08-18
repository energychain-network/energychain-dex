'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { api, type ApiKeyRow } from '@/lib/api';
import { shortAddr } from '@/lib/format';
import { energyChain } from '@/lib/chain';

// Self-service API keys.
//
// All mutating actions require the user to sign an EIP-191 message that the
// server then verifies (see dex/api/internal/handlers/apikeys.go). We never
// store the private key or the signature; instead we cache an unexpired
// signature in component state for the duration of the page so the user
// only sees one wallet popup per "session".

type CachedAuth = {
  owner: `0x${string}`;
  message: string;
  signature: `0x${string}`;
  expiresAt: number;
};

export default function APIKeysPage() {
  const { address, isConnected } = useAccount();
  const { data: wc } = useWalletClient({ chainId: energyChain.id });

  const [auth, setAuth] = useState<CachedAuth | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ key: string; hash: string; label: string } | null>(null);
  const [label, setLabel] = useState('');

  const lowerAddr = address?.toLowerCase() as `0x${string}` | undefined;

  // Drop the cached signature whenever we change wallet/account so we never
  // accidentally act on behalf of a previously-connected address.
  useEffect(() => {
    setAuth(null); setKeys(null); setIssued(null); setErr(null);
  }, [lowerAddr]);

  const ensureAuth = useCallback(async (): Promise<CachedAuth> => {
    if (auth && auth.owner === lowerAddr && Date.now() / 1000 < auth.expiresAt - 30) {
      return auth;
    }
    if (!wc || !lowerAddr) throw new Error('Wallet not connected');
    const ch = await api.apiKeys.challenge(lowerAddr);
    const signature = await wc.signMessage({ account: lowerAddr, message: ch.message });
    const next: CachedAuth = { owner: lowerAddr, message: ch.message, signature, expiresAt: ch.expires_at };
    setAuth(next);
    return next;
  }, [auth, wc, lowerAddr]);

  async function refresh() {
    if (!lowerAddr) return;
    setLoading(true); setErr(null);
    try {
      const a = await ensureAuth();
      const r = await api.apiKeys.list({ owner: a.owner, message: a.message, signature: a.signature });
      setKeys(r.items);
    } catch (e: any) {
      setErr(humanError(e));
    } finally {
      setLoading(false);
    }
  }

  async function issue() {
    if (!lowerAddr) return;
    setBusy('issue'); setErr(null); setIssued(null);
    try {
      const a = await ensureAuth();
      const r = await api.apiKeys.issue({
        owner: a.owner, message: a.message, signature: a.signature,
        label: label.trim() || undefined,
      });
      setIssued({ key: r.key, hash: r.key_hash, label: r.label });
      setLabel('');
      await refresh();
    } catch (e: any) {
      setErr(humanError(e));
    } finally {
      setBusy('');
    }
  }

  async function revoke(hash: string) {
    if (!lowerAddr) return;
    if (!confirm(`Revoke key ${hash.slice(0, 10)}…? This cannot be undone.`)) return;
    setBusy(hash); setErr(null);
    try {
      const a = await ensureAuth();
      await api.apiKeys.revoke({ owner: a.owner, message: a.message, signature: a.signature, key_hash: hash });
      await refresh();
    } catch (e: any) {
      setErr(humanError(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Issue keys for higher rate limits or partner integrations. Each action requires a wallet
          signature so the server can prove the request came from the owning address — no email or
          password needed.
        </p>
      </header>

      {!isConnected && (
        <div className="card p-8 text-center text-ink-300">Connect a wallet to manage API keys for that address.</div>
      )}

      {isConnected && (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Your keys</h2>
              <button onClick={refresh} disabled={loading} className="btn-ghost text-xs">
                {loading ? 'Loading…' : keys ? 'Refresh' : 'Sign in & load'}
              </button>
            </div>

            {err && <Notice tone="err">{err}</Notice>}

            {keys === null && !loading && !err && (
              <p className="text-sm text-ink-400">
                Click <span className="text-ink-200">Sign in &amp; load</span> – your wallet will prompt for one signature
                that we use for any actions in this tab.
              </p>
            )}

            {keys && keys.length === 0 && (
              <p className="text-sm text-ink-400">No keys yet. Issue one with the form on the right.</p>
            )}

            {keys && keys.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="py-2 pr-2">Label</th>
                      <th className="py-2 pr-2">Tier</th>
                      <th className="py-2 pr-2">Rate</th>
                      <th className="py-2 pr-2">Hash</th>
                      <th className="py-2 pr-2">Created</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.key_hash} className="border-t border-white/5">
                        <td className="py-2 pr-2">{k.label}</td>
                        <td className="py-2 pr-2"><span className="chip">{k.tier}</span></td>
                        <td className="py-2 pr-2 mono text-xs">{k.rate_per_min}/min</td>
                        <td className="py-2 pr-2 mono text-xs text-ink-300">{k.key_hash.slice(0, 10)}…</td>
                        <td className="py-2 pr-2 text-xs text-ink-300">{fmtTs(k.created_at)}</td>
                        <td className="py-2 pr-2">
                          {k.enabled
                            ? <span className="chip bg-bull/15 text-bull-300 border-bull/20">active</span>
                            : <span className="chip bg-bear/15 text-bear-400 border-bear/20">revoked</span>}
                        </td>
                        <td className="py-2">
                          {k.enabled && (
                            <button
                              onClick={() => revoke(k.key_hash)}
                              disabled={busy === k.key_hash}
                              className="text-xs text-bear-400 hover:text-bear-300"
                            >
                              {busy === k.key_hash ? 'Revoking…' : 'Revoke'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="card p-5 space-y-3">
              <h2 className="text-sm font-medium">Issue a new key</h2>
              <p className="text-xs text-ink-400">
                Owner: <span className="mono">{address && shortAddr(address, 6)}</span>
              </p>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. mobile-app)"
                className="input w-full"
              />
              <button onClick={issue} disabled={busy === 'issue'} className="btn-primary w-full">
                {busy === 'issue' ? 'Signing & issuing…' : 'Issue key'}
              </button>
              <p className="text-[11px] text-ink-500">
                You will see a wallet popup the first time. The cached signature stays valid until
                the challenge expires (~5 minutes).
              </p>
            </section>

            {issued && (
              <section className="card border border-bull/40 bg-bull/5 p-5 space-y-2">
                <h3 className="text-sm font-semibold text-bull-300">Save this key now</h3>
                <p className="text-xs text-ink-300">
                  This is the only time we&apos;ll show the raw key. Store it in a secret manager.
                  Use <span className="mono">X-API-Key</span> request header.
                </p>
                <code className="block break-all rounded-lg bg-ink-950/60 p-3 mono text-xs text-bull-200">
                  {issued.key}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(issued.key)}
                  className="btn-outline w-full text-xs"
                >Copy to clipboard</button>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'err' | 'ok' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'err' ? 'border-bear/30 bg-bear/10 text-bear-300'
    : tone === 'ok' ? 'border-bull/30 bg-bull/10 text-bull-300'
    : 'border-white/10 bg-white/[0.03] text-ink-300';
  return <div className={`rounded-xl border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

function fmtTs(s: number): string {
  if (!s) return '—';
  return new Date(s * 1000).toLocaleString();
}

function humanError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('User rejected') || msg.includes('rejected the request')) {
    return 'Signature was rejected in the wallet.';
  }
  return msg;
}
