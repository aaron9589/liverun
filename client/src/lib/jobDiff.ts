import type { Crew, Timetable, Train, TrainStop } from '../types';
import { runSpan } from './stops';

/** One change to a crew's job list between two versions of a timetable (spec §6.5). */
export type JobChange =
  /** Now in my set: a new train, or one reassigned to my crew. */
  | { type: 'added'; train: Train }
  /** Was mine and has been deleted. `train` is the old copy. */
  | { type: 'removed'; train: Train }
  /** Was mine, now belongs to another crew (`crew`) or nobody (null). */
  | { type: 'reassigned'; train: Train; crew: Crew | null }
  /** Still mine; times changed or stops were added/removed. `stopIds` are the new train's changed stops. */
  | { type: 'retimed'; train: Train; stopIds: string[] }
  /** Still mine; name changed. */
  | { type: 'renamed'; train: Train; oldName: string };

/**
 * Stop identity across saves. The server mints new stop ids whenever a train
 * is saved, so stops are matched by station plus visit number instead
 * (a train can call at the same station more than once).
 */
function stopKeys(stops: TrainStop[]): Map<string, TrainStop> {
  const seen = new Map<string, number>();
  const keyed = new Map<string, TrainStop>();
  for (const stop of stops) {
    const n = seen.get(stop.station_id) ?? 0;
    seen.set(stop.station_id, n + 1);
    keyed.set(`${stop.station_id}#${n}`, stop);
  }
  return keyed;
}

/** Stops of `next` whose times differ from `prev`, plus whether any stop was dropped. */
function changedStops(prev: Train, next: Train): { stopIds: string[]; dropped: boolean } {
  const before = stopKeys(prev.stops);
  const after = stopKeys(next.stops);
  const stopIds: string[] = [];
  for (const [key, stop] of after) {
    const old = before.get(key);
    if (!old || (old.arrival ?? null) !== (stop.arrival ?? null) || (old.departure ?? null) !== (stop.departure ?? null)) {
      stopIds.push(stop.id);
    }
  }
  const dropped = [...before.keys()].some((key) => !after.has(key));
  return { stopIds, dropped };
}

/**
 * Diffs the job lists of two timetable versions, matching trains by id.
 * crewIds limits "my jobs" to those crews ('' = unassigned trains);
 * null means every train, so crew changes are never reported as reassignments.
 */
export function diffJobs(prev: Timetable, next: Timetable, crewIds: string[] | null): JobChange[] {
  const mine = (t: Train) => crewIds === null || crewIds.includes(t.crew_id ?? '');
  const prevById = new Map(prev.trains.map((t) => [t.id, t]));
  const nextById = new Map(next.trains.map((t) => [t.id, t]));
  const crews = new Map(next.crews.map((c) => [c.id, c]));
  const changes: JobChange[] = [];

  for (const old of prev.trains) {
    if (!mine(old)) continue;
    const cur = nextById.get(old.id);
    if (!cur) {
      changes.push({ type: 'removed', train: old });
    } else if (!mine(cur)) {
      changes.push({ type: 'reassigned', train: cur, crew: (cur.crew_id && crews.get(cur.crew_id)) || null });
    } else {
      if (cur.name !== old.name) changes.push({ type: 'renamed', train: cur, oldName: old.name });
      const { stopIds, dropped } = changedStops(old, cur);
      if (stopIds.length > 0 || dropped) changes.push({ type: 'retimed', train: cur, stopIds });
    }
  }

  for (const cur of next.trains) {
    if (!mine(cur)) continue;
    const old = prevById.get(cur.id);
    if (!old || !mine(old)) changes.push({ type: 'added', train: cur });
  }

  return changes;
}

/** Toast tone for a change; matches ToastTone in components/ChangeToasts. */
export type JobChangeTone = 'info' | 'success' | 'warning' | 'danger';

function hhmm(mins: number | undefined): string {
  if (mins === undefined) return '—';
  const t = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** One-line description of a change, shared by CrewMobile and the guard panel. */
export function describeJobChange(change: JobChange): { message: string; tone: JobChangeTone } {
  switch (change.type) {
    case 'added':
      return { message: `New job: ${change.train.name} (${hhmm(runSpan(change.train)?.start)})`, tone: 'success' };
    case 'removed':
      return { message: `${change.train.name} removed`, tone: 'danger' };
    case 'reassigned':
      return { message: `${change.train.name} → ${change.crew?.name ?? 'unassigned'}`, tone: 'warning' };
    case 'retimed':
      return { message: `${change.train.name} retimed`, tone: 'info' };
    case 'renamed':
      return { message: `${change.oldName} renamed to ${change.train.name}`, tone: 'info' };
  }
}
