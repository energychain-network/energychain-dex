'use client';

import { useEffect, useRef, useState } from 'react';

const WS_URL = (typeof window === 'undefined' ? '' : (process.env.NEXT_PUBLIC_DEX_WS || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`));

type Frame = { channel: string; data: any };

// Connection lifecycle observers can register here to surface "live"/"reconnecting"
// banners and to drive REST catch-up. Each callback receives the new state and
// the time of the last successful message so consumers can decide whether they
// need to refetch baseline data.
type ConnState = 'connecting' | 'open' | 'closed';
type ConnObserver = (state: ConnState, lastMessageAt: number) => void;

// useWS subscribes to one or more pub/sub channels and surfaces the most
// recent payload for each. The connection auto-reconnects with capped
// exponential backoff (with jitter), pings the server periodically to detect
// broken NAT idles, and is shared across components in the same tree because
// we keep one global WebSocket instance keyed by URL.
const sockets = new Map<string, GlobalSocket>();

class GlobalSocket {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<(d: any) => void>>();
  private wantedChannels = new Set<string>();
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private idleWatchdog: ReturnType<typeof setInterval> | null = null;
  private observers = new Set<ConnObserver>();
  state: ConnState = 'connecting';
  lastMessageAt = 0;

  constructor(private url: string) {
    this.connect();
    if (typeof window !== 'undefined') {
      // When the tab comes back from background, browsers throttle/kill our
      // socket; force a check so we recover quickly without waiting for the
      // next backoff tick.
      window.addEventListener('online', () => this.kick());
      document.addEventListener?.('visibilitychange', () => {
        if (!document.hidden) this.kick();
      });
    }
  }

  private setState(next: ConnState) {
    if (this.state === next) return;
    this.state = next;
    this.observers.forEach((cb) => cb(this.state, this.lastMessageAt));
  }

  private kick() {
    if (this.state !== 'open') {
      this.retry = 0; // bypass backoff when the user clearly wants traffic
      this.connect();
    }
  }

  private connect() {
    this.setState('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.lastMessageAt = Date.now();
      this.setState('open');
      if (this.wantedChannels.size > 0) {
        this.ws?.send(JSON.stringify({ op: 'sub', ch: Array.from(this.wantedChannels) }));
      }
      // Send a lightweight ping every 25s so corporate NATs don't silently
      // drop the connection. The server can ignore the message; we only care
      // that the OS keeps the socket alive.
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === 1) {
          try { this.ws.send(JSON.stringify({ op: 'ping', t: Date.now() })); } catch {}
        }
      }, 25_000);
      // If we haven't seen a server message in 60s the connection is almost
      // certainly half-open; tear it down so onclose triggers reconnect.
      this.idleWatchdog = setInterval(() => {
        if (Date.now() - this.lastMessageAt > 60_000) {
          try { this.ws?.close(); } catch {}
        }
      }, 15_000);
    };
    this.ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      try {
        const f: Frame = JSON.parse(ev.data);
        const set = this.subs.get(f.channel);
        if (set) set.forEach((cb) => cb(f.data));
      } catch {}
    };
    this.ws.onclose = () => {
      this.clearTimers();
      this.setState('closed');
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private clearTimers() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.idleWatchdog) { clearInterval(this.idleWatchdog); this.idleWatchdog = null; }
  }

  private scheduleReconnect() {
    // Capped exponential backoff with ±20% jitter to avoid thundering herd
    // against the API gateway when many tabs reconnect in lockstep.
    const base = Math.min(15_000, 500 * 2 ** this.retry++);
    const jitter = base * (0.8 + Math.random() * 0.4);
    setTimeout(() => this.connect(), jitter);
  }

  subscribe(channel: string, cb: (d: any) => void): () => void {
    if (!this.subs.has(channel)) {
      this.subs.set(channel, new Set());
      this.wantedChannels.add(channel);
      this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ op: 'sub', ch: [channel] }));
    }
    this.subs.get(channel)!.add(cb);
    return () => {
      const set = this.subs.get(channel);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) {
        this.subs.delete(channel);
        this.wantedChannels.delete(channel);
        this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ op: 'unsub', ch: [channel] }));
      }
    };
  }

  observe(cb: ConnObserver): () => void {
    this.observers.add(cb);
    cb(this.state, this.lastMessageAt);
    return () => { this.observers.delete(cb); };
  }
}

function getSocket(): GlobalSocket | null {
  if (typeof window === 'undefined') return null;
  let sock = sockets.get(WS_URL);
  if (!sock) {
    sock = new GlobalSocket(WS_URL);
    sockets.set(WS_URL, sock);
  }
  return sock;
}

export function useChannel<T = any>(channel: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    return s.subscribe(channel, (d) => setData(d));
  }, [channel]);
  return data;
}

export function useChannelStream<T = any>(channel: string, max = 50): T[] {
  const [items, setItems] = useState<T[]>([]);
  const ref = useRef<T[]>([]);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    return s.subscribe(channel, (d: T) => {
      ref.current = [d, ...ref.current].slice(0, max);
      setItems(ref.current);
    });
  }, [channel, max]);
  return items;
}

// Public hook for surfacing connection status. UI components use this to draw
// the "Live"/"Reconnecting…" pill and to trigger one-shot REST refetches when
// we reconnect after a long gap (more than a few seconds, suggesting we
// missed real-time updates).
export interface WSStatus {
  state: ConnState;
  lastMessageAt: number;
  reconnectedAt: number | null;
}

export function useWSStatus(): WSStatus {
  const [status, setStatus] = useState<WSStatus>({ state: 'connecting', lastMessageAt: 0, reconnectedAt: null });
  const lastClosed = useRef<number>(0);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    return s.observe((state, lastMessageAt) => {
      setStatus((prev) => {
        let reconnectedAt = prev.reconnectedAt;
        if (state === 'open' && prev.state !== 'open' && lastClosed.current > 0) {
          reconnectedAt = Date.now();
        }
        if (state !== 'open') lastClosed.current = Date.now();
        return { state, lastMessageAt, reconnectedAt };
      });
    });
  }, []);
  return status;
}
