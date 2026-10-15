import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_FN, acquireMessage, applyError, applyThrottleUpdate, backoffMs, disconnected, functionMessage,
  initialThrottleState, parseIncoming, pingIntervalMs, pingMessage, releaseMessage, releaseRequested,
  startAcquire, validWsUrl, type ThrottleState,
} from '../lib/jmriProtocol';

export type JmriStatus = 'unconfigured' | 'connecting' | 'connected' | 'error';

/** Delay before asking JMRI again after it released or refused our throttle. */
const REACQUIRE_MS = 5_000;

export interface JmriThrottle {
  /** State of the browser → JMRI JSON WebSocket. */
  status: JmriStatus;
  /** True once JMRI has confirmed a throttle for the current roster entry. */
  acquired: boolean;
  /** Function states as last reported by JMRI for this throttle (fn number → on). */
  functions: Record<number, boolean>;
  /** Sends F<fn>=on. Returns false and sends nothing unless acquired — commands are never queued. */
  setFunction: (fn: number, on: boolean) => boolean;
  error: string | null;
}

interface Held { name: string; rosterEntry: string }

/**
 * Browser-side JMRI throttle (docs/guard-panel-spec.md §7.1, protocol in
 * lib/jmriProtocol.ts).
 *
 * Connects to `wsUrl` (JMRI JSON server), pings per JMRI's hello heartbeat,
 * reconnects with backoff (1 s → 30 s). Acquires `rosterEntryName` under
 * `throttleName` once connected; releases on change, unmount and pagehide;
 * re-acquires after a reconnect. Nothing is ever queued: setFunction only
 * sends while the socket is open and JMRI has confirmed the throttle.
 *
 * Release on unmount is deferred one microtask so sibling hooks'
 * cleanups (useProfileActions.stopAll) can still send their "off"s first.
 */
export function useJmriThrottle(
  wsUrl: string | undefined,
  rosterEntryName: string | null,
  throttleName: string,
): JmriThrottle {
  const url = validWsUrl(wsUrl);
  const [status, setStatus] = useState<JmriStatus>(url ? 'connecting' : 'unconfigured');
  const [connError, setConnError] = useState<string | null>(null);
  const [ts, setTs] = useState<ThrottleState>(initialThrottleState);

  const tsRef = useRef(ts);
  const wsRef = useRef<WebSocket | null>(null);
  /** What we've asked JMRI to hold on the current socket. */
  const heldRef = useRef<Held | null>(null);
  /** What the caller wants held. */
  const wantRef = useRef<{ name: string; rosterEntry: string | null }>({ name: throttleName, rosterEntry: rosterEntryName });

  const update = useCallback((fn: (s: ThrottleState) => ThrottleState) => {
    const next = fn(tsRef.current);
    if (next === tsRef.current) return;
    tsRef.current = next;
    setTs(next);
  }, []);

  /** Brings JMRI in line with wantRef on the open socket (release old, acquire new). */
  const sync = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { name, rosterEntry } = wantRef.current;
    const want = rosterEntry ? { name, rosterEntry } : null;
    const held = heldRef.current;
    if (held && want && held.name === want.name && held.rosterEntry === want.rosterEntry) return;
    if (held) {
      ws.send(releaseMessage(held.name));
      heldRef.current = null;
      update(releaseRequested);
    }
    if (want) {
      ws.send(acquireMessage(want.name, want.rosterEntry));
      heldRef.current = want;
      update((s) => startAcquire(s, want.rosterEntry));
    }
  }, [update]);

  // ── Connection lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!url) {
      setStatus('unconfigured');
      setConnError(null);
      update(disconnected);
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pingMs = pingIntervalMs(null);
    let lastRx = 0;
    let reacquireTimer: ReturnType<typeof setTimeout> | null = null;

    const stopReacquire = () => { if (reacquireTimer) clearTimeout(reacquireTimer); reacquireTimer = null; };
    /** JMRI dropped or refused our throttle: try again later rather than staying unacquired until a reload. */
    const scheduleReacquire = () => {
      if (reacquireTimer || disposed) return;
      reacquireTimer = setTimeout(() => { reacquireTimer = null; sync(); }, REACQUIRE_MS);
    };

    const stopPing = () => { if (pingTimer) clearInterval(pingTimer); pingTimer = null; };
    const startPing = (ms: number) => {
      stopPing();
      pingMs = ms;
      pingTimer = setInterval(() => {
        const sock = ws;
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        // JMRI answers every ping; silence for ~2.5 intervals means a dead link.
        if (Date.now() - lastRx > pingMs * 2.5) { drop('JMRI not responding'); return; }
        sock.send(pingMessage());
      }, ms);
    };

    const detach = (sock: WebSocket) => {
      sock.onopen = null; sock.onmessage = null; sock.onclose = null; sock.onerror = null;
    };

    const drop = (reason: string) => {
      const sock = ws;
      if (!sock) return;
      detach(sock);
      try { sock.close(); } catch { /* already closing */ }
      ws = null;
      if (wsRef.current === sock) wsRef.current = null;
      heldRef.current = null;
      stopPing();
      stopReacquire();
      update(disconnected);
      if (disposed) return;
      const delay = backoffMs(attempt++);
      setStatus('error');
      setConnError(`${reason} — retrying in ${Math.round(delay / 1000)} s`);
      retryTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      retryTimer = null;
      if (disposed) return;
      let sock: WebSocket;
      try {
        sock = new WebSocket(url);
      } catch (e) {
        setStatus('error');
        setConnError(e instanceof Error ? e.message : 'Invalid JMRI URL');
        return;
      }
      ws = sock;
      sock.onopen = () => {
        attempt = 0;
        lastRx = Date.now();
        wsRef.current = sock;
        setStatus('connected');
        setConnError(null);
        startPing(pingIntervalMs(null));
        sync();
      };
      sock.onmessage = (ev) => {
        lastRx = Date.now();
        const msg = parseIncoming(ev.data);
        if (!msg) return;
        if (msg.kind === 'hello') {
          startPing(pingIntervalMs(msg.heartbeat));
        } else if (msg.kind === 'throttle') {
          const held = heldRef.current;
          if (held && msg.name === held.name) {
            update((s) => applyThrottleUpdate(s, msg));
            // Released by JMRI (loco taken by another throttle or a dispatcher): we no longer hold it.
            if (msg.released) { heldRef.current = null; scheduleReacquire(); }
          }
        } else if (msg.kind === 'error') {
          // An error mid-acquire means JMRI holds nothing under our name, so
          // don't send a release for it later (JMRI would answer that with
          // another error, which could then fail the next acquire).
          if (tsRef.current.phase === 'acquiring') { heldRef.current = null; scheduleReacquire(); }
          update((s) => applyError(s, msg.code ? `${msg.message} (${msg.code})` : msg.message));
        }
      };
      sock.onclose = (ev) => drop(`JMRI connection closed${ev.code ? ` (${ev.code})` : ''}`);
      sock.onerror = () => { /* onclose follows */ };
    };

    setStatus('connecting');
    setConnError(null);
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopPing();
      stopReacquire();
      const sock = ws;
      ws = null;
      if (!sock) return;
      detach(sock);
      queueMicrotask(() => {
        const held = heldRef.current;
        if (sock.readyState === WebSocket.OPEN && held) sock.send(releaseMessage(held.name));
        if (wsRef.current === sock) { wsRef.current = null; heldRef.current = null; }
        try { sock.close(1000); } catch { /* ignore */ }
      });
    };
  }, [url, sync, update]);

  // ── Desired throttle ──────────────────────────────────────────────────────
  useEffect(() => {
    wantRef.current = { name: throttleName, rosterEntry: rosterEntryName || null };
    sync();
  }, [throttleName, rosterEntryName, sync]);

  // ── Release on page hide; re-acquire if the page comes back ───────────────
  useEffect(() => {
    const onHide = () => {
      const ws = wsRef.current;
      const held = heldRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && held) ws.send(releaseMessage(held.name));
      heldRef.current = null;
      update(disconnected);
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) sync(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, [sync, update]);

  const setFunction = useCallback((fn: number, on: boolean): boolean => {
    const ws = wsRef.current;
    const held = heldRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !held || tsRef.current.phase !== 'acquired') return false;
    if (!Number.isInteger(fn) || fn < 0 || fn > MAX_FN) return false;
    ws.send(functionMessage(held.name, fn, on));
    return true;
  }, []);

  const connected = status === 'connected';
  const acquired = connected && ts.phase === 'acquired';
  return useMemo(() => ({
    status,
    acquired,
    functions: ts.functions,
    setFunction,
    error: connError ?? (url ? ts.error : null),
  }), [status, acquired, ts.functions, ts.error, setFunction, connError, url]);
}
