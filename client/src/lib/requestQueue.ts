import type { PathRequest, Station, Train } from '../types';
import { PATH_REQUEST_OPEN } from '../types';

// Planner-side helpers for the path-request queue (docs/path-requests-spec.md §5.1). Pure.

export const hasOpenAsk = (r: PathRequest): boolean => r.status === 'accepted' && r.cancel_ask?.status === 'open';

/** Needs Control's attention: pending, being plotted, or accepted with an open cancel ask. */
export const isOpenRequest = (r: PathRequest): boolean => PATH_REQUEST_OPEN.includes(r.status) || hasOpenAsk(r);

/** Open ones first, then closed; newest first within each group. */
export function sortRequests(requests: PathRequest[]): PathRequest[] {
  return [...requests].sort((a, b) => {
    const ao = isOpenRequest(a) ? 0 : 1;
    const bo = isOpenRequest(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return b.created_at.localeCompare(a.created_at);
  });
}

/**
 * What Control still has to deal with, sorted (newest first): pending, being plotted, and
 * accepted with an open cancel ask whose train still exists. Everything else (accepted,
 * declined, withdrawn, cancelled, or a train deleted since) drops out; it stays in the audit log.
 */
export function queueRequests(requests: PathRequest[] | undefined, trains: Pick<Train, 'id'>[]): PathRequest[] {
  const exists = new Set(trains.map((t) => t.id));
  return sortRequests((requests ?? []).filter((r) =>
    PATH_REQUEST_OPEN.includes(r.status) || (hasOpenAsk(r) && !!r.train_id_created && exists.has(r.train_id_created))));
}

/** Header badge: pending requests plus open cancel asks (whose train still exists). */
export function badgeCount(requests: PathRequest[] | undefined, trains: Pick<Train, 'id'>[]): number {
  return queueRequests(requests, trains).filter((r) => r.status === 'pending' || hasOpenAsk(r)).length;
}

/** "Kiama → Bombo (shunt 20, note) → Dunmore", with the siding where one is named. */
export function routeSummary(request: PathRequest, stations: Station[]): string {
  const byId = new Map(stations.map((s) => [s.id, s]));
  return request.stops
    .map((st) => {
      const name = byId.get(st.station_id)?.name ?? '?';
      if (st.kind === 'stop') return st.location_alias ? `${name} (${st.location_alias})` : name;
      const detail = [`${st.kind} ${st.minutes}`, st.note].filter(Boolean).join(', ');
      return st.location_alias ? `${name} (${st.location_alias}; ${detail})` : `${name} (${detail})`;
    })
    .join(' → ');
}

/** "Kiama → Bombo (2 stops)" for toasts: just the ends and the stop count. */
export function routeEnds(request: PathRequest, stations: Station[]): string {
  const name = (id: string | undefined) => stations.find((s) => s.id === id)?.name ?? '?';
  const first = request.stops[0];
  const last = request.stops[request.stops.length - 1];
  return `${name(first?.station_id)} → ${name(last?.station_id)} (${request.stops.length} stops)`;
}

export type RequestEvent =
  | { kind: 'new'; request: PathRequest }
  | { kind: 'cancel-ask'; request: PathRequest }
  | { kind: 'withdrawn'; request: PathRequest };

/** What changed between two request lists. A null `prev` is the first snapshot after (re)connect: no events. */
export function newRequestEvents(prev: PathRequest[] | null, next: PathRequest[]): RequestEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((r) => [r.id, r]));
  const events: RequestEvent[] = [];
  for (const r of next) {
    const old = before.get(r.id);
    if (!old) {
      if (r.status === 'pending') events.push({ kind: 'new', request: r });
      continue;
    }
    if (hasOpenAsk(r) && !hasOpenAsk(old)) events.push({ kind: 'cancel-ask', request: r });
    if (r.status === 'withdrawn' && old.status !== 'withdrawn') events.push({ kind: 'withdrawn', request: r });
  }
  return events;
}

/** "just now", "3 min ago", "2 h ago", "4 d ago". */
export function ageLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
