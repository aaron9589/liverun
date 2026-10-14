/**
 * Hidden scripted guard events (spec §10): roll once per train run, then a
 * pure scheduler driven by the guard panel's door events and ticks.
 *
 * Everything here is pure: randomness is injected, time is passed in, and the
 * state is plain JSON so the panel can persist it (localStorage, keyed by
 * timetable + train id). "Reset events for this train" = the panel discards
 * the stored state and calls `rollEvents` again.
 *
 * Usage:
 *   state = stored ?? rollEvents(train, library, rng)
 *   on train edit:  state = reconcileRolled(state, train, library, rng)
 *   on door event:  ({ state, fired } = onDoor(state, train, { type, stopKey, realMs, clockMin }))
 *   every ~second:  ({ state, fired } = tick(state, train, { realMs, clockMin }))
 *
 * Stops are identified by `stopKey` = `${station_id}#${visit}` (visit counted
 * over all of the train's stops, timed or not), because stop ids are re-minted
 * whenever a train is saved. Use `stopKeyOf` to build keys for door events.
 *
 * Times: `realMs` is wall-clock milliseconds (station event delays); `clockMin`
 * is the fast-clock time of day in minutes 0–1439, or null when the clock is
 * unavailable (en-route events then can't fire; station events still can).
 *
 * En-route timing (§10.3), for a section starting at timed stop S and ending at
 * the next timed stop:
 *   - The section is "entered" when the train departs. Walking back from S, the
 *     most recent stop with a recorded Doors Close gives the departure; the
 *     scheduled offset from that stop's departure to S's departure is added
 *     (covers pass-through starts and carries lateness forward). If the latest
 *     door event at that stop is a Doors Open (doors open / reopened), the
 *     train is still standing there and nothing fires yet. If no Doors Close
 *     with a clock reading exists at or before S, the scheduled departure at S
 *     is used.
 *   - Fire minute = start + at × (scheduled arrival at the next timed stop −
 *     scheduled departure at S).
 *   - Dropped (D18) as soon as any door event is recorded at a timed stop after
 *     S. The end stop may be a pass-through with no doors, so "reaching the next
 *     stop" means the next door event further along the run, wherever the
 *     train actually stops.
 *   - Placements on the last timed stop (or on an untimed stop) have no section
 *     and never fire; they are reported in `problems` as 'no_section'.
 *
 * Station events arm on the first matching door event at their own stop (later
 * presses don't re-arm), fire `delayMs` of real time later, and are dropped if a
 * door event happens at a later timed stop before they ever armed.
 */
import type { GuardEventDef, GuardEventKind, GuardEventPlacement, StationTrigger, Train } from '../types';
import { sequenceStops, type SeqStop } from './stops';

export type Rng = () => number;

export type EventStatus = 'pending' | 'fired' | 'dropped';

/** One placement's roll for this run. */
export interface RolledEvent {
  placementId: string;
  /** `${station_id}#${visit}` of the stop the placement sits on. */
  stopKey: string;
  kind: GuardEventKind;
  /** Library id, or null for an inline event. */
  eventId: string | null;
  /** Whether the probability roll succeeded. Events that don't happen never fire. */
  happens: boolean;
  message: string;
  /** Sound file ('' = layout default event alert). */
  sound: string;
  /** Train-profile action to run on fire (library events only). */
  action?: string;
  /** Station: trigger and rolled delay in real milliseconds. */
  trigger?: StationTrigger;
  delayMs?: number;
  /** En-route: rolled fraction of the section's scheduled running time. */
  at?: number;
  status: EventStatus;
  /** Station: real time the event becomes due (set when its trigger happens). */
  dueAtMs?: number;
  /** Set when fired. */
  firedAtMs?: number;
  firedClockMin?: number | null;
  /** Fingerprint of the placement + library definition it was rolled from. */
  src: string;
}

export interface EventProblem {
  placementId: string;
  stopKey: string;
  reason: 'unknown_event' | 'no_kind' | 'no_messages' | 'no_section';
  /** Library id for 'unknown_event'. */
  eventId?: string;
}

export interface DoorMark {
  /** Order of the door event within this run (monotonic). */
  n: number;
  realMs: number;
  clockMin: number | null;
}

export type DoorType = StationTrigger;

/** Latest door event of each type at one stop. */
export type DoorLog = Partial<Record<DoorType, DoorMark>>;

export interface RolledState {
  v: 1;
  trainId: string;
  events: RolledEvent[];
  problems: EventProblem[];
  /** Door events by stopKey. */
  doors: Record<string, DoorLog>;
  /** Door event counter. */
  n: number;
}

export interface Now {
  realMs: number;
  clockMin: number | null;
}

export interface DoorEvent extends Now {
  type: DoorType;
  stopKey: string;
}

export interface StepResult {
  state: RolledState;
  /** Events that fired during this step, in due order. Show, alert, run action. */
  fired: RolledEvent[];
  /** Events dropped during this step (train moved on before they fired). */
  dropped: RolledEvent[];
}

const DEFAULT_TRIGGER: StationTrigger = 'door_open';
const DEFAULT_DELAY_S: [number, number] = [0, 0];
const DEFAULT_AT: [number, number] = [0.2, 0.8];
/** Fast-clock readings up to this many minutes after the scheduled run end count as "late", not "before the run". */
const LATE_MARGIN_MIN = 360;

// ── Stop identity ──

/** stopKey for every stop of the train, in route order (index-aligned with train.stops). */
export function stopKeysOf(train: Train): string[] {
  const seen = new Map<string, number>();
  return train.stops.map((s) => {
    const n = seen.get(s.station_id) ?? 0;
    seen.set(s.station_id, n + 1);
    return `${s.station_id}#${n}`;
  });
}

/** stopKey of a stop id on this train, or null. */
export function stopKeyOf(train: Train, stopId: string): string | null {
  const i = train.stops.findIndex((s) => s.id === stopId);
  return i >= 0 ? stopKeysOf(train)[i] : null;
}

// ── Rolling ──

const uid = (placementId: string, stopKey: string): string => `${placementId}@${stopKey}`;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function range(r: [number, number] | undefined, dflt: [number, number], lo: number, hi: number): [number, number] {
  const [a, b] = r && Number.isFinite(r[0]) && Number.isFinite(r[1]) ? r : dflt;
  const x = clamp(a, lo, hi);
  const y = clamp(b, lo, hi);
  return x <= y ? [x, y] : [y, x];
}

interface Resolved {
  kind: GuardEventKind;
  eventId: string | null;
  pool: string[];
  sound: string;
  action?: string;
  src: string;
}

function resolve(p: GuardEventPlacement, stopKey: string, library: GuardEventDef[]): Resolved | EventProblem {
  const base = { placementId: p.id, stopKey };
  const own = (p.messages ?? []).filter((m) => m.trim() !== '');
  const placementSrc = { ...p, id: undefined }; // id is the identity, not content
  if (p.event) {
    const def = library.find((d) => d.id === p.event);
    if (!def) return { ...base, reason: 'unknown_event', eventId: p.event };
    const pool = own.length ? own : def.messages.filter((m) => m.trim() !== '');
    return {
      kind: def.kind,
      eventId: def.id,
      pool: pool.length ? pool : [def.name],
      sound: def.sound ?? '',
      ...(def.action ? { action: def.action } : {}),
      src: JSON.stringify([placementSrc, def]),
    };
  }
  if (p.kind !== 'station' && p.kind !== 'enroute') return { ...base, reason: 'no_kind' };
  if (!own.length) return { ...base, reason: 'no_messages' };
  return { kind: p.kind, eventId: null, pool: own, sound: '', src: JSON.stringify([placementSrc]) };
}

function rollOne(p: GuardEventPlacement, stopKey: string, r: Resolved, rng: Rng): RolledEvent {
  // Fixed draw order: probability, message, timing.
  const happens = rng() < clamp(Number.isFinite(p.probability) ? p.probability : 0, 0, 1);
  const message = r.pool[Math.min(r.pool.length - 1, Math.floor(rng() * r.pool.length))];
  const timing = rng();
  const ev: RolledEvent = {
    placementId: p.id,
    stopKey,
    kind: r.kind,
    eventId: r.eventId,
    happens,
    message,
    sound: r.sound,
    ...(r.action ? { action: r.action } : {}),
    status: 'pending',
    src: r.src,
  };
  if (r.kind === 'station') {
    const [lo, hi] = range(p.delay_s, DEFAULT_DELAY_S, 0, Infinity);
    ev.trigger = p.trigger ?? DEFAULT_TRIGGER;
    ev.delayMs = Math.round((lo + timing * (hi - lo)) * 1000);
  } else {
    const [lo, hi] = range(p.at, DEFAULT_AT, 0, 1);
    ev.at = lo + timing * (hi - lo);
  }
  return ev;
}

function placementsOf(train: Train): { p: GuardEventPlacement; stopKey: string }[] {
  const keys = stopKeysOf(train);
  return train.stops.flatMap((s, i) => (s.guard_events ?? []).map((p) => ({ p, stopKey: keys[i] })));
}

/** Problems that depend on the train's schedule rather than the placement itself. */
function sectionProblems(train: Train, events: RolledEvent[]): EventProblem[] {
  const { index, seq } = timeline(train);
  return events
    .filter((e) => e.kind === 'enroute')
    .filter((e) => {
      const i = index.get(e.stopKey);
      return i === undefined || i >= seq.length - 1;
    })
    .map((e) => ({ placementId: e.placementId, stopKey: e.stopKey, reason: 'no_section' as const }));
}

function build(prev: RolledState | null, train: Train, library: GuardEventDef[], rng: Rng): RolledState {
  const kept = new Map<string, RolledEvent>();
  if (prev && prev.trainId === train.id) for (const e of prev.events) kept.set(uid(e.placementId, e.stopKey), e);
  const events: RolledEvent[] = [];
  const problems: EventProblem[] = [];
  for (const { p, stopKey } of placementsOf(train)) {
    const r = resolve(p, stopKey, library);
    if ('reason' in r) {
      problems.push(r);
      continue;
    }
    const old = kept.get(uid(p.id, stopKey));
    // Keep a prior roll if it already resolved, or if the placement is unchanged; re-roll edited pending ones.
    events.push(old && (old.status !== 'pending' || old.src === r.src) ? old : rollOne(p, stopKey, r, rng));
  }
  problems.push(...sectionProblems(train, events));
  const same = prev && prev.trainId === train.id;
  return { v: 1, trainId: train.id, events, problems, doors: same ? prev.doors : {}, n: same ? prev.n : 0 };
}

/** Roll every placement on the train once for this run. */
export function rollEvents(train: Train, library: GuardEventDef[], rng: Rng): RolledState {
  return build(null, train, library, rng);
}

/**
 * After Control edits the train (or the library): keep rolls (and fired/dropped
 * status) for placements whose id + stopKey still exist, roll new ones, forget
 * removed ones. A still-pending placement whose content (or library definition)
 * changed is re-rolled. Door history is kept. A different train id starts fresh.
 * Newly rolled station events are not armed retroactively by earlier door events.
 */
export function reconcileRolled(prev: RolledState | null, train: Train, library: GuardEventDef[], rng: Rng): RolledState {
  return build(prev, train, library, rng);
}

// ── Scheduling ──

interface Timeline {
  seq: SeqStop[];
  keys: string[];
  /** stopKey → index in seq (timed stops only). */
  index: Map<string, number>;
}

function timeline(train: Train): Timeline {
  const all = stopKeysOf(train);
  const byId = new Map(train.stops.map((s, i) => [s.id, all[i]]));
  const seq = sequenceStops(train);
  const keys = seq.map((s) => byId.get(s.stop.id) as string);
  return { seq, keys, index: new Map(keys.map((k, i) => [k, i])) };
}

/** Map a fast-clock time of day onto the run's unwrapped minutes (see LATE_MARGIN_MIN). */
function toRun(seq: SeqStop[], clockMin: number): number {
  const hi = seq[seq.length - 1].dep + LATE_MARGIN_MIN;
  const c = ((clockMin % 1440) + 1440) % 1440;
  return c + 1440 * Math.ceil((hi - 1440 - c) / 1440);
}

/** Unwrapped fire minute of an en-route event, or null if it can't be scheduled yet. */
function enrouteFireAt(tl: Timeline, doors: Record<string, DoorLog>, s: number, at: number): number | null {
  const { seq, keys } = tl;
  if (s < 0 || s >= seq.length - 1) return null;
  let start = seq[s].dep;
  for (let i = s; i >= 0; i--) {
    const log = doors[keys[i]];
    if (!log) continue;
    const open = log.door_open;
    const close = log.door_close;
    if (open && (!close || open.n > close.n)) return null; // standing at a platform with doors open
    if (close) {
      if (close.clockMin !== null) start = toRun(seq, close.clockMin) + (seq[s].dep - seq[i].dep);
      break;
    }
  }
  return start + at * (seq[s + 1].arr - seq[s].dep);
}

/** Highest seq index with any recorded door event, or -1. */
function furthestDoorIndex(tl: Timeline, doors: Record<string, DoorLog>): number {
  let max = -1;
  for (const key of Object.keys(doors)) {
    const i = tl.index.get(key);
    if (i !== undefined && i > max) max = i;
  }
  return max;
}

/**
 * Fire due events and drop missed ones. Call often (e.g. every second) and
 * persist the returned state whenever `fired` or `dropped` is non-empty.
 */
export function tick(state: RolledState, train: Train, now: Now): StepResult {
  const tl = timeline(train);
  const furthest = furthestDoorIndex(tl, state.doors);
  const c = now.clockMin !== null && tl.seq.length ? toRun(tl.seq, now.clockMin) : null;
  // Sort key: station events (group 0) by due time, then en-route (group 1) by fire minute.
  const fired: { e: RolledEvent; order: [number, number] }[] = [];
  const dropped: RolledEvent[] = [];
  const events = state.events.map((e) => {
    if (!e.happens || e.status !== 'pending') return e;
    const idx = tl.index.get(e.stopKey);
    if (e.kind === 'station') {
      if (e.dueAtMs !== undefined) {
        if (now.realMs < e.dueAtMs) return e;
        const done: RolledEvent = { ...e, status: 'fired', firedAtMs: now.realMs, firedClockMin: now.clockMin };
        fired.push({ e: done, order: [0, e.dueAtMs] });
        return done;
      }
      if (idx !== undefined && furthest > idx) {
        const gone: RolledEvent = { ...e, status: 'dropped' };
        dropped.push(gone);
        return gone;
      }
      return e;
    }
    if (idx === undefined) return e;
    if (furthest > idx) {
      const gone: RolledEvent = { ...e, status: 'dropped' };
      dropped.push(gone);
      return gone;
    }
    if (c === null) return e;
    const fireAt = enrouteFireAt(tl, state.doors, idx, e.at ?? 0);
    if (fireAt === null || c < fireAt) return e;
    const done: RolledEvent = { ...e, status: 'fired', firedAtMs: now.realMs, firedClockMin: now.clockMin };
    fired.push({ e: done, order: [1, fireAt] });
    return done;
  });
  if (!fired.length && !dropped.length) return { state, fired: [], dropped: [] };
  fired.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  return { state: { ...state, events }, fired: fired.map((f) => f.e), dropped };
}

/**
 * Record a door event, arm station events triggered by it (first press only),
 * drop events the train has now passed, then fire anything already due.
 */
export function onDoor(state: RolledState, train: Train, door: DoorEvent): StepResult {
  const n = state.n + 1;
  const mark: DoorMark = { n, realMs: door.realMs, clockMin: door.clockMin };
  const doors = { ...state.doors, [door.stopKey]: { ...state.doors[door.stopKey], [door.type]: mark } };
  const events = state.events.map((e) =>
    e.kind === 'station' && e.status === 'pending' && e.dueAtMs === undefined && e.stopKey === door.stopKey && e.trigger === door.type
      ? { ...e, dueAtMs: door.realMs + (e.delayMs ?? 0) }
      : e,
  );
  return tick({ ...state, doors, events, n }, train, door);
}

/** Events that will still fire this run (happened, pending). Handy for a Control/debug view. */
export function pendingEvents(state: RolledState): RolledEvent[] {
  return state.events.filter((e) => e.happens && e.status === 'pending');
}
