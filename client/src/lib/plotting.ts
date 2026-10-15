import type { PathRequest, Timetable, Train, TrainRequest, TrainStop } from '../types';
import { minutesToTime } from '../utils';
import { pendingTrainId } from './pathPlan';
import { runSpan } from './stops';

// Pure helpers for plotting a path request in the planner (docs/path-requests-spec.md §1, §5.3).

/**
 * The editor hands back a TrainRequest; turn it into the draft Train again. Nothing is saved:
 * the draft keeps its pending id and request_id, and stops get minted ids `${id}:${n}`.
 */
export function draftFromRequest(data: TrainRequest, prev: Train): Train {
  const id = prev.request_id ? pendingTrainId(prev.request_id) : prev.id;
  return {
    id,
    timetable_id: prev.timetable_id,
    name: data.name,
    color: data.color,
    notes: data.notes,
    train_id: data.trainId,
    direction: data.direction,
    crew_id: data.crewId,
    request_id: prev.request_id,
    stops: data.stops.map((s, n): TrainStop => ({
      id: `${id}:${n}`,
      train_id: id,
      station_id: s.stationId,
      arrival: s.arrival,
      departure: s.departure,
      special_instructions: s.specialInstructions,
      location_alias: s.locationAlias ?? null,
      guard_events: s.guardEvents,
    })),
  };
}

/** Other trains moved while plotting → the `retime` part of the accept body (same mapping as a graph Done). */
export function retimeFromDrafts(others: { trainId: string; stops: TrainStop[] }[]) {
  return others.map((c) => ({
    trainId: c.trainId,
    times: c.stops.map((s) => ({ stationId: s.station_id, arrival: s.arrival, departure: s.departure })),
  }));
}

/**
 * What the sync feed says about the request being plotted:
 * 'ok' = still in review; 'withdrawn' = the crew pulled it (keep the drafts, disable Accept);
 * 'gone' = it moved on some other way (returned, declined, accepted elsewhere): drop plotting.
 */
export function plotRequestState(requests: PathRequest[] | undefined, requestId: string): 'ok' | 'withdrawn' | 'gone' {
  const r = (requests ?? []).find((x) => x.id === requestId);
  if (!r) return 'gone';
  if (r.status === 'in_review') return 'ok';
  return r.status === 'withdrawn' ? 'withdrawn' : 'gone';
}

const wrap = (m: number) => ((m % 1440) + 1440) % 1440;
const hhmm = (m: number) => minutesToTime(wrap(Math.round(m)));

/**
 * Warnings shown while plotting (spec §5.3): the plan's own (path data, kept from when plotting
 * started) plus, recomputed from the current draft, a start before the fast clock and overlaps
 * with the assigned crew's other jobs. Midnight-safe; no clock → no clock warning.
 */
export function plotWarnings(
  train: Train,
  timetable: Pick<Timetable, 'trains' | 'crews'>,
  clockMinutes: number | null,
  planWarnings: string[],
): string[] {
  const out = [...planWarnings];
  const span = runSpan(train);
  if (!span) return out;
  if (typeof clockMinutes === 'number' && Number.isFinite(clockMinutes)) {
    // Up to 12 h behind the clock counts as "already started"; further is the future (next day).
    const behind = wrap(Math.floor(clockMinutes) - span.start);
    if (behind > 0 && behind < 720) out.push(`starts ${behind} min before the fast clock`);
  }
  const crew = train.crew_id ? timetable.crews.find((c) => c.id === train.crew_id) : undefined;
  if (crew) {
    for (const other of timetable.trains) {
      if (other.id === train.id || other.crew_id !== crew.id) continue;
      const o = runSpan(other);
      if (!o) continue;
      // Spans are unwrapped from their own first stop, so compare across day shifts.
      const clash = [-1440, 0, 1440].some((d) => span.start < o.end + d && o.start + d < span.end);
      if (clash) out.push(`${crew.name} has another job overlapping ${hhmm(o.start)}\u2013${hhmm(o.end)}`);
    }
  }
  return out;
}

// ── Colour of a plotted request ──────────────────────────────────────────────

/** Hue (0–360) of a #rgb / #rrggbb colour, or null for greys and anything unparsable. */
export function hueOf(hex: string): number | null {
  let c = hex.replace('#', '').trim();
  if (c.length === 3 || c.length === 4) c = c.slice(0, 3).split('').map((ch) => ch + ch).join('');
  if (c.length < 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  if ([r, g, b].some(Number.isNaN)) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.08) return null; // grey: no hue to clash with
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hslHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * A random bright colour for a plotted request, chosen among the 36 hues (10° apart) that
 * are furthest from every existing train's colour, so the draft stands out on a busy graph.
 * `random` is injectable for tests.
 */
export function pickRequestColor(trains: Pick<Train, 'color'>[], random: () => number = Math.random): string {
  const used = trains.map((t) => hueOf(t.color)).filter((h): h is number => h !== null);
  const gap = (h: number) => used.reduce((m, u) => Math.min(m, Math.min(Math.abs(h - u), 360 - Math.abs(h - u))), 180);
  const hues = Array.from({ length: 36 }, (_, i) => i * 10);
  const best = Math.max(...hues.map(gap));
  // Anything within 10° of the best gap counts, so the pick still varies on a crowded graph.
  const pool = hues.filter((h) => gap(h) >= best - 10);
  const h = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return hslHex(h, 0.95, 0.6);
}
