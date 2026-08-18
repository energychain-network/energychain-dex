'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { EncodeObject } from '@cosmjs/proto-signing';
import type { DeliverTxResponse } from '@cosmjs/stargate';
import { connect as kConnect, signAndBroadcast as kSign, submitGovProposal as kSubmitGov, type CosmosSession } from './cosmos';

interface CosmosCtx {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sign: (messages: EncodeObject[], memo?: string) => Promise<DeliverTxResponse>;
  submitGov: (title: string, summary: string, inner: EncodeObject[], depositAmount?: string) => Promise<DeliverTxResponse>;
}

const Ctx = createContext<CosmosCtx | null>(null);

const LS_KEY = 'ec_cosmos_connected';

export function CosmosWalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CosmosSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const s = await kConnect();
      setSession(s);
      try { localStorage.setItem(LS_KEY, '1'); } catch {}
    } catch (e: any) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    try { localStorage.removeItem(LS_KEY); } catch {}
  }, []);

  // Auto-reconnect if the user connected before (Keplr keeps the approval).
  useEffect(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem(LS_KEY) === '1') {
        kConnect().then((s) => { if (!cancelled) setSession(s); }).catch(() => {});
      }
    } catch {}
    // Re-connect on Keplr account change.
    const onChange = () => { kConnect().then(setSession).catch(() => {}); };
    if (typeof window !== 'undefined') window.addEventListener('keplr_keystorechange', onChange);
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') window.removeEventListener('keplr_keystorechange', onChange);
    };
  }, []);

  const sign = useCallback(async (messages: EncodeObject[], memo = '') => {
    if (!session) throw new Error('请先连接 Cosmos 钱包');
    return kSign(session, messages, memo);
  }, [session]);

  const submitGov = useCallback(async (title: string, summary: string, inner: EncodeObject[], depositAmount?: string) => {
    const s = session ?? await kConnect();
    if (!session) setSession(s);
    return kSubmitGov(s, title, summary, inner, depositAmount);
  }, [session]);

  const value = useMemo<CosmosCtx>(() => ({
    address: session?.address ?? null,
    connecting,
    error,
    connect,
    disconnect,
    sign,
    submitGov,
  }), [session, connecting, error, connect, disconnect, sign, submitGov]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCosmos(): CosmosCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCosmos must be used within CosmosWalletProvider');
  return c;
}
