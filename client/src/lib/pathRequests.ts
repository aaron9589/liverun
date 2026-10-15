// Pure helpers for the Crew jobs request form and My requests cards
// (docs/path-requests-spec.md §1, §3.3). No React, no network.
import type { PathRequest, PathRequestSubmit, PathWorkKind, Station, Timetable, Train } from '../types';
import { PATH_REQUEST_OPEN } from '../types';
import type { ToastTone } from '../components/ChangeToasts';
import { autoSelectTrain, runSpan, sequenceStops, sortByRun } from './stops';

export const MAX_STOP_NOTE = 200;
export const MAX_NOTES = 500;
export const MAX_MINUTES = 240;
export const MAX_VIA = 18; // 2–20 stops in total

/** A station plus an optional siding/road (only offered where the station has alias_enabled). */
export interface Place { stationId: string; alias: string }

export interface ViaDraft extends Place {
  /** Stable React key. */
  key: string;
  kind: PathWorkKind;
  minutes: number;
  note: string;
}

export interface RequestDraft {
  crewId: string;
  loco: string;
  from: Place;
  via: ViaDraft[];
  to: Place;
  /** true = "As soon as possible". */
  asap: boolean;
  /** HH:MM, used when !asap. */
  readyAt: string;
  notes: string;
}

export const emptyPlace = (): Place => ({ stationId: '', alias: '' });

const stationName = (stations: Pick<Station, 'id' | 'name'>[], id: string): string =>
  stations.find((s) => s.id === id)?.name ?? '?';

/** "Kiama Rd 2" style label for a station with an optional siding. */
function placeLabel(stations: Pick<Station, 'id' | 'name'>[], stationId: string, alias?: string | null): string {
  const a = alias?.trim();
  return a ? `${stationName(stations, stationId)} ${a}` : stationName(stations, stationId);
}

/** Route line "A → B (shunt 20) → C". Passing stops (Stop, 0 min) are plain names. */
export function routeLabel(request: Pick<PathRequest, 'stops'>, stations: Pick<Station, 'id' | 'name'>[]): string {
  const last = request.stops.length - 1;
  return request.stops
    .map((s, i) => {
      const name = placeLabel(stations, s.station_id, s.location_alias);
      if (i === 0 || i === last) return name;
      if (s.kind === 'stop' && s.minutes <= 0) return name;
      return `${name} (${s.kind} ${s.minutes})`;
    })
    .join(' → ');
}

/** Name of the crew with this id, if it exists. */
const crewName = (tt: Pick<Timetable, 'crews'>, id: string | undefined): string | null =>
  (id ? tt.crews.find((c) => c.id === id)?.name : null) ?? null;

/** Control's latest note to the crew: on a cancelled request it's the note given when approving the cancel. */
export function controlNote(r: PathRequest): string | undefined {
  const note = r.status === 'cancelled' ? r.cancel_ask?.control_note : r.control_note;
  return note?.trim() || undefined;
}

/** Headline status for a request card (Control's note on non-declined requests is shown separately). */
export function requestStatusText(request: PathRequest, timetable: Timetable, myCrewId: string): string {
  switch (request.status) {
    case 'pending': return 'Waiting for Control';
    case 'in_review': return 'Control is plotting your path';
    case 'declined': return request.control_note?.trim() ? `Declined: ${request.control_note.trim()}` : 'Declined';
    case 'withdrawn': return 'Withdrawn';
    case 'cancelled': return 'Cancelled';
    case 'accepted': {
      const train = request.train_id_created ? timetable.trains.find((t) => t.id === request.train_id_created) : undefined;
      let text = `Accepted → ${train ? train.name : 'train removed'}`;
      if (request.assigned_crew_id && request.assigned_crew_id !== myCrewId) {
        text += ` (assigned to ${crewName(timetable, request.assigned_crew_id) ?? 'another crew'})`;
      }
      return text;
    }
  }
}

/** Second line about a cancel ask, or null when there is none to show. */
export function cancelAskText(request: PathRequest): string | null {
  const ask = request.cancel_ask;
  if (request.status !== 'accepted' || !ask) return null;
  if (ask.status === 'open') return 'Waiting for Control';
  if (ask.status === 'rejected') return ask.control_note?.trim() ? `Cancel refused: ${ask.control_note.trim()}` : 'Cancel refused';
  return null;
}

export const isOpen = (r: Pick<PathRequest, 'status'>): boolean => PATH_REQUEST_OPEN.includes(r.status);
export const canWithdraw = isOpen;
export const hasOpenAsk = (r: PathRequest): boolean => r.cancel_ask?.status === 'open';
export const canAskCancel = (r: PathRequest): boolean => r.status === 'accepted' && !hasOpenAsk(r);

/** How long an accepted card stays prominent before it fades. */
export const ACCEPTED_FADE_MS = 5 * 60_000;

/** True once an accepted request has been settled for a while (no open ask to deal with). */
export function isFaded(r: PathRequest, now: number): boolean {
  if (r.status !== 'accepted' || hasOpenAsk(r)) return false;
  const t = Date.parse(r.updated_at);
  return Number.isFinite(t) && now - t > ACCEPTED_FADE_MS;
}

/** This crew's requests: open ones first, then newest first. */
export function myRequests(requests: PathRequest[] | undefined, crewId: string): PathRequest[] {
  const created = (r: PathRequest) => Date.parse(r.created_at) || 0;
  return (requests ?? [])
    .filter((r) => r.crew_id === crewId)
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || created(b) - created(a));
}

/** Where the crew is now: the last stop (running order) of its current or most recent job. */
export function defaultFrom(trains: Train[], crewId: string, clock: number | null): Place | null {
  const mine = sortByRun(trains.filter((t) => t.crew_id === crewId));
  let job: Train | null = null;
  if (clock !== null) {
    // Latest job that has started by now (current if still running); else the next one.
    for (const t of mine) {
      const span = runSpan(t);
      if (span && span.start % 1440 <= clock % 1440) job = t;
    }
  }
  job = job ?? autoSelectTrain(mine, clock);
  if (!job) return null;
  const seq = sequenceStops(job);
  const last = seq[seq.length - 1]?.stop;
  return last ? { stationId: last.station_id, alias: last.location_alias?.trim() ?? '' } : null;
}

export type SubmitCheck = { ok: true; reason: null } | { ok: false; reason: string };

/** Whether the draft can be sent; reason says why not (shown inline). */
export function canSubmit(draft: RequestDraft): SubmitCheck {
  const no = (reason: string): SubmitCheck => ({ ok: false, reason });
  if (!draft.from.stationId) return no('Pick where you are now.');
  if (!draft.to.stationId) return no('Pick where you want to go.');
  if (draft.from.stationId === draft.to.stationId) return no('From and To must be different stations.');
  if (draft.via.some((v) => !v.stationId)) return no('Pick a station for each added stop.');
  const ids = [draft.from.stationId, ...draft.via.map((v) => v.stationId), draft.to.stationId];
  if (new Set(ids).size !== ids.length) return no('Each station can only appear once in the route.');
  if (!draft.asap && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.readyAt)) return no('Pick a ready time, or choose As soon as possible.');
  return { ok: true, reason: null };
}

const clampMinutes = (m: number): number => Math.min(MAX_MINUTES, Math.max(0, Math.round(Number.isFinite(m) ? m : 0)));

/** Request body: origin and destination are always 'stop' with 0 minutes; text is trimmed and empties dropped. */
export function buildSubmit(draft: RequestDraft): PathRequestSubmit {
  const stop = (p: Place, kind: PathWorkKind, minutes: number, note?: string) => {
    const alias = p.alias.trim();
    const n = note?.trim();
    return {
      stationId: p.stationId,
      ...(alias ? { locationAlias: alias } : {}),
      kind,
      minutes,
      ...(n ? { note: n.slice(0, MAX_STOP_NOTE) } : {}),
    };
  };
  const loco = draft.loco.trim();
  const notes = draft.notes.trim();
  return {
    crewId: draft.crewId,
    ...(loco ? { loco } : {}),
    stops: [
      stop(draft.from, 'stop', 0),
      ...draft.via.map((v) => stop(v, v.kind, clampMinutes(v.minutes), v.note)),
      stop(draft.to, 'stop', 0),
    ],
    readyAt: draft.asap ? null : draft.readyAt,
    ...(notes ? { notes: notes.slice(0, MAX_NOTES) } : {}),
  };
}

/** Server errors arrive as Error(body text) where the body is JSON { error }; fall back to the raw text. */
export function apiErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const body = JSON.parse(raw) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch { /* not JSON */ }
  return raw || 'Something went wrong';
}

export interface RequestToast { message: string; tone: ToastTone }

/** Toasts for status changes to this crew's requests between two snapshots. New requests make none. */
export function requestToasts(
  prev: PathRequest[] | undefined,
  next: PathRequest[] | undefined,
  crewId: string,
  timetable: Timetable,
): RequestToast[] {
  const before = new Map((prev ?? []).map((r) => [r.id, r]));
  const out: RequestToast[] = [];
  for (const r of next ?? []) {
    if (r.crew_id !== crewId) continue;
    const old = before.get(r.id);
    if (!old) continue;
    if (old.status !== r.status) {
      if (r.status === 'declined') {
        out.push({ message: r.control_note?.trim() ? `Declined: ${r.control_note.trim()}` : 'Declined', tone: 'danger' });
      } else if (r.status === 'accepted') {
        const train = timetable.trains.find((t) => t.id === r.train_id_created);
        const other = r.assigned_crew_id && r.assigned_crew_id !== crewId ? crewName(timetable, r.assigned_crew_id) : null;
        // The status can arrive just before the re-fetch that brings the train; its "New job" toast names it then.
        out.push({ message: `Path accepted${train ? ` → ${train.name}` : ''}${other ? ` (${other})` : ''}`, tone: 'success' });
      } else if (r.status === 'in_review') {
        out.push({ message: 'Control is plotting your path', tone: 'info' });
      } else if (r.status === 'cancelled') {
        const note = controlNote(r);
        out.push({ message: note ? `Cancelled: ${note}` : 'Cancelled', tone: 'info' });
      }
    } else if (r.cancel_ask?.status === 'rejected' && (old.cancel_ask?.status !== 'rejected' || old.cancel_ask.at !== r.cancel_ask.at)) {
      const note = r.cancel_ask.control_note?.trim();
      out.push({ message: note ? `Cancel refused: ${note}` : 'Cancel refused', tone: 'warning' });
    }
  }
  return out;
}
