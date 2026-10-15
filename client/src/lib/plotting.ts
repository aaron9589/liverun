import type { PathRequest, Train, TrainRequest, TrainStop } from '../types';
import { pendingTrainId } from './pathPlan';

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
