/**
 * JMRI JSON protocol (v5) — pure message builders, parsing and throttle state
 * transitions for useJmriThrottle (spec §7.1). No sockets, no timers.
 *
 * Wire format (JMRI jmri.server.json.throttle):
 *   → {"type":"throttle","data":{"name":N,"rosterEntry":R}}     acquire (JMRI replies with full status)
 *   → {"type":"throttle","data":{"name":N,"F6":true}}           set function (JMRI echoes on change)
 *   → {"type":"throttle","data":{"name":N,"release":null}}      release
 *   → {"type":"ping"}                                           heartbeat (JMRI answers {"type":"pong"})
 *   ← {"type":"hello","data":{"heartbeat":13500,…}}
 *   ← {"type":"throttle","data":{"name":N,"throttle":N,"address":…,"F0":…,…}}  status / changes
 *   ← {"type":"error","data":{"code":404,"message":…}}
 *
 * We only ever send the `name` key. JMRI writes both `name` and the legacy
 * `throttle` key on outgoing messages; we read either.
 */

export const MAX_FN = 68;
export const DEFAULT_PING_MS = 15_000;
export const MIN_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

// ── Outgoing ────────────────────────────────────────────────────────────────

export const pingMessage = (): string => JSON.stringify({ type: 'ping' });

export const acquireMessage = (name: string, rosterEntry: string): string =>
  JSON.stringify({ type: 'throttle', data: { name, rosterEntry } });

export const functionMessage = (name: string, fn: number, on: boolean): string =>
  JSON.stringify({ type: 'throttle', data: { name, [`F${fn}`]: on } });

export const releaseMessage = (name: string): string =>
  JSON.stringify({ type: 'throttle', data: { name, release: null } });

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the trimmed URL if it is a ws:// or wss:// URL, else null. */
export function validWsUrl(url: string | null | undefined): string | null {
  const t = (url ?? '').trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'ws:' || u.protocol === 'wss:' ? t : null;
  } catch {
    return null;
  }
}

/** Ping at ~80% of JMRI's advertised heartbeat; 15 s when unknown. */
export function pingIntervalMs(heartbeat: number | null | undefined): number {
  if (typeof heartbeat !== 'number' || !Number.isFinite(heartbeat) || heartbeat <= 0) return DEFAULT_PING_MS;
  return Math.max(1_000, Math.floor(heartbeat * 0.8));
}

/** Reconnect delay for the n-th consecutive failure (0-based): 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, Math.min(attempt, 10)));
}

// ── Incoming ────────────────────────────────────────────────────────────────

export interface ThrottleUpdate {
  kind: 'throttle';
  /** Throttle name (from `name`, or legacy `throttle`). */
  name: string | null;
  /** Present on a full status message (acquire reply / status request). */
  address?: number;
  rosterEntry?: string;
  /** True when this message reports the throttle was released. */
  released: boolean;
  /** Function states in this message only (fn number → on). */
  functions: Record<number, boolean>;
}

export type JmriIncoming =
  | { kind: 'hello'; heartbeat: number | null; version: string | null }
  | { kind: 'pong' }
  | ThrottleUpdate
  | { kind: 'error'; code: number | null; message: string }
  | { kind: 'other'; type: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses one WebSocket frame from JMRI. Returns null for non-JSON / unrecognised frames. */
export function parseIncoming(raw: unknown): JmriIncoming | null {
  if (typeof raw !== 'string') return null;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  if (!isObj(json) || typeof json.type !== 'string') return null;
  const data: Obj = isObj(json.data) ? json.data : {};
  switch (json.type) {
    case 'hello': {
      const hb = typeof data.heartbeat === 'number' ? data.heartbeat : Number(data.heartbeat);
      return {
        kind: 'hello',
        heartbeat: Number.isFinite(hb) && hb > 0 ? hb : null,
        version: typeof data.JMRI === 'string' ? data.JMRI : null,
      };
    }
    case 'pong':
      return { kind: 'pong' };
    case 'error':
      return {
        kind: 'error',
        code: typeof data.code === 'number' ? data.code : null,
        message: typeof data.message === 'string' && data.message ? data.message : 'JMRI error',
      };
    case 'throttle': {
      const nameRaw = typeof data.name === 'string' && data.name ? data.name : data.throttle;
      const functions: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(data)) {
        const m = /^F(\d{1,2})$/.exec(k);
        if (m && typeof v === 'boolean' && Number(m[1]) <= MAX_FN) functions[Number(m[1])] = v;
      }
      const msg: ThrottleUpdate = {
        kind: 'throttle',
        name: typeof nameRaw === 'string' && nameRaw ? nameRaw : null,
        released: 'release' in data,
        functions,
      };
      if (typeof data.address === 'number') msg.address = data.address;
      if (typeof data.rosterEntry === 'string') msg.rosterEntry = data.rosterEntry;
      return msg;
    }
    default:
      return { kind: 'other', type: json.type };
  }
}

// ── Throttle state ──────────────────────────────────────────────────────────

export interface ThrottleState {
  /** released: nothing held; acquiring: request sent, awaiting JMRI's status; acquired: JMRI confirmed. */
  phase: 'released' | 'acquiring' | 'acquired';
  rosterEntry: string | null;
  address: number | null;
  functions: Record<number, boolean>;
  /** Last throttle-level error from JMRI (e.g. roster entry not found). */
  error: string | null;
}

export const initialThrottleState: ThrottleState = {
  phase: 'released', rosterEntry: null, address: null, functions: {}, error: null,
};

/** We sent an acquire. Function states are kept only when re-acquiring the same loco (reconnect). */
export function startAcquire(s: ThrottleState, rosterEntry: string): ThrottleState {
  const same = s.rosterEntry === rosterEntry;
  return {
    phase: 'acquiring',
    rosterEntry,
    address: same ? s.address : null,
    functions: same ? s.functions : {},
    error: null,
  };
}

/** We sent a release (train changed / cleared). */
export function releaseRequested(): ThrottleState {
  return initialThrottleState;
}

/** The socket dropped. Keep last-known loco and function states; they refresh on re-acquire. */
export function disconnected(s: ThrottleState): ThrottleState {
  return s.phase === 'released' ? s : { ...s, phase: 'released' };
}

/**
 * Applies a throttle message already filtered to our throttle name.
 *
 * - While acquiring, the release ack and any late function changes for the
 *   previous loco (same name) are ignored; the first full status (has
 *   `address`) confirms the acquire. JMRI processes one socket's messages in
 *   order, so a full status after our acquire is always for the new loco.
 * - When acquired, function changes merge in (incl. a driver's handheld).
 */
export function applyThrottleUpdate(s: ThrottleState, m: ThrottleUpdate): ThrottleState {
  if (m.released) {
    return s.phase === 'acquired' ? { ...s, phase: 'released', error: 'Throttle released by JMRI' } : s;
  }
  if (s.phase === 'acquiring') {
    if (m.address === undefined) return s;
    return { ...s, phase: 'acquired', address: m.address, functions: { ...s.functions, ...m.functions }, error: null };
  }
  if (s.phase === 'acquired') {
    if (Object.keys(m.functions).length === 0 && m.address === undefined) return s;
    return { ...s, address: m.address ?? s.address, functions: { ...s.functions, ...m.functions } };
  }
  return s;
}

/** JMRI error frames carry no throttle name; one arriving mid-acquire is taken as the acquire failing. */
export function applyError(s: ThrottleState, message: string): ThrottleState {
  return s.phase === 'acquiring' ? { ...s, phase: 'released', error: message } : { ...s, error: message };
}
