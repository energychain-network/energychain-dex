// Display helpers specific to the native Cosmos entities: enum → label/colour
// mapping and amount formatting that respects per-asset decimals.

import { fromBaseUnits } from './format';

// amt renders a raw base-unit string with the asset's decimals.
export function amt(raw: string | undefined, decimals = 0, frac = 6): string {
  if (raw === undefined || raw === null || raw === '') return '0';
  if (decimals <= 0) return new Intl.NumberFormat('en-US').format(Number(raw));
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: frac }).format(
    Number(fromBaseUnits(raw, decimals, frac)),
  );
}

// price renders a price expressed in settlement base-units (e.g. a mincast
// floor price = settlement base-units per 1 whole unit). Pass the
// settlement denom's `decimals` to scale it into human settlement units;
// decimals=0 shows the raw integer (back-compat for FX markets whose price
// is already a plain ratio).
export function price(raw: string | undefined, decimals = 0): string {
  if (!raw) return '0';
  const n = decimals > 0 ? Number(raw) / 10 ** decimals : Number(raw);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n);
}

// scaleUp converts a human decimal string into a raw integer string by shifting
// the decimal point right by `exp` places (raw = human * 10^exp), using exact
// string math so large order prices/quantities never lose precision to float.
// Excess fractional digits beyond `exp` are truncated.
export function scaleUp(human: string, exp: number): string {
  const s = (human || '').trim();
  if (!s) return '0';
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intRaw = '0', fracRaw = ''] = body.split('.');
  const intPart = intRaw.replace(/[^0-9]/g, '') || '0';
  const frac = fracRaw.replace(/[^0-9]/g, '');
  let digits: string;
  if (exp >= 0) {
    digits = intPart + frac.slice(0, exp).padEnd(exp, '0');
  } else {
    // exp < 0: divide by 10^-exp (drop trailing integer digits). Rare.
    const drop = -exp;
    digits = intPart.length > drop ? intPart.slice(0, intPart.length - drop) : '0';
  }
  digits = digits.replace(/^0+(?=\d)/, '');
  return (neg && digits !== '0' ? '-' : '') + (digits || '0');
}

// scaleDownPlain converts a raw integer string into a plain human decimal
// string (no thousands separators) by shifting left `exp` places — suitable for
// pre-filling a number input (e.g. a "max" button).
export function scaleDownPlain(raw: string, exp: number): string {
  let s = (raw || '0').trim();
  if (!s) return '0';
  const neg = s.startsWith('-');
  s = (neg ? s.slice(1) : s).replace(/[^0-9]/g, '') || '0';
  if (exp <= 0) return (neg ? '-' : '') + s.replace(/^0+(?=\d)/, '');
  if (s.length <= exp) s = '0'.repeat(exp - s.length + 1) + s;
  const i = s.length - exp;
  const intPart = s.slice(0, i).replace(/^0+(?=\d)/, '');
  const frac = s.slice(i).replace(/0+$/, '');
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-bull/20 bg-bull/10 text-bull-400',
  warn: 'border-amber-400/20 bg-amber-400/5 text-amber-300',
  bad: 'border-bear/20 bg-bear/10 text-bear-400',
  muted: '',
};

// statusBadge maps a proto enum string to a short label + tone for chips.
export function statusBadge(status: string | undefined): { label: string; tone: Tone } {
  const s = (status || '').toUpperCase();
  const short = s.replace(/^[A-Z]+_STATUS_/, '').replace(/^STATUS_/, '');
  let tone: Tone = 'muted';
  if (/PENDING_BOND/.test(s)) tone = 'warn';
  else if (/ACTIVE|OPEN|SUCCEEDED|CLEARED|VERIFIED|EXECUTED|RELEASED/.test(s)) tone = 'ok';
  else if (/PENDING|PAUSED|SUSPENDED|MATURING/.test(s)) tone = 'warn';
  else if (/FROZEN|FAILED|CANCEL|REJECTED|JAILED|CLOSED|REFUNDED|EXPIRED|DELISTED/.test(s)) tone = 'bad';
  if (short === 'PENDING_BOND') return { label: '待缴押金', tone };
  if (short === 'DELISTED') return { label: '已退市', tone };
  return { label: short || s || 'UNKNOWN', tone };
}

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}

export function sideLabel(side: string | undefined): { label: string; buy: boolean } {
  const s = (side || '').toUpperCase();
  const buy = s.includes('BUY');
  return { label: buy ? '买入 Buy' : '卖出 Sell', buy };
}

// epoch formats a unix-second timestamp to a locale string (or em dash).
export function epoch(ts: number | undefined): string {
  if (!ts || ts <= 0) return '—';
  return new Date(ts * 1000).toLocaleString();
}
