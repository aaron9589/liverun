import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuardEventDef, Train } from '../types';
import {
  onDoor, reconcileRolled, rollEvents, tick,
  type DoorType, type RolledEvent, type RolledState, type StepResult,
} from '../lib/guardEvents';

const storeKey = (ttId: string, trainId: string) => `guard:events:${ttId}:${trainId}`;

function load(ttId: string, trainId: string): RolledState | null {
  try {
    const raw = localStorage.getItem(storeKey(ttId, trainId));
    const s = raw ? (JSON.parse(raw) as RolledState) : null;
    return s && s.v === 1 && s.trainId === trainId && Array.isArray(s.events) ? s : null;
  } catch { return null; }
}
function save(ttId: string, s: RolledState): void {
  try { localStorage.setItem(storeKey(ttId, s.trainId), JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export interface FiredEvent { key: string; ev: RolledEvent; train: Train }

// Un-ACKed banners survive a reload (the engine has already marked them fired,
// so without this a reload would lose them for good). Restored banners don't
// replay their sound or action.
const queueKey = (ttId: string) => `guard:eventQueue:${ttId}`;
function loadQueue(ttId: string): FiredEvent[] {
  try {
    const q = JSON.parse(localStorage.getItem(queueKey(ttId)) ?? '[]') as FiredEvent[];
    return Array.isArray(q) ? q.filter((f) => f && f.key && f.ev && f.train) : [];
  } catch { return []; }
}
function saveQueue(ttId: string, q: FiredEvent[]): void {
  try {
    if (q.length) localStorage.setItem(queueKey(ttId), JSON.stringify(q));
    else localStorage.removeItem(queueKey(ttId));
  } catch { /* storage unavailable */ }
}

interface Args {
  timetableId: string | null;
  train: Train | null;
  library: GuardEventDef[];
  clockMin: number | null;
  /** Called once per event as it fires (action, publish; the banner and sound are the caller's too). */
  onFire: (ev: RolledEvent, train: Train) => void;
}

/**
 * Hidden scripted guard events (spec §10) for the displayed train: rolled state
 * kept in localStorage per timetable + train, ticked every second. Fired events
 * queue in `queue` until `ack()`. Nothing un-fired is ever exposed.
 */
export function useGuardEvents({ timetableId, train, library, clockMin, onFire }: Args) {
  const [queue, setQueue] = useState<FiredEvent[]>([]);
  const stateRef = useRef<RolledState | null>(null);
  const live = useRef({ timetableId, train, clockMin, onFire });
  live.current = { timetableId, train, clockMin, onFire };
  const warned = useRef(new Set<string>());

  // Restore un-ACKed banners for this timetable, then keep them saved.
  const queueTt = useRef<string | null>(null);
  useEffect(() => {
    queueTt.current = timetableId;
    setQueue(timetableId ? loadQueue(timetableId) : []);
  }, [timetableId]);
  useEffect(() => {
    if (queueTt.current && queueTt.current === timetableId) saveQueue(timetableId, queue);
  }, [queue, timetableId]);

  const apply = useCallback((res: StepResult) => {
    const { timetableId: tt, train: t, onFire: fire } = live.current;
    if (!tt || !t) return;
    stateRef.current = res.state;
    save(tt, res.state);
    if (res.fired.length) {
      setQueue((q) => [...q, ...res.fired.map((ev) => ({ key: `${ev.placementId}@${ev.stopKey}@${t.id}`, ev, train: t }))]);
      for (const ev of res.fired) fire(ev, t);
    }
  }, []);

  // Load / reconcile whenever the train object or library changes.
  useEffect(() => {
    if (!timetableId || !train) { stateRef.current = null; return; }
    const prev = stateRef.current?.trainId === train.id ? stateRef.current : load(timetableId, train.id);
    const next = reconcileRolled(prev, train, library, Math.random);
    stateRef.current = next;
    save(timetableId, next);
    for (const p of next.problems) {
      const k = `${next.trainId}:${p.placementId}:${p.reason}`;
      if (warned.current.has(k)) continue;
      warned.current.add(k);
      console.warn('[guard events] placement ignored', p);
    }
  }, [timetableId, train, library]);

  const step = useCallback(() => {
    const { train: t, clockMin: c } = live.current;
    const s = stateRef.current;
    if (!t || !s || s.trainId !== t.id) return;
    const res = tick(s, t, { realMs: Date.now(), clockMin: c });
    if (res.fired.length || res.dropped.length) apply(res);
  }, [apply]);

  useEffect(() => {
    const id = setInterval(step, 1000);
    return () => clearInterval(id);
  }, [step]);
  useEffect(step, [clockMin, step]);

  /** Record a door event at the stop with this key (see `stopKeyOf`). */
  const door = useCallback((type: DoorType, stopKey: string) => {
    const { train: t, clockMin: c } = live.current;
    const s = stateRef.current;
    if (!t || !s || s.trainId !== t.id) return;
    if (type === 'door_close') {
      // A repeat Close press (no Open since) must not move the recorded departure.
      const log = s.doors[stopKey];
      if (log?.door_close && (!log.door_open || log.door_close.n > log.door_open.n)) return;
    }
    apply(onDoor(s, t, { type, stopKey, realMs: Date.now(), clockMin: c }));
  }, [apply]);

  const reset = useCallback(() => {
    const { timetableId: tt, train: t } = live.current;
    if (!tt || !t) return;
    const next = rollEvents(t, library, Math.random);
    stateRef.current = next;
    save(tt, next);
    setQueue([]);
  }, [library]);

  const ack = useCallback(() => setQueue((q) => q.slice(1)), []);

  return { queue, ack, door, reset };
}
