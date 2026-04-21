// Numeric / address formatting helpers. These intentionally take string inputs
// from the API so we never accidentally coerce a 78-digit big int through
// JS Number.

export function shortAddr(a: string, n = 4): string {
  if (!a) return '';
  if (a.length <= 2 + n * 2) return a;
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function fmtUSD(v: string | number | undefined, opts: { compact?: boolean; precision?: number } = {}): string {
  if (v === undefined || v === null || v === '') return '$0';
  const n = typeof v === 'number' ? v : Number(String(v).split('.')[0] + '.' + (String(v).split('.')[1] || '00').slice(0, 4));
  if (!isFinite(n)) return '$0';
  const compact = opts.compact ?? n >= 10_000;
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.precision ?? (compact ? 2 : n < 1 ? 4 : 2),
    minimumFractionDigits: opts.precision ?? (compact ? 2 : 0),
  });
  return fmt.format(n);
}

export function fmtNum(v: string | number | undefined, max = 6): string {
  if (v === undefined || v === null || v === '') return '0';
  const n = Number(typeof v === 'string' ? v : v.toString());
  if (!isFinite(n)) return '0';
  if (n === 0) return '0';
  if (n > 1_000_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
  if (n >= 1) return new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n);
  return n.toPrecision(4);
}

// Convert a raw uint256-string with `decimals` to a human number (string).
export function fromBaseUnits(raw: string | bigint, decimals: number, frac = 6): string {
  const s = typeof raw === 'bigint' ? raw.toString() : (raw || '0');
  const neg = s.startsWith('-');
  const x = neg ? s.slice(1) : s;
  const padded = x.padStart(decimals + 1, '0');
  const ip = padded.slice(0, padded.length - decimals);
  const fp = padded.slice(padded.length - decimals).slice(0, frac).replace(/0+$/, '');
  return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
}

// Inverse of fromBaseUnits.
export function toBaseUnits(input: string, decimals: number): bigint {
  const t = (input || '0').trim();
  if (!t) return 0n;
  const [ip, fp = ''] = t.split('.');
  const f = (fp + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((ip || '0') + f);
}

// EnergyChain has a wrapped-native token (WECY) and a true native (ECY).
// All on-chain pools quote against WECY because ERC-20 pools cannot hold the
// native token directly; users, however, only ever think of "ECY". We hide
// the wrapping by aliasing every WECY symbol to ECY at render time. The
// underlying contract address still goes through unchanged so wallet/contract
// calls keep working.
//
// This is the same trick Uniswap uses to display ETH everywhere instead of
// WETH. If we ever ship a deliberate "WECY" UI (e.g. an unwrap helper) call
// the raw symbol from the API directly and bypass this helper.
export function displaySymbol(sym: string | undefined | null): string {
  if (!sym) return '';
  return sym.toUpperCase() === 'WECY' ? 'ECY' : sym;
}

export function displayPair(sym0?: string, sym1?: string): string {
  return `${displaySymbol(sym0)}/${displaySymbol(sym1)}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
