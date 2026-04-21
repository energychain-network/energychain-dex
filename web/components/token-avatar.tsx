'use client';

import { useState, useMemo } from 'react';
import { displaySymbol } from '@/lib/format';

// TokenAvatar renders a token icon with the following fallback chain:
//   1. logoUrl from the indexer (CDN-served PNG keyed on contract address)
//   2. a deterministic gradient circle stamped with the symbol's first letter
// This keeps the UI usable from day one and lets ops drop in real logos
// without a frontend deploy by configuring DEX_LOGO_BASE_URL on the indexer.
export function TokenAvatar({
  address,
  symbol,
  logoUrl,
  size = 28,
}: {
  address?: string;
  symbol?: string;
  logoUrl?: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const sym = displaySymbol(symbol || '') || '?';
  const seed = (address || sym).toLowerCase();
  const gradient = useMemo(() => gradientFromSeed(seed), [seed]);
  const showFallback = !logoUrl || errored;
  const dim = { width: size, height: size, minWidth: size };

  if (showFallback) {
    return (
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white shadow-inner ring-1 ring-white/10"
        style={{ ...dim, background: gradient, fontSize: Math.max(10, size * 0.4) }}
        aria-label={`Token ${sym}`}
      >
        {sym.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={sym}
      style={dim}
      className="rounded-full bg-white/5 ring-1 ring-white/10"
      onError={() => setErrored(true)}
    />
  );
}

function gradientFromSeed(seed: string): string {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 * 31 + seed.charCodeAt(i)) >>> 0;
    h2 = (h2 * 17 + seed.charCodeAt(seed.length - 1 - i)) >>> 0;
  }
  const hue1 = h1 % 360;
  const hue2 = (h2 % 360 + 120) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 65%, 45%), hsl(${hue2}, 65%, 35%))`;
}
