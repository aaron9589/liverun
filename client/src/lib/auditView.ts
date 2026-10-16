import type { AuditAction, AuditEntry, Timetable } from '../types';
import { routeSummary } from './requestQueue';

// Pure helpers for the Control-only audit views (docs/path-requests-spec.md §4.4).
// `detail` shapes come from server/path-requests.js; everything is read defensively.

export const AUDIT_ACTIONS: AuditAction[] = [
  'submit', 'withdraw', 'acknowledge', 'release', 'decline', 'accept',
  'cancel-ask', 'cancel-reject', 'cancel-approve', 'clear',
];

export const ACTION_LABEL: Record<AuditAction, string> = {
  submit: 'Submitted',
  withdraw: 'Withdrawn',
  acknowledge: 'Acknowledged',
  release: 'Released',
  decline: 'Declined',
  accept: 'Accepted',
  'cancel-ask': 'Asked to cancel',
  'cancel-reject': 'Cancel rejected',
  'cancel-approve': 'Cancel approved',
  clear: 'Cleared closed',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const pad = (n: number) => String(n).padStart(2, '0');

/** Local HH:MM:SS of an ISO time ('' if unparseable). */
export function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Local day/month + time, for the audit tab where entries span days. */
export function formatAuditDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${formatAuditTime(iso)}`;
}

/** Last 6 characters of a device id (the full id goes in a title). */
export const shortDevice = (device: string): string => (device.length > 6 ? `…${device.slice(-6)}` : device);

export const actorLabel = (e: AuditEntry): string =>
  e.actor === 'control' ? 'Control' : e.crew_name || 'Unknown crew';

/** Client-side outcome filter; '' = all. */
export function filterOutcome(entries: AuditEntry[], outcome: '' | 'ok' | 'rejected'): AuditEntry[] {
  return outcome ? entries.filter((e) => e.outcome === outcome) : entries;
}

/** Route of the entry's request, "removed request" when it no longer exists, '' when none. */
export function entryRoute(e: AuditEntry, timetable: Timetable): string {
  if (!e.request_id) return '';
  const r = (timetable.path_requests ?? []).find((x) => x.id === e.request_id);
  return r ? routeSummary(r, timetable.stations) : 'removed request';
}

function stopTimes(stops: unknown): string {
  if (!Array.isArray(stops)) return '';
  return stops.filter(isObj).map((s) => {
    const arr = str(s.arr), dep = str(s.dep);
    const at = arr && dep && arr !== dep ? `${arr}–${dep}` : arr ?? dep ?? '';
    return `${str(s.station) ?? '?'} ${at}`.trim();
  }).join(' → ');
}

function trainLines(t: unknown): string[] {
  if (!isObj(t)) return [];
  const head = [str(t.name) ?? 'Train', str(t.loco), str(t.crew) ? `crew ${t.crew}` : null].filter(Boolean).join(' · ');
  const times = stopTimes(t.stops);
  return times ? [head, times] : [head];
}

/** Readable lines for an entry's detail; falls back to JSON for shapes it doesn't know. */
export function describeDetail(e: AuditEntry, timetable: Timetable): string[] {
  const d = e.detail;
  const lines: string[] = [];
  if (e.outcome === 'rejected') {
    if (e.error) lines.push(`Rejected: ${e.error}`);
    if (isObj(d) && str(d.status)) lines.push(`Request was ${d.status}`);
    return lines;
  }
  if (!isObj(d)) return lines;
  const note = str(d.note);
  switch (e.action) {
    case 'submit': {
      if (Array.isArray(d.stops)) lines.push(`Route: ${routeSummary({ stops: d.stops } as never, timetable.stations)}`);
      if (str(d.loco)) lines.push(`Loco: ${d.loco}`);
      lines.push(`Ready: ${str(d.ready_at) ?? 'ASAP'}`);
      if (str(d.notes)) lines.push(`Notes: ${d.notes}`);
      return lines;
    }
    case 'withdraw':
      return d.while_plotting ? ['Withdrawn while plotting'] : [];
    case 'release':
      return d.reopened ? ['Reopened (its train no longer exists)'] : [];
    case 'decline':
    case 'cancel-reject':
      return note ? [`Reason: ${note}`] : [];
    case 'cancel-ask':
      return str(d.reason) ? [`Reason: ${d.reason}`] : [];
    case 'accept': {
      lines.push(...trainLines(d.train));
      if (str(d.assigned_crew)) lines.push(`Assigned to ${d.assigned_crew}`);
      if (note) lines.push(`Note: ${note}`);
      if (Array.isArray(d.moved)) {
        for (const m of d.moved.filter(isObj)) {
          lines.push(`Moved ${str(m.name) ?? 'train'}: ${stopTimes(m.from)} → ${stopTimes(m.to)}`);
        }
      }
      return lines;
    }
    case 'cancel-approve': {
      const t = isObj(d.train) ? d.train : null;
      lines.push(t ? `Deleted train ${str(t.name) ?? ''}`.trim() : 'Train already gone');
      if (t) lines.push(...trainLines(t).slice(1));
      if (note) lines.push(`Note: ${note}`);
      return lines;
    }
    case 'clear': {
      const n = Array.isArray(d.removed) ? d.removed.length : 0;
      return [`${n} request${n === 1 ? '' : 's'} removed`];
    }
    default:
      return Object.keys(d).length ? [JSON.stringify(d)] : [];
  }
}
