import type { JmriFunctionKey, JmriRosterEntry } from '../types';

/** wss://host/json/ → https://host/json. Returns null for empty/invalid/non-ws URLs. */
export function jmriHttpBase(wsUrl: string): string | null {
  const trimmed = (wsUrl ?? '').trim();
  if (!trimmed) return null;
  let u: URL;
  try { u = new URL(trimmed); } catch { return null; }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
  const proto = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${proto}//${u.host}${u.pathname}`.replace(/\/+$/, '');
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;

function normaliseKey(raw: unknown, idx: number): JmriFunctionKey | null {
  if (!isObj(raw)) return null;
  const key: JmriFunctionKey = { name: str(raw.name) ?? `F${idx}`, label: str(raw.label) ?? '' };
  if (typeof raw.lockable === 'boolean') key.lockable = raw.lockable;
  return key;
}

function normaliseEntry(raw: unknown): JmriRosterEntry | null {
  if (!isObj(raw)) return null;
  const d = isObj(raw.data) ? raw.data : raw;
  const name = str(d.name);
  if (!name) return null;
  const fk = Array.isArray(d.functionKeys) ? d.functionKeys : [];
  const entry: JmriRosterEntry = {
    name,
    address: str(d.address) ?? '',
    functionKeys: fk.map(normaliseKey).filter((k): k is JmriFunctionKey => k !== null),
  };
  const road = str(d.road);
  const number = str(d.number);
  if (road) entry.road = road;
  if (number) entry.number = number;
  return entry;
}

/** Accepts an array of entries / typed wrappers, `{roster:[...]}`, or an object map of entries. */
export function normaliseRoster(json: unknown): JmriRosterEntry[] {
  let items: unknown[] = [];
  if (Array.isArray(json)) items = json;
  else if (isObj(json)) {
    if (Array.isArray(json.roster)) items = json.roster;
    else if (isObj(json.roster)) items = Object.values(json.roster);
    else items = Object.values(json);
  }
  return items.map(normaliseEntry).filter((e): e is JmriRosterEntry => e !== null);
}

export async function fetchRoster(wsUrl: string, signal?: AbortSignal): Promise<JmriRosterEntry[]> {
  const base = jmriHttpBase(wsUrl);
  if (!base) throw new Error('JMRI URL not configured');
  const res = await fetch(`${base}/roster`, { signal });
  if (!res.ok) throw new Error(`JMRI roster request failed (${res.status})`);
  return normaliseRoster(await res.json());
}

/** Prefix matches first, then substring matches; alphabetical within each group. */
export function rankRosterMatches(entries: JmriRosterEntry[], query: string, limit = 8): JmriRosterEntry[] {
  const q = query.trim().toLowerCase();
  const byName = (a: JmriRosterEntry, b: JmriRosterEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (!q) return [...entries].sort(byName).slice(0, limit);
  const prefix: JmriRosterEntry[] = [];
  const contains: JmriRosterEntry[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (n.startsWith(q)) prefix.push(e);
    else if (n.includes(q)) contains.push(e);
  }
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit);
}
