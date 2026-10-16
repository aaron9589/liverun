// Identity hints for the path-request audit log (docs/path-requests-spec.md §4.4).
// No auth: these say which browser made a call, not who someone is.

export const DEVICE_KEY = 'liverun.deviceId';

let memoryId: string | null = null;
let clockHint: string | null = null;

/** Random id generated once per browser (kept in memory if storage is unavailable). */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
  } catch { /* storage unavailable */ }
  if (!memoryId) {
    const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(16).slice(2, 18);
    memoryId = `d-${rand}`;
  }
  try { localStorage.setItem(DEVICE_KEY, memoryId); } catch { /* storage unavailable */ }
  return memoryId;
}

/** The page's current fast-clock time (minutes) for audit entries; null when unknown. */
export function setClockHint(minutes: number | null): void {
  if (minutes === null) { clockHint = null; return; }
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  clockHint = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Headers sent with every path-request and audit call. */
export function auditHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'X-LiveRun-Device': deviceId() };
  if (clockHint) h['X-LiveRun-Clock'] = clockHint;
  return h;
}
