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
