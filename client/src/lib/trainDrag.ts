/**
 * Pure helpers behind dragging trains on the train graph.
 *
 *   shiftStops(stops, delta)                  whole train left/right: every time moves
 *   dragStopTime(stops, stopId, kind, delta)  one handle: that time and every later
 *                                             time on the run move (the rest of the
 *                                             path keeps its running times and dwells)
 *
 * Works in running order (stops are stored in station order, see runningOrder)
 * with minutes unwrapped across midnight, and returns the stops in their stored
 * order with only the times changed. Times are whole minutes.
 */
import type { TrainStop } from '../types';
import { runningOrder } from './stops';
import { minutesToTime, timeToMinutes } from '../utils';

export type TimeKind = 'arr' | 'dep';

interface Point { stopId: string; kind: TimeKind; t: number }

/** Every time on the run, in running order, unwrapped so they never go backwards. */
function timePoints(stops: TrainStop[]): Point[] {
  const out: Point[] = [];
  let prev: number | null = null;
  const unwrap = (m: number): number => {
    if (prev === null) return m;
    let v = m;
    while (v < prev) v += 1440;
    return v;
  };
  for (const s of runningOrder(stops)) {
    for (const kind of ['arr', 'dep'] as const) {
      const raw = kind === 'arr' ? s.arrival : s.departure;
      if (!raw) continue;
      const t = unwrap(timeToMinutes(raw));
      prev = t;
      out.push({ stopId: s.id, kind, t });
    }
  }
  return out;
}

const fmt = (t: number): string => minutesToTime(((t % 1440) + 1440) % 1440);

/** Writes the points' times back onto the stops (stored order kept). */
function withTimes(stops: TrainStop[], points: Point[]): TrainStop[] {
  const byKey = new Map(points.map((p) => [`${p.stopId}:${p.kind}`, p.t]));
  return stops.map((s) => {
    const arr = byKey.get(`${s.id}:arr`);
    const dep = byKey.get(`${s.id}:dep`);
    if (arr === undefined && dep === undefined) return s;
    return {
      ...s,
      arrival: arr !== undefined ? fmt(arr) : s.arrival,
      departure: dep !== undefined ? fmt(dep) : s.departure,
    };
  });
}

/** Moves every time on the train by `delta` minutes. */
export function shiftStops(stops: TrainStop[], delta: number): TrainStop[] {
  if (delta === 0) return stops;
  return withTimes(stops, timePoints(stops).map((p) => ({ ...p, t: p.t + delta })));
}

/**
 * Moves one time (a stop's arrival or departure) by `delta` minutes, with every
 * later time on the run moving the same amount. Dragging a pass-through stop's
 * departure later turns it into a dwell. Clamped so the dragged time never goes
 * before the time just before it (no negative dwell or running time). Returns
 * the new stops and the delta actually applied; unchanged if the stop has no
 * such time (the first stop has no arrival, the last no departure).
 */
export function dragStopTime(
  stops: TrainStop[],
  stopId: string,
  kind: TimeKind,
  delta: number,
): { stops: TrainStop[]; delta: number } {
  const pts = timePoints(stops);
  const i = pts.findIndex((p) => p.stopId === stopId && p.kind === kind);
  if (i < 0) return { stops, delta: 0 };
  const applied = i > 0 ? Math.max(delta, pts[i - 1].t - pts[i].t) : delta;
  if (applied === 0) return { stops, delta: 0 };
  return { stops: withTimes(stops, pts.map((p, j) => (j >= i ? { ...p, t: p.t + applied } : p))), delta: applied };
}
