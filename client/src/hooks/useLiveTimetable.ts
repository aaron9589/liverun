import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoaValue, SyncMessage, Timetable } from '../types';
import { api } from '../api';
import { liveSyncUrl } from '../lib/live';
import { applyLoaValues } from '../lib/loa';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface LiveTimetable {
  /** Latest full timetable (train completion statuses merged in), or null while loading / none selected. */
  timetable: Timetable | null;
  loading: boolean;
  error: string | null;
  /** State of the /api/live/sync WebSocket. */
  status: LiveStatus;
  /** Server's active timetable id, kept current via 'active-changed'. undefined until first known. */
  activeId: string | null | undefined;
  /** True once the server reports this timetable was deleted. */
  deleted: boolean;
  /** Force a re-fetch. */
  refresh: () => void;
  /** Replace the held timetable with a fresher copy (e.g. a mutation response). */
  replace: (tt: Timetable) => void;
  /** LOA topic values (spec §11.5), from 'loa-values' messages. Empty until the server sends a snapshot. */
  loaValues: Record<string, LoaValue>;
}

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** Per-timetable-id state shared by fetches, socket handlers, refresh and replace. */
interface Session {
  id: string;
  /** Newest rev reflected in the held timetable; null until one is held (or after a server rollback). */
  rev: number | null;
  held: Timetable | null;
  inFlight: boolean;
  /** Re-fetch once more when the in-flight request completes. */
  again: boolean;
  /** While nothing is held: the response must be at least this rev, or fetch once more. */
  awaitRev: number | null;
  closed: boolean;
  fetchNow: () => void;
  adopt: (tt: Timetable) => void;
  /** Reconnect now if the socket is down (e.g. tablet woke up). */
  wake: () => void;
}

function rev(tt: Timetable): number {
  return tt.rev ?? 0;
}

type LoaValues = Record<string, LoaValue>;

function mergeStatuses(tt: Timetable, statuses: Record<string, 'running' | 'completed'>): Timetable {
  return { ...tt, trains: tt.trains.map((t) => ({ ...t, status: statuses[t.id] ?? undefined })) };
}

/**
 * Keeps a timetable in sync with the server in real time
 * (docs/guard-panel-spec.md §6.5).
 *
 * Subscribes to /api/live/sync. The server's notices carry no data: the hook
 * re-fetches on 'timetable-updated' with a newer rev and on a rev mismatch at
 * 'hello' (reconnect / server restart), and on visibilitychange→visible
 * (tablets waking). 'completions' and 'path-requests' are merged in place; 'loa-values' feed
 * `loaValues` (spec §11.5: full snapshot replaces, deltas merge). Fetches are serialised
 * and a response older than what is held is discarded.
 */
export function useLiveTimetable(timetableId: string | null): LiveTimetable {
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [activeId, setActiveIdState] = useState<string | null | undefined>(undefined);
  const [deleted, setDeleted] = useState(false);
  // Layout-wide (not per timetable), so kept across timetable switches; the
  // full snapshot after every (re)connect replaces it.
  const [loaValues, setLoaValues] = useState<LoaValues>({});
  const sessionRef = useRef<Session | null>(null);

  // Bumped whenever the socket reports the active id, so a slower REST answer can't overwrite it.
  const activeStamp = useRef(0);
  const setActiveFromSocket = useCallback((id: string | null) => {
    activeStamp.current += 1;
    setActiveIdState(id);
  }, []);
  const loadActiveId = useCallback(() => {
    const stamp = activeStamp.current;
    api.getActiveTimetable()
      .then((r) => { if (activeStamp.current === stamp) setActiveIdState(r.id); })
      .catch(() => { if (activeStamp.current === stamp) setActiveIdState((prev) => prev ?? null); });
  }, []);

  useEffect(() => { loadActiveId(); }, [loadActiveId]);

  useEffect(() => {
    setTimetable(null);
    setDeleted(false);
    setError(null);
    setLoading(false);
    setStatus('connecting');
    if (!timetableId) { sessionRef.current = null; return; }
    const id = timetableId;

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let delay = BACKOFF_MIN_MS;
    let gone = false; // server says the timetable was deleted: stop reconnecting

    const s: Session = {
      id, rev: null, held: null, inFlight: false, again: false, awaitRev: null, closed: false,
      adopt(tt) {
        s.held = tt;
        s.rev = rev(tt);
        setTimetable(tt);
      },
      fetchNow() {
        if (s.closed) return;
        if (s.inFlight) { s.again = true; return; }
        s.inFlight = true;
        s.again = false;
        if (!s.held) setLoading(true);
        api.getTimetable(id)
          .then((tt) => {
            if (s.closed) return;
            // Never let an older response overwrite a newer copy (mutation response, completions)
            if (s.rev === null || rev(tt) >= s.rev) s.adopt(tt);
            if (s.awaitRev !== null && rev(tt) < s.awaitRev) s.again = true;
            s.awaitRev = null;
            setError(null);
          })
          .catch((e: unknown) => {
            if (!s.closed) setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            if (s.closed) return;
            s.inFlight = false;
            setLoading(false);
            if (s.again) s.fetchNow();
          });
      },
      wake() {
        if (s.closed || gone || ws) return;
        clearTimeout(retryTimer);
        delay = BACKOFF_MIN_MS;
        connect();
      },
    };
    sessionRef.current = s;

    /** Ask for a fetch because the server has (at least) rev r. */
    function want(r: number) {
      if (!s.held && s.inFlight) s.awaitRev = Math.max(s.awaitRev ?? 0, r);
      else s.fetchNow();
    }

    function handle(msg: SyncMessage) {
      switch (msg.type) {
        case 'hello':
          if (msg.timetableId !== id) return;
          setActiveFromSocket(msg.activeId);
          if (msg.rev === s.rev) return;
          // Server went backwards (DB restored): accept whatever it has now
          if (s.rev !== null && msg.rev < s.rev) s.rev = null;
          want(msg.rev);
          return;
        case 'timetable-updated':
          if (msg.timetableId !== id) return;
          if (s.rev === null || msg.rev > s.rev) want(msg.rev);
          return;
        case 'completions': {
          if (msg.timetableId !== id) return;
          if (!s.held) {
            if (msg.rev !== undefined) want(msg.rev);
            return;
          }
          const merged = mergeStatuses(s.held, msg.statuses);
          // A rev on completions means only run status changed. One step ahead: adopt it;
          // further ahead: we missed an edit, so re-fetch.
          if (msg.rev !== undefined && s.rev !== null && msg.rev === s.rev + 1) {
            s.adopt({ ...merged, rev: msg.rev });
          } else {
            s.held = merged;
            setTimetable(merged);
            if (msg.rev !== undefined && s.rev !== null && msg.rev > s.rev + 1) s.fetchNow();
          }
          return;
        }
        case 'path-requests': {
          if (msg.timetableId !== id) return;
          if (!s.held) {
            if (msg.rev !== undefined) want(msg.rev);
            return;
          }
          const merged = { ...s.held, path_requests: msg.requests };
          // Same rev rules as completions: a rev means only requests changed.
          if (msg.rev !== undefined && s.rev !== null && msg.rev === s.rev + 1) {
            s.adopt({ ...merged, rev: msg.rev });
          } else {
            s.held = merged;
            setTimetable(merged);
            if (msg.rev !== undefined && s.rev !== null && msg.rev > s.rev + 1) s.fetchNow();
          }
          return;
        }
        case 'active-changed':
          setActiveFromSocket(msg.activeId);
          return;
        case 'loa-values':
          setLoaValues((prev) => applyLoaValues(prev, msg));
          return;
        case 'timetable-deleted':
          if (msg.timetableId !== id) return;
          gone = true;
          setDeleted(true);
          ws?.close();
          // No socket from here on, so ask for the active id directly (it may have been cleared)
          loadActiveId();
          return;
      }
    }

    function connect() {
      if (s.closed || gone) return;
      const sock = new WebSocket(liveSyncUrl(id));
      ws = sock;
      sock.onopen = () => {
        if (ws !== sock) return;
        delay = BACKOFF_MIN_MS;
        setStatus('live');
      };
      sock.onmessage = (e: MessageEvent<string>) => {
        if (ws !== sock) return;
        let msg: SyncMessage;
        try { msg = JSON.parse(e.data) as SyncMessage; } catch { return; }
        handle(msg);
      };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        if (s.closed || gone) return;
        setStatus('reconnecting');
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      };
    }

    s.fetchNow();
    connect();

    return () => {
      s.closed = true;
      clearTimeout(retryTimer);
      const sock = ws;
      ws = null;
      sock?.close();
      if (sessionRef.current === s) sessionRef.current = null;
    };
  }, [timetableId, setActiveFromSocket, loadActiveId]);

  // Tablets waking from sleep: catch up immediately rather than waiting for the backoff.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      const s = sessionRef.current;
      if (s) { s.fetchNow(); s.wake(); } else loadActiveId();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadActiveId]);

  const refresh = useCallback(() => { sessionRef.current?.fetchNow(); }, []);

  const replace = useCallback((tt: Timetable) => {
    const s = sessionRef.current;
    if (!s || s.closed || tt.id !== s.id) return;
    if (s.rev === null || rev(tt) >= s.rev) s.adopt(tt);
  }, []);

  return { timetable, loading, error, status, activeId, deleted, refresh, replace, loaValues };
}
