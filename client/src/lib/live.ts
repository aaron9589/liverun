/** Minimal Location shape so tests can pass a plain object. */
export type LocationLike = Pick<Location, 'protocol' | 'host' | 'pathname'>;

/**
 * Absolute URL of the live sync WebSocket for a timetable.
 *
 * The deployment base is derived from the page path: a trailing '/mobile' or
 * '/guard' view segment and trailing slashes are stripped, so the socket works
 * at the root and under a reverse-proxy sub-path (BASE_PATH=/traingraph).
 */
export function liveSyncUrl(timetableId: string, loc: LocationLike = window.location): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = loc.pathname.replace(/\/+$/, '').replace(/\/(mobile|guard)$/, '');
  return `${proto}//${loc.host}${base}/api/live/sync?id=${encodeURIComponent(timetableId)}`;
}
