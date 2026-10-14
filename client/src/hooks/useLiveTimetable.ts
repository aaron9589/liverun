import { useCallback, useEffect, useState } from 'react';
import type { Timetable } from '../types';
import { api } from '../api';

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
}

/**
 * Keeps a timetable in sync with the server in real time
 * (docs/guard-panel-spec.md §6.5).
 *
 * CONTRACT STUB — loads once, no live updates. Phase 2A replaces the internals:
 * subscribe to /api/live/sync, re-fetch on 'timetable-updated' and on a rev
 * mismatch at 'hello' (reconnect / wake), re-fetch on visibilitychange→visible,
 * merge 'completions', track 'active-changed' / 'timetable-deleted',
 * reconnect with backoff. The signature above must not change.
 */
export function useLiveTimetable(timetableId: string | null): LiveTimetable {
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    api.getActiveTimetable().then((r) => setActiveId(r.id)).catch(() => setActiveId(null));
  }, []);

  useEffect(() => {
    if (!timetableId) { setTimetable(null); return; }
    let cancelled = false;
    setLoading(true);
    api.getTimetable(timetableId)
      .then((tt) => { if (!cancelled) { setTimetable(tt); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timetableId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { timetable, loading, error, status: 'live', activeId, deleted: false, refresh, replace: setTimetable };
}
