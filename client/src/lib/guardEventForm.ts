// Planner-side editing model for guard event placements (spec §10.5).
// Pure helpers: placement <-> form state, and validation mirroring server/events.js.

import type { GuardEventDef, GuardEventKind, GuardEventPlacement, StationTrigger } from '../types';

export const INLINE = '';
export const MAX_MESSAGE = 500;

/** Editable string/number state for one placement. Strings so half-typed numbers survive. */
export interface PlacementForm {
  id: string;
  /** Library event id, or '' for an inline event. */
  event: string;
  /** Inline events only. */
  kind: GuardEventKind;
  /** One message per line: the inline wording, or an optional override for a library event. */
  messagesText: string;
  probabilityPct: string;
  trigger: StationTrigger;
  delayMin: string;
  delayMax: string;
  atMinPct: string;
  atMaxPct: string;
}

/** crypto.randomUUID needs a secure context; the app is often served over plain-HTTP LAN. */
export function newPlacementId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function newPlacementForm(id: string, library: GuardEventDef[]): PlacementForm {
  const first = library[0];
  return {
    id,
    event: first ? first.id : INLINE,
    kind: first?.kind ?? 'station',
    messagesText: '',
    probabilityPct: '100',
    trigger: 'door_open',
    delayMin: '0',
    delayMax: '20',
    atMinPct: '20',
    atMaxPct: '80',
  };
}

export function splitLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The kind that applies to a placement: the library definition's, or the inline choice. Null if the library id is unknown. */
export function effectiveKind(f: PlacementForm, library: GuardEventDef[]): GuardEventKind | null {
  if (f.event === INLINE) return f.kind;
  return library.find((d) => d.id === f.event)?.kind ?? null;
}

export function toForm(p: GuardEventPlacement, library: GuardEventDef[]): PlacementForm {
  const def = p.event ? library.find((d) => d.id === p.event) : undefined;
  const kind: GuardEventKind = p.kind ?? def?.kind ?? (p.at ? 'enroute' : 'station');
  return {
    id: p.id,
    event: p.event ?? INLINE,
    kind,
    messagesText: (p.messages ?? []).join('\n'),
    probabilityPct: String(Math.round(p.probability * 1000) / 10),
    trigger: p.trigger ?? 'door_open',
    delayMin: String(p.delay_s?.[0] ?? 0),
    delayMax: String(p.delay_s?.[1] ?? 20),
    atMinPct: String(Math.round((p.at?.[0] ?? 0.2) * 1000) / 10),
    atMaxPct: String(Math.round((p.at?.[1] ?? 0.8) * 1000) / 10),
  };
}

function num(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

/** Error message for a form row, or null when it can be saved. */
export function validateForm(f: PlacementForm, library: GuardEventDef[]): string | null {
  const lines = splitLines(f.messagesText);
  if (f.event === INLINE) {
    if (lines.length === 0) return 'Inline event needs at least one message';
  } else if (!library.some((d) => d.id === f.event)) {
    return `Library event "${f.event}" no longer exists`;
  }
  if (lines.some((l) => l.length > MAX_MESSAGE)) return `Messages must be ${MAX_MESSAGE} characters or fewer`;
  const prob = num(f.probabilityPct);
  if (!Number.isFinite(prob) || prob < 0 || prob > 100) return 'Probability must be 0-100%';
  const kind = effectiveKind(f, library);
  if (kind === 'station') {
    const lo = num(f.delayMin);
    const hi = num(f.delayMax);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 600 || hi < 0 || lo > 600) return 'Delay must be 0-600 seconds';
    if (lo > hi) return 'Delay minimum must not exceed maximum';
  } else if (kind === 'enroute') {
    const lo = num(f.atMinPct);
    const hi = num(f.atMaxPct);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 100 || hi < 0 || lo > 100) return 'Position must be 0-100%';
    if (lo > hi) return 'Position minimum must not exceed maximum';
  }
  return null;
}

/** Placement to send/store. Assumes validateForm returned null. */
export function fromForm(f: PlacementForm, library: GuardEventDef[]): GuardEventPlacement {
  const lines = splitLines(f.messagesText);
  const kind = effectiveKind(f, library);
  const out: GuardEventPlacement = { id: f.id, probability: Math.round(num(f.probabilityPct) * 10) / 1000 };
  if (f.event === INLINE) {
    out.kind = f.kind;
    out.messages = lines;
  } else {
    out.event = f.event;
    if (lines.length > 0) out.messages = lines;
  }
  if (kind === 'enroute') {
    out.at = [num(f.atMinPct) / 100, num(f.atMaxPct) / 100];
  } else if (kind === 'station') {
    out.trigger = f.trigger;
    out.delay_s = [num(f.delayMin), num(f.delayMax)];
  }
  return out;
}

/** Placement ids on a stop must be unique; returns the first problem across rows, or null. */
export function validateStopForms(forms: PlacementForm[], library: GuardEventDef[]): string | null {
  const seen = new Set<string>();
  for (const f of forms) {
    if (seen.has(f.id)) return 'Duplicate placement id';
    seen.add(f.id);
    const e = validateForm(f, library);
    if (e) return e;
  }
  return null;
}

/** Placements across all trains in a timetable that reference a library event id. */
export function countPlacementsFor(
  trains: { stops: { guard_events?: GuardEventPlacement[] }[] }[],
  eventId: string,
): number {
  let n = 0;
  for (const t of trains) for (const s of t.stops) for (const p of s.guard_events ?? []) if (p.event === eventId) n++;
  return n;
}

/** Free-text custom action names used by train profiles (everything except the built-in three). */
export function customActionNames(profiles: { functions: Record<string, unknown> }[]): string[] {
  const builtin = new Set(['door_open', 'door_close', 'bell']);
  const names = new Set<string>();
  for (const p of profiles) for (const k of Object.keys(p.functions)) if (!builtin.has(k)) names.add(k);
  return [...names].sort();
}

// ── Library validation (mirrors server/events.js validateEventsConfig) ──

const EVENT_ID_RE = /^[a-z0-9_-]+$/;
const ACTION_RE = /^[a-z0-9_]{1,40}$/;

export function validateEventsLibrary(
  ev: { library: GuardEventDef[]; publish_topic: string },
  soundNameError: (n: string) => string | null,
): string | null {
  const seen = new Set<string>();
  for (const [i, d] of ev.library.entries()) {
    const at = `Event ${i + 1}${d.name.trim() ? ` "${d.name}"` : ''}`;
    if (!EVENT_ID_RE.test(d.id)) return `${at}: id must be non-empty and use only a-z, 0-9, - and _`;
    if (seen.has(d.id)) return `${at}: id "${d.id}" is duplicated`;
    seen.add(d.id);
    if (!d.name.trim()) return `${at}: name is required`;
    const msgs = d.messages;
    if (msgs.length === 0 || msgs.some((m) => !m.trim())) return `${at}: needs at least one non-empty message`;
    if (msgs.some((m) => m.length > MAX_MESSAGE)) return `${at}: messages must be ${MAX_MESSAGE} characters or fewer`;
    if (d.sound !== '' && soundNameError(d.sound)) return `${at}: invalid sound`;
    if (d.action && !ACTION_RE.test(d.action)) return `${at}: action must be 1-40 characters of a-z, 0-9, _`;
  }
  const t = ev.publish_topic;
  if (t.length > 200) return 'Publish topic must be 200 characters or fewer';
  if (/[+#]/.test(t)) return 'Publish topic must not contain MQTT wildcards (+ or #)';
  return null;
}
