import type {
  Timetable,
  TimetableSummary,
  TimetableSettings,
  LayoutConfig,
  LoaValue,
  TrainRequest,
  PathSaveRequest,
  PathRequest,
  PathRequestSubmit,
  AuditEntry,
  AuditQuery,
} from './types';
import { auditHeaders } from './lib/device';

// In dev, BASE_URL is '/' so this resolves to '/api' (caught by the Vite proxy).
// In production, BASE_URL is './' so fetch('./api/...') resolves relative to
// the page URL — works correctly whether the app is at '/' or '/traingraph/'.
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '') + '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** URL of a sound-library file (served by GET /api/sounds/:file). */
export function soundUrl(file: string): string {
  return `${BASE}/sounds/${encodeURIComponent(file)}`;
}

export interface SoundFile {
  file: string;
  size: number;
}

// ── Timetables ────────────────────────────────────────────────

/** POST to a path-request endpoint with the audit headers. Returns the full timetable. */
function prPost(timetableId: string, suffix: string, body?: unknown): Promise<Timetable> {
  return req<Timetable>(`/timetables/${timetableId}/path-requests${suffix}`, {
    method: 'POST',
    headers: auditHeaders(),
    body: JSON.stringify(body ?? {}),
  });
}

function auditQueryString(q: AuditQuery & { format?: 'csv' }): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // ── Path requests (docs/path-requests-spec.md §4.2). Each returns the full timetable. ──
  // Crew actions carry the acting crew (self-declared, for the audit log); it must be the requester.
  listPathRequests: (timetableId: string) =>
    req<PathRequest[]>(`/timetables/${timetableId}/path-requests`, { headers: auditHeaders() }),

  submitPathRequest: (timetableId: string, data: PathRequestSubmit) =>
    prPost(timetableId, '', data),

  withdrawPathRequest: (timetableId: string, requestId: string, crewId: string) =>
    prPost(timetableId, `/${requestId}/withdraw`, { crewId }),

  askCancelPathRequest: (timetableId: string, requestId: string, crewId: string, reason?: string) =>
    prPost(timetableId, `/${requestId}/cancel-ask`, { crewId, reason }),

  // Control actions
  acknowledgePathRequest: (timetableId: string, requestId: string) =>
    prPost(timetableId, `/${requestId}/acknowledge`),

  releasePathRequest: (timetableId: string, requestId: string) =>
    prPost(timetableId, `/${requestId}/release`),

  declinePathRequest: (timetableId: string, requestId: string, note: string) =>
    prPost(timetableId, `/${requestId}/decline`, { note }),

  rejectCancelPathRequest: (timetableId: string, requestId: string, note: string) =>
    prPost(timetableId, `/${requestId}/cancel-reject`, { note }),

  clearClosedPathRequests: (timetableId: string) =>
    req<Timetable>(`/timetables/${timetableId}/path-requests?closed=true`, { method: 'DELETE', headers: auditHeaders() }),

  // ── Audit log (Control only in the UI). Newest first. ──
  getAudit: (q: AuditQuery = {}) =>
    req<AuditEntry[]>(`/audit${auditQueryString(q)}`),

  /** URL for the CSV export (open / download directly). */
  auditCsvUrl: (q: AuditQuery = {}) =>
    `${BASE}/audit${auditQueryString({ ...q, format: 'csv' })}`,

  // ── Limit of Authority: last known topic values (server cache) ──
  getLoaValues: () =>
    req<Record<string, LoaValue>>('/loa/values'),

  // ── Layout-wide config ──
  getLayout: () =>
    req<LayoutConfig>('/layout'),

  updateLayout: (layout: LayoutConfig) =>
    req<LayoutConfig>('/layout', {
      method: 'PUT',
      body: JSON.stringify(layout),
    }),

  // ── Sound library (acts immediately; not part of the layout draft) ──
  listSounds: () =>
    req<SoundFile[]>('/sounds'),

  /** Raw body with the file's own content type (not JSON). Rejects with a 409 body if it exists and !overwrite. */
  uploadSound: (file: File, overwrite = false) =>
    req<SoundFile>(`/sounds?name=${encodeURIComponent(file.name)}${overwrite ? '&overwrite=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),

  deleteSound: (name: string) =>
    req<{ ok: true }>(`/sounds/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  listTimetables: () =>
    req<TimetableSummary[]>('/timetables'),

  getActiveTimetable: () =>
    req<{ id: string | null }>('/active-timetable'),

  setActiveTimetable: (id: string | null) =>
    req<{ id: string | null }>('/active-timetable', {
      method: 'PUT',
      body: JSON.stringify({ id }),
    }),

  createTimetable: (data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) =>
    req<Timetable>('/timetables', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTimetable: (id: string) =>
    req<Timetable>(`/timetables/${id}`),

  updateTimetable: (
    id: string,
    data: { name: string; description: string; startTime: string; endTime: string }
  ) =>
    req<Timetable>(`/timetables/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTimetable: (id: string) =>
    req<{ ok: boolean }>(`/timetables/${id}`, { method: 'DELETE' }),

  duplicateTimetable: (id: string) =>
    req<Timetable>(`/timetables/${id}/duplicate`, { method: 'POST' }),

  importTimetable: (data: unknown) =>
    req<Timetable>('/timetables/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  restoreTimetable: (id: string, data: { stations: unknown[]; trains: unknown[]; paths: unknown[]; crews: unknown[] }) =>
    req<Timetable>(`/timetables/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ stations: data.stations, trains: data.trains, paths: data.paths, crews: data.crews }),
    }),

  updateTimetableSettings: (id: string, settings: TimetableSettings) =>
    req<Timetable>(`/timetables/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // ── Stations ───────────────────────────────────────────────

  addStation: (
    timetableId: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; branchName?: string | null; pushDown?: boolean; aliasEnabled?: boolean; boardingWeight?: number | null }
  ) =>
    req<Timetable>(`/timetables/${timetableId}/stations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStation: (
    timetableId: string,
    stationId: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number; branchName?: string | null; pushDown?: boolean; aliasEnabled?: boolean; boardingWeight?: number | null }
  ) =>
    req<Timetable>(`/timetables/${timetableId}/stations/${stationId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteStation: (timetableId: string, stationId: string) =>
    req<Timetable>(`/timetables/${timetableId}/stations/${stationId}`, {
      method: 'DELETE',
    }),

  // ── Trains ─────────────────────────────────────────────────

  addTrain: (timetableId: string, data: Omit<TrainRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/trains`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Graph editing: new times only, matched by station; all-or-nothing (409 if a train's stops changed since). */
  retimeTrains: (
    timetableId: string,
    changes: { trainId: string; times: { stationId: string; arrival: string | null; departure: string | null }[] }[],
  ) =>
    req<Timetable>(`/timetables/${timetableId}/trains/retime`, {
      method: 'POST',
      body: JSON.stringify({ changes }),
    }),

  updateTrain: (timetableId: string, trainId: string, data: Omit<TrainRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/trains/${trainId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTrain: (timetableId: string, trainId: string) =>
    req<Timetable>(`/timetables/${timetableId}/trains/${trainId}`, {
      method: 'DELETE',
    }),

  setTrainStatus: (timetableId: string, trainId: string, status: 'running' | 'completed' | null) =>
    req<Timetable>(`/timetables/${timetableId}/trains/${trainId}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  resetAllCompleted: (timetableId: string) =>
    req<Timetable>(`/timetables/${timetableId}/trains/reset-complete`, {
      method: 'POST',
    }),

  // ── Paths ──────────────────────────────────────────────────

  addPath: (timetableId: string, data: Omit<PathSaveRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/paths`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePath: (timetableId: string, pathId: string, data: Omit<PathSaveRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/paths/${pathId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deletePath: (timetableId: string, pathId: string) =>
    req<Timetable>(`/timetables/${timetableId}/paths/${pathId}`, {
      method: 'DELETE',
    }),

  // ── Crews ──────────────────────────────────────────────────

  addCrew: (timetableId: string, data: { name: string; color: string; guardVisible?: boolean }) =>
    req<Timetable>(`/timetables/${timetableId}/crews`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCrew: (timetableId: string, crewId: string, data: { name: string; color: string; guardVisible?: boolean }) =>
    req<Timetable>(`/timetables/${timetableId}/crews/${crewId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCrew: (timetableId: string, crewId: string) =>
    req<Timetable>(`/timetables/${timetableId}/crews/${crewId}`, {
      method: 'DELETE',
    }),

  reorderCrews: (timetableId: string, order: string[]) =>
    req<Timetable>(`/timetables/${timetableId}/crews/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    }),

  autoAssignCrews: (timetableId: string, data: { crewIds: string[]; trainIds: string[]; onlyUnassigned: boolean; minBreakMins: number }) =>
    req<Timetable & { unassigned?: string[] }>(`/timetables/${timetableId}/trains/auto-assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
