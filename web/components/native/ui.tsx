'use client';

import { ReactNode } from 'react';
import { useCosmos } from '@/lib/cosmos-wallet';
import { statusBadge, toneClass } from '@/lib/native-format';
import type { TxState } from './use-native-tx';

const TONE_DOT: Record<string, string> = {
  ok: 'bg-bull-400',
  warn: 'bg-amber-300',
  bad: 'bg-bear-400',
  muted: 'bg-ink-400',
};

export function StatusChip({ status }: { status?: string }) {
  const { label, tone } = statusBadge(status);
  return (
    <span className={`chip ${toneClass(tone)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}

export function Field({
  label, value, onChange, placeholder, type = 'text', hint, right,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-400">{label}</span>
        {right}
      </div>
      <input
        className={`w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-energy-500/50${
          type === 'datetime-local' || type === 'date' || type === 'time' ? ' [color-scheme:dark]' : ''
        }`}
        value={value}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}

export function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-ink-400">{label}</span>
      <select
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-energy-500/50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-950">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// SubmitButton gates on wallet connection and reflects tx pending state.
export function SubmitButton({
  tx, label, onClick, disabled, variant = 'primary',
}: {
  tx: TxState;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'bull' | 'bear';
}) {
  const { address, connect, connecting } = useCosmos();
  if (!address) {
    return (
      <button className="btn-primary w-full" disabled={connecting} onClick={() => connect().catch(() => {})}>
        {connecting ? '连接中…' : '连接 Keplr 钱包'}
      </button>
    );
  }
  const cls = variant === 'bull' ? 'bg-bull text-ink-950 hover:bg-bull/90'
    : variant === 'bear' ? 'bg-bear text-white hover:bg-bear/90'
    : 'btn-primary';
  return (
    <button
      className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${cls}`}
      disabled={tx.pending || disabled}
      onClick={onClick}
    >
      {tx.pending ? '提交中…' : label}
    </button>
  );
}

export function TxResult({ tx }: { tx: TxState }) {
  if (tx.error) {
    return <div className="rounded-lg border border-bear/20 bg-bear/10 px-3 py-2 text-xs text-bear-300 break-all">{tx.error}</div>;
  }
  if (tx.txhash) {
    return (
      <div className="rounded-lg border border-bull/20 bg-bull/10 px-3 py-2 text-xs text-bull-300 break-all">
        交易成功 · <span className="mono">{tx.txhash}</span>
      </div>
    );
  }
  return null;
}

export function ConnectGate({ children }: { children: ReactNode }) {
  const { address, connect, connecting } = useCosmos();
  if (address) return <>{children}</>;
  return (
    <div className="card p-6 text-center space-y-3">
      <p className="text-sm text-ink-300">连接 Cosmos 钱包 (Keplr / Leap) 以继续</p>
      <button className="btn-primary" disabled={connecting} onClick={() => connect().catch(() => {})}>
        {connecting ? '连接中…' : '连接钱包'}
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card p-12 text-center text-sm text-ink-400">{children}</div>;
}

export function SectionTabs({
  tabs, active,
}: {
  tabs: { href: string; label: string }[];
  active: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
      {tabs.map((t) => (
        <a
          key={t.href}
          href={t.href}
          className={`rounded-full px-3 py-1.5 ${active === t.href ? 'bg-white/10 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
