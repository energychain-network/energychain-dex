'use client';

import { create } from 'zustand';

// A single user-initiated on-chain action. We keep the schema intentionally
// narrow so all UI flows (swap, add/remove liquidity, wallet send, approve)
// can dispatch the same shape and the toaster can render uniformly. The
// store is fully ephemeral – we never persist tx hashes across reloads
// because users could be on a different account or chain by then.
export type TxKind = 'approve' | 'swap' | 'add-liquidity' | 'remove-liquidity' | 'send' | 'other';
export type TxStatus = 'pending' | 'success' | 'error';

export interface TxToast {
  id: string;
  kind: TxKind;
  status: TxStatus;
  hash?: string;
  title: string;
  description?: string;
  chainId?: number;
  createdAt: number;
  updatedAt: number;
}

interface TxState {
  toasts: TxToast[];
  push: (t: Omit<TxToast, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
  update: (id: string, patch: Partial<Omit<TxToast, 'id' | 'createdAt'>>) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

let counter = 0;
function nextId() {
  counter += 1;
  return `tx-${Date.now().toString(36)}-${counter}`;
}

export const useTxStore = create<TxState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? nextId();
    const now = Date.now();
    set((s) => ({
      toasts: [...s.toasts, { ...t, id, createdAt: now, updatedAt: now }],
    }));
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearAll: () => set({ toasts: [] }),
}));

// Helper: drive a toast through pending → success/error around an arbitrary
// async transaction. Callers pass the title and a function that should
// return a tx hash + a "wait" promise (typically `pc.waitForTransactionReceipt`).
export async function trackTx<T>(opts: {
  kind: TxKind;
  title: string;
  description?: string;
  chainId?: number;
  run: () => Promise<{ hash: `0x${string}`; wait: Promise<T> }>;
}): Promise<T> {
  const id = useTxStore.getState().push({
    kind: opts.kind,
    status: 'pending',
    title: opts.title,
    description: opts.description ?? 'Submitting transaction…',
    chainId: opts.chainId,
  });
  try {
    const { hash, wait } = await opts.run();
    useTxStore.getState().update(id, { hash, description: 'Waiting for confirmation…' });
    const receipt = await wait;
    useTxStore.getState().update(id, { status: 'success', description: 'Confirmed' });
    return receipt;
  } catch (err: unknown) {
    const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
      || (err as { message?: string })?.message
      || 'Transaction failed';
    useTxStore.getState().update(id, { status: 'error', description: msg });
    throw err;
  }
}
