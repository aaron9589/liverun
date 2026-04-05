import type {
  Timetable,
  TimetableSummary,
  TimetableSettings,
  TrainRequest,
  PathRequest,
} from './types';

// In dev, BASE_URL is '/' so this resolves to '/api' (caught by the Vite proxy).
// In production, BASE_URL is './' so fetch('./api/...') resolves relative to
// the page URL — works correctly whether the app is at '/' or '/traingraph/'.
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '') + '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Timetables ────────────────────────────────────────────────

export const api = {
  listTimetables: () =>
    req<TimetableSummary[]>('/timetables'),

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
    data: { name: string; shortCode: string; distance: number | null; graphPos: number }
  ) =>
    req<Timetable>(`/timetables/${timetableId}/stations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStation: (
    timetableId: string,
    stationId: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number }
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

  updateTrain: (timetableId: string, trainId: string, data: Omit<TrainRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/trains/${trainId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTrain: (timetableId: string, trainId: string) =>
    req<Timetable>(`/timetables/${timetableId}/trains/${trainId}`, {
      method: 'DELETE',
    }),

  // ── Paths ──────────────────────────────────────────────────

  addPath: (timetableId: string, data: Omit<PathRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/paths`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePath: (timetableId: string, pathId: string, data: Omit<PathRequest, 'id'>) =>
    req<Timetable>(`/timetables/${timetableId}/paths/${pathId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deletePath: (timetableId: string, pathId: string) =>
    req<Timetable>(`/timetables/${timetableId}/paths/${pathId}`, {
      method: 'DELETE',
    }),

  // ── Crews ──────────────────────────────────────────────────

  addCrew: (timetableId: string, data: { name: string; color: string }) =>
    req<Timetable>(`/timetables/${timetableId}/crews`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCrew: (timetableId: string, crewId: string, data: { name: string; color: string }) =>
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

  autoAssignCrews: (timetableId: string, data: { crewIds: string[]; trainIds: string[]; onlyUnassigned: boolean }) =>
    req<Timetable & { unassigned?: string[] }>(`/timetables/${timetableId}/trains/auto-assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
