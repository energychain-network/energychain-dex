import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { statusBadge, toneClass } from '@/lib/native-format';

const TONE_DOT: Record<string, string> = {
  ok: 'bg-bull-400',
  warn: 'bg-amber-300',
  bad: 'bg-bear-400',
  muted: 'bg-ink-400',
};

// StatusPill: server-component-friendly status chip with a tone dot.
export function StatusPill({ status }: { status?: string }) {
  const { label, tone } = statusBadge(status);
  return (
    <span className={`chip ${toneClass(tone)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}

// PageHeader anchors every listing page: gradient icon plate + title +
// one-line description, with optional right-aligned actions (tabs/buttons).
// Server-component friendly (no hooks).
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3.5 min-w-0">
        <span className="icon-plate">
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-400 max-w-2xl">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

// EmptyBlock renders a friendly empty state (card body or standalone).
export function EmptyBlock({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-14 text-center ${className}`}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/5 bg-white/[0.03] text-ink-500">
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <div className="text-sm text-ink-300">{title}</div>
      {hint && <div className="text-xs text-ink-500 max-w-sm">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// EmptyRow is EmptyBlock wrapped for use inside a <tbody>.
export function EmptyRow({
  colSpan,
  icon,
  title,
  hint,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyBlock icon={icon} title={title} hint={hint} />
      </td>
    </tr>
  );
}

// AssetBadge renders a deterministic gradient avatar stamped with the
// asset symbol's first letters — same idea as the EVM TokenAvatar but
// server-component friendly for native (Cosmos) listings.
export function AssetBadge({ symbol, size = 34 }: { symbol: string; size?: number }) {
  const sym = (symbol || '?').replace(/^rwa\//, '');
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < sym.length; i++) {
    h1 = (h1 * 31 + sym.charCodeAt(i)) >>> 0;
    h2 = (h2 * 17 + sym.charCodeAt(sym.length - 1 - i)) >>> 0;
  }
  const hue1 = h1 % 360;
  const hue2 = ((h2 % 360) + 120) % 360;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-white/15 shadow-inner"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue1}, 62%, 46%), hsl(${hue2}, 62%, 34%))`,
        fontSize: Math.max(10, size * 0.36),
      }}
      aria-hidden
    >
      {sym.slice(0, 2).toUpperCase()}
    </span>
  );
}

// PairBadge overlaps two asset avatars for a market row (base / quote).
export function PairBadge({ base, quote, size = 30 }: { base: string; quote: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size * 1.62, height: size }}>
      <span className="absolute left-0 top-0 z-10"><AssetBadge symbol={base} size={size} /></span>
      <span className="absolute top-0" style={{ left: size * 0.62 }}><AssetBadge symbol={quote} size={size} /></span>
    </span>
  );
}
