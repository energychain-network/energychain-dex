'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getAddress, isAddress } from 'viem';

// Recent recipient address book.
//
// We keep a per-browser list of addresses the user has successfully sent to,
// scoped by the user's *own* wallet address so two people sharing a device
// never see each other's contacts. Storage is localStorage via zustand
// persist, capped to MAX_ENTRIES per owner.
//
// Why client-side only: introducing a server-side address book would require
// handling personally-identifiable data and another auth flow. For a wallet
// shortcut feature, localStorage is the right trade-off: the data is already
// reproducible from the user's transaction history if they ever clear it.

const MAX_ENTRIES = 12;

export interface AddressEntry {
  address: `0x${string}`;     // EIP-55 checksummed
  label?: string;
  lastUsed: number;            // unix seconds
  usedCount: number;
}

interface AddressBookState {
  // map from owner address (lowercase) → entries
  byOwner: Record<string, AddressEntry[]>;
  recordSend: (owner: string, recipient: string, label?: string) => void;
  setLabel: (owner: string, recipient: string, label: string) => void;
  remove: (owner: string, recipient: string) => void;
  list: (owner: string) => AddressEntry[];
}

function normaliseOwner(owner: string): string {
  return owner.toLowerCase();
}

function tryChecksum(addr: string): `0x${string}` | null {
  try {
    if (!isAddress(addr)) return null;
    return getAddress(addr) as `0x${string}`;
  } catch {
    return null;
  }
}

export const useAddressBook = create<AddressBookState>()(
  persist(
    (set, get) => ({
      byOwner: {},
      recordSend: (owner, recipient, label) => {
        const checksum = tryChecksum(recipient);
        if (!checksum) return;
        const ownerKey = normaliseOwner(owner);
        const now = Math.floor(Date.now() / 1000);
        const existing = get().byOwner[ownerKey] ?? [];
        const idx = existing.findIndex((e) => e.address.toLowerCase() === checksum.toLowerCase());
        let next: AddressEntry[];
        if (idx >= 0) {
          const prev = existing[idx];
          next = [
            { ...prev, lastUsed: now, usedCount: prev.usedCount + 1, label: label ?? prev.label },
            ...existing.filter((_, i) => i !== idx),
          ];
        } else {
          next = [{ address: checksum, label, lastUsed: now, usedCount: 1 }, ...existing];
        }
        set({ byOwner: { ...get().byOwner, [ownerKey]: next.slice(0, MAX_ENTRIES) } });
      },
      setLabel: (owner, recipient, label) => {
        const ownerKey = normaliseOwner(owner);
        const list = get().byOwner[ownerKey] ?? [];
        const next = list.map((e) =>
          e.address.toLowerCase() === recipient.toLowerCase() ? { ...e, label } : e,
        );
        set({ byOwner: { ...get().byOwner, [ownerKey]: next } });
      },
      remove: (owner, recipient) => {
        const ownerKey = normaliseOwner(owner);
        const list = get().byOwner[ownerKey] ?? [];
        const next = list.filter((e) => e.address.toLowerCase() !== recipient.toLowerCase());
        set({ byOwner: { ...get().byOwner, [ownerKey]: next } });
      },
      list: (owner) => get().byOwner[normaliseOwner(owner)] ?? [],
    }),
    {
      name: 'energyswap.address-book.v1',
      storage: createJSONStorage(() => (typeof window === 'undefined' ? noopStorage : localStorage)),
      // Only persist the by-owner map; functions are recreated on hydration.
      partialize: (state) => ({ byOwner: state.byOwner }),
    },
  ),
);

// SSR-safe storage stub. zustand's persist middleware only needs get/set/remove
// at runtime; the cast through `unknown` avoids importing the full Storage type
// and lets us keep the SSR fallback dead-simple.
const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  length: 0,
  clear: () => {},
  key: () => null,
} as unknown as Storage;
