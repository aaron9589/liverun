/**
 * Per-device guard panel state (LOA latches, rolled guard events, un-ACKed
 * banners) belongs to one session. It is stored with the time it last changed
 * and dropped this long after, so running the same timetable next week starts
 * clean instead of "all complete" / "already fired".
 */
export const SESSION_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** JSON for localStorage: the value with the time it was saved. */
export function stampSessionState<T extends object>(value: T, now: number = Date.now()): string {
  return JSON.stringify({ ...value, saved_at: now });
}

/** The stored object if it was saved within SESSION_STATE_MAX_AGE_MS, else null (missing, unstamped, stale or not JSON). */
export function readSessionState(raw: string | null, now: number = Date.now()): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const savedAt = (obj as { saved_at?: unknown }).saved_at;
    if (typeof savedAt !== 'number' || now - savedAt > SESSION_STATE_MAX_AGE_MS) return null;
    return obj as Record<string, unknown>;
  } catch { return null; }
}
