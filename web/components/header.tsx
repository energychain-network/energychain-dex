'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import {
  CandlestickChart,
  Coins,
  Waves,
  Rocket,
  ArrowLeftRight,
  Zap,
  CirclePlus,
  Wallet,
  ChevronDown,
  Menu,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { energyChain } from '@/lib/chain';
import { shortAddr } from '@/lib/format';
import { GlobalSearch } from './global-search';
import { useWSStatus } from '@/lib/ws';
import { CosmosConnect } from './cosmos-connect';

// Native Cosmos modules are the primary surface; the legacy EVM Uniswap pages
// (Swap/Pools/Tokens/Charts/Farm) live under the "DEX (EVM)" group.
const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/trade', label: 'Trade', icon: CandlestickChart },
  { href: '/assets', label: 'Assets', icon: Coins },
  { href: '/mincast', label: 'Mincast', icon: Waves },
  { href: '/offerings', label: 'Offerings', icon: Rocket },
  { href: '/bridge', label: 'Bridge', icon: ArrowLeftRight },
  { href: '/energy', label: 'Energy', icon: Zap },
  { href: '/issue', label: 'Issue', icon: CirclePlus },
  { href: '/portfolio', label: 'Portfolio', icon: Wallet },
];

const NAV_EVM = [
  { href: '/swap', label: 'Swap' },
  { href: '/pools', label: 'Pools' },
  { href: '/tokens', label: 'Tokens' },
  { href: '/charts', label: 'Charts' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/farm', label: 'Farm' },
  { href: '/api-keys', label: 'API keys' },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1480px] items-center gap-3 px-3 py-3 sm:gap-6 sm:px-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-energy-400 to-energy-600 text-ink-950 font-black">
            ⚡
          </span>
          <span className="text-base font-semibold tracking-tight hidden xs:inline sm:inline">EnergyChain</span>
          <span className="chip ml-1 hidden md:inline-flex">RWA · DEX</span>
        </Link>
        <nav className="hidden lg:flex items-center gap-1">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                  active ? 'bg-white/10 text-ink-100' : 'text-ink-300 hover:text-ink-100 hover:bg-white/5'
                }`}
              >
                <Icon size={14} className={active ? 'text-energy-400' : 'text-ink-500'} />
                {n.label}
              </Link>
            );
          })}
          <EvmMenu pathname={pathname} />
        </nav>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          <div className="hidden md:block w-72 xl:w-96">
            <GlobalSearch />
          </div>
          <LivePill />
          <ChainPill />
          <CosmosConnect />
          <ConnectButton />
          <button
            className="lg:hidden btn-ghost px-2"
            aria-label="menu"
            aria-expanded={open}
            onClick={() => setOpen((s) => !s)}
          >
            <Menu size={18} />
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-white/5 bg-ink-950 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="px-4 pt-3 md:hidden">
            <GlobalSearch />
          </div>
          <div className="px-4 py-2">
            {NAV.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + '/');
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
                    active ? 'bg-white/10 text-ink-100' : 'text-ink-200 hover:bg-white/5'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-energy-400' : 'text-ink-500'} />
                  {n.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-white/5 pt-2 text-[11px] uppercase tracking-wide text-ink-500 px-3">DEX (EVM)</div>
            {NAV_EVM.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + '/');
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-3 py-2.5 text-sm ${
                    active ? 'bg-white/10 text-ink-100' : 'text-ink-200 hover:bg-white/5'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

function EvmMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = NAV_EVM.some((n) => pathname === n.href || pathname.startsWith(n.href + '/'));
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        onClick={() => setOpen((s) => !s)}
        onMouseEnter={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition ${
          active ? 'bg-white/10 text-ink-100' : 'text-ink-300 hover:text-ink-100 hover:bg-white/5'
        }`}
      >
        DEX (EVM) <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-44 card overflow-hidden z-40">
          {NAV_EVM.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-ink-200 hover:bg-white/5"
            >
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LivePill() {
  const { state, lastMessageAt } = useWSStatus();
  const live = state === 'open';
  const stale = live && lastMessageAt > 0 && Date.now() - lastMessageAt > 30_000;
  const label = !live ? (state === 'connecting' ? 'Connecting…' : 'Reconnecting…') : (stale ? 'Live · idle' : 'Live');
  const cls = !live
    ? 'bg-bear/15 text-bear-400 border-bear/20'
    : stale
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      : '';
  return (
    <span
      className={`chip hidden sm:inline-flex ${cls}`}
      title={live ? 'Real-time stream connected' : 'Real-time stream disconnected — reconnecting with backoff'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? (stale ? 'bg-amber-400' : 'bg-bull animate-pulseDot') : 'bg-bear'}`} />
      <span className="hidden md:inline">{label}</span>
    </span>
  );
}

function ChainPill() {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const ok = chainId === energyChain.id;
  return (
    <button
      className={`chip ${ok ? '' : 'bg-bear/15 text-bear-400 border-bear/20 hover:bg-bear/20'}`}
      onClick={() => !ok && switchChain({ chainId: energyChain.id })}
      title={ok ? `Connected to ${energyChain.name}` : `Switch to ${energyChain.name}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-bull animate-pulseDot' : 'bg-bear'}`} />
      <span className="hidden sm:inline">{ok ? energyChain.name : 'Wrong network'}</span>
      <span className="sm:hidden">{ok ? 'EC' : '!'}</span>
    </button>
  );
}

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="relative">
        <button className="btn-outline" onClick={() => setOpen((s) => !s)}>
          <span className="mono text-xs">{shortAddr(address, 4)}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-44 card overflow-hidden">
            <button
              onClick={() => { setOpen(false); disconnect(); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <button className="btn-primary" onClick={() => setOpen((s) => !s)}>
        Connect Wallet
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 card overflow-hidden">
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => { setOpen(false); connect({ connector: c }); }}
              disabled={isPending}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <span>{c.name}</span>
              <span className="text-xs text-ink-400">{c.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
