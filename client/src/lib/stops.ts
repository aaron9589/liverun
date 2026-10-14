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
 * Timed stops in route order with minutes unwrapped across midnight
 * (anchored on the first timed stop). Stops with neither time are skipped.
 */
export function sequenceStops(train: Train): SeqStop[] {
  const out: SeqStop[] = [];
  let prev: number | null = null;
  // Smallest value >= prev congruent to m mod 1440.
  const unwrap = (m: number): number => {
    if (prev === null) return m;
    let v = m;
    while (v < prev) v += 1440;
    return v;
  };
  for (const stop of train.stops) {
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

/** The same crew's next train by start time after `train`, or null. */
export function formsNext(train: Train, all: Train[]): Train | null {
  if (!train.crew_id) return null;
  const mine = sortByRun(all.filter((t) => t.crew_id === train.crew_id));
  const i = mine.findIndex((t) => t.id === train.id);
  return i >= 0 && i < mine.length - 1 ? mine[i + 1] : null;
}
