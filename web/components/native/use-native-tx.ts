'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EncodeObject } from '@cosmjs/proto-signing';
import { useCosmos } from '@/lib/cosmos-wallet';

export interface TxState {
  pending: boolean;
  error: string | null;
  txhash: string | null;
}

// useNativeTx wraps Keplr signing with shared pending/error state and a
// react-query cache invalidation on success so views refresh after a write.
export function useNativeTx() {
  const { sign, address } = useCosmos();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ pending: false, error: null, txhash: null });

  const run = useCallback(async (messages: EncodeObject[], memo = ''): Promise<boolean> => {
    setState({ pending: true, error: null, txhash: null });
    try {
      const res = await sign(messages, memo);
      setState({ pending: false, error: null, txhash: res.transactionHash });
      // Give the indexer a moment to ingest the block, then refresh.
      setTimeout(() => qc.invalidateQueries(), 1200);
      return true;
    } catch (e: any) {
      setState({ pending: false, error: e?.message || String(e), txhash: null });
      return false;
    }
  }, [sign, qc]);

  const reset = useCallback(() => setState({ pending: false, error: null, txhash: null }), []);

  return { ...state, run, reset, address };
}
