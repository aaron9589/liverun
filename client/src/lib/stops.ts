import type { Train, TrainStop } from '../types';
import { timeToMinutes } from '../utils';

export interface SeqStop {
  stop: TrainStop;
  /** Arrival minutes, unwrapped across midnight (falls back to departure). */
  arr: number;
  /** Departure minutes, unwrapped across midnight (falls back to arrival). */
  dep: number;
}

/**
 * A train's stops in running order. The planner stores stops in station
 * (graph) order, so a train running the other way comes out backwards. Picks
 * whichever of stored / reversed order moves forward in time with the least
 * total wrap (midnight-safe); ties keep the stored order. Untimed stops move
 * with their neighbours. Returns the same array when it is already in order.
 */
export function runningOrder<S extends Pick<TrainStop, 'arrival' | 'departure'>>(stops: S[]): S[] {
  const cost = (list: S[]): number => {
    const pts: number[] = [];
    for (const st of list) {
      if (st.arrival) pts.push(timeToMinutes(st.arrival));
      if (st.departure) pts.push(timeToMinutes(st.departure));
    }
    let c = 0;
    for (let i = 1; i < pts.length; i++) c += (((pts[i] - pts[i - 1]) % 1440) + 1440) % 1440;
    return c;
  };
  const reversed = [...stops].reverse();
  return cost(reversed) < cost(stops) ? reversed : stops;
}

/** The train with its stops in running order (see runningOrder); the same object when already in order. */
export function inRunningOrder(train: Train): Train {
  const stops = runningOrder(train.stops);
  return stops === train.stops ? train : { ...train, stops };
}

/**
 * Timed stops in running order (runningOrder) with minutes unwrapped across midnight
 * (anchored on the first timed stop). Stops with neither time are skipped.
 */
export function sequenceStops(train: Pick<Train, 'stops'>): SeqStop[] {
  const out: SeqStop[] = [];
  let prev: number | null = null;
  // Smallest value >= prev congruent to m mod 1440.
  const unwrap = (m: number): number => {
    if (prev === null) return m;
    let v = m;
    while (v < prev) v += 1440;
    return v;
  };
  for (const stop of runningOrder(train.stops)) {
    if (!stop.arrival && !stop.departure) continue;
    const arrRaw = stop.arrival ? timeToMinutes(stop.arrival) : null;
    const depRaw = stop.departure ? timeToMinutes(stop.departure) : null;
    const arr = unwrap((arrRaw ?? depRaw) as number);
    prev = arr;
    const dep = depRaw === null ? arr : unwrap(depRaw);
    prev = dep;
    out.push({ stop, arr, dep });
  }
  return out;
}

export type StopState = 'pinned' | 'at' | 'next' | 'none';

/** Map a clock reading (0-1439) onto the run's unwrapped timeline. */
function clockInRun(seq: SeqStop[], clock: number): number {
  const first = seq[0].arr;
  const last = seq[seq.length - 1].dep;
  let c = clock;
  while (c < first) c += 1440;
  // Past the end but earlier the previous day would still be inside the run.
  if (c > last && c - 1440 >= first) c -= 1440;
  return c;
}

/** Current stop per spec §6.3: pinned > clock inside window > next upcoming. */
export function currentStop(
  seq: SeqStop[],
  clockMinutes: number | null,
  pinnedStopId: string | null,
): { index: number; state: StopState } {
  if (seq.length === 0) return { index: -1, state: 'none' };
  if (pinnedStopId) {
    const i = seq.findIndex((s) => s.stop.id === pinnedStopId);
    if (i >= 0) return { index: i, state: 'pinned' };
  }
  if (clockMinutes === null) return { index: -1, state: 'none' };
  const first = seq[0].arr;
  const last = seq[seq.length - 1].dep;
  let c = clockMinutes;
  // Clock earlier than the run start: it is either "before the run" or a post-midnight reading.
  if (c < first) {
    if (c + 1440 <= last) c += 1440;
    else return { index: 0, state: 'next' };
  }
  const at = seq.findIndex((s) => c >= s.arr && c <= s.dep);
  if (at >= 0) return { index: at, state: 'at' };
  const next = seq.findIndex((s) => s.arr > c);
  if (next >= 0) return { index: next, state: 'next' };
  return { index: -1, state: 'none' };
}

/** Run span in unwrapped minutes, or null when there are no timed stops. */
export function runSpan(train: Train): { start: number; end: number } | null {
  const seq = sequenceStops(train);
  return seq.length ? { start: seq[0].arr, end: seq[seq.length - 1].dep } : null;
}

/** Trains in run order by first timed stop (time of day); untimed trains last. */
export function sortByRun(trains: Train[]): Train[] {
  const key = (t: Train): number => {
    const s = runSpan(t);
    return s ? ((s.start % 1440) + 1440) % 1440 : Infinity;
  };
  return [...trains].sort((a, b) => key(a) - key(b));
}

/** Train whose span contains the clock, else the next to start, else the first. */
export function autoSelectTrain(trains: Train[], clockMinutes: number | null): Train | null {
  if (trains.length === 0) return null;
  if (clockMinutes === null) return trains[0];
  let next: { t: Train; wait: number } | null = null;
  for (const t of trains) {
    const span = runSpan(t);
    if (!span) continue;
    const c = clockInRun(sequenceStops(t), clockMinutes);
    if (c >= span.start && c <= span.end) return t;
    // clockInRun lifts c to >= start, so measure the wait to the next start the other way.
    const wait = (((span.start - clockMinutes) % 1440) + 1440) % 1440;
    if (!next || wait < next.wait) next = { t, wait };
  }
  return next ? next.t : trains[0];
}

