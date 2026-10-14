/**
 * Limit of Authority (spec §11): which sections apply to a train, element
 * states from the server's topic cache, and the per-train latch.
 *
 * Driven ONLY by the safeworking elements (L6): doors, pinned stops and the
 * fast clock play no part. Everything here is pure; the state is plain JSON so
 * the guard panel can persist it (localStorage per timetable + train, see
 * hooks/useLoa.ts). There is no manual reset: LOA is governed entirely by
 * Control through the field elements.
 *
 * Usage:
 *   matches = sectionsForTrain(train, stations, layout.loa)
 *   ({ state, sections } = stepLoa(state, matches, values))   on every change
 *
 * Section phases:
 *   unknown   not granted; no granting element is definitely not clear, but
 *             at least one has no value yet (or the section has none)
 *   await     not granted; a granting element is 'stop', or an earlier
 *             occurrence of the same section is still open (see below)
 *   granted   latched: every "grants" element (all by default) was
 *             clear-or-caution in the same step (L1). Holds until a "revokes"
 *             element (tokens by default) goes 'stop' ('unknown' never revokes)
 *   complete  revoked: the authority is released (e.g. the staff sunk at the
 *             far end) and the panel moves on. Frozen: never re-granted, so a
 *             following train getting the same staff can't bring it back
 *
 * Only the first not-complete occurrence of each section id can be granted:
 * a later occurrence (the same section again on the way back out) shares its
 * elements, and would otherwise latch at the first occurrence's grant.
 * Different sections may latch ahead of the train (authority given early).
 */
import type { LoaCondition, LoaConfig, LoaElement, LoaSection, LoaValue, Station, Train } from '../types';
import { globMatchAny } from './glob';

/** Dot colour: green / amber / red / grey "?". */
export type ElementState = 'clear' | 'caution' | 'stop' | 'unknown';

export interface ElementView {
  element: LoaElement;
  /** The condition that applies: the element itself, or the selector's chosen option (null if that option is missing). */
  condition: LoaCondition | null;
  /** Selectors only: option key in use, and whether it came from the live selector value or `default`. */
  option?: string;
  optionFrom?: 'value' | 'default';
  /** Payload of the applied condition's topic, or null if none received yet. */
  value: string | null;
  state: ElementState;
  /** Effective `grants` (default true): counts toward the grant and the strip's "AWAIT:" list. */
  grants: boolean;
  /** Effective `revokes` (defaults: token → true, others → false). */
  revokes: boolean;
}

/**
 * State of one condition for a payload (undefined = no value yet → 'unknown').
 * Payloads are trimmed and compared against `clear` then `caution` globs
 * (case-insensitive, blank patterns ignored). Clear wins over caution.
 */
export function conditionState(cond: LoaCondition, value: string | undefined): ElementState {
  if (value === undefined) return 'unknown';
  const v = value.trim();
  if (globMatchAny(cond.clear ?? [], v)) return 'clear';
  if (globMatchAny(cond.caution ?? [], v)) return 'caution';
  return 'stop';
}

function effectiveRevokes(cond: LoaCondition | null): boolean {
  if (!cond) return false;
  return cond.revokes ?? cond.type === 'token';
}

function effectiveGrants(cond: LoaCondition | null): boolean {
  return cond ? cond.grants ?? true : true;
}

/** Option key for a selector payload: exact key first, then trimmed case-insensitive. */
function findOption(options: Record<string, LoaCondition>, value: string): string | null {
  if (Object.prototype.hasOwnProperty.call(options, value)) return value;
  const v = value.trim().toLowerCase();
  return Object.keys(options).find((k) => k.trim().toLowerCase() === v) ?? null;
}

/**
 * Evaluate an element (resolving selectors) against the topic cache.
 * A selector uses `default` until its topic has a value. A value that names no
 * option (e.g. a turnout reporting INCONSISTENT mid-throw) is not mapped to
 * `default`: the element is 'unknown' with `condition: null` and `option` set
 * to the raw value, so a moving turnout can never grant authority.
 */
export function evaluateElement(el: LoaElement, values: Record<string, LoaValue>): ElementView {
  if (el.type !== 'selector') {
    const v = values[el.topic]?.value;
    return { element: el, condition: el, value: v ?? null, state: conditionState(el, v), grants: effectiveGrants(el), revokes: effectiveRevokes(el) };
  }
  const options = el.options ?? {};
  const sel = values[el.topic]?.value;
  let option: string;
  let optionFrom: 'value' | 'default';
  if (sel === undefined) {
    option = el.default;
    optionFrom = 'default';
  } else {
    option = findOption(options, sel) ?? sel;
    optionFrom = 'value';
  }
  const condition = Object.prototype.hasOwnProperty.call(options, option) ? options[option] : null;
  if (!condition) return { element: el, condition: null, option, optionFrom, value: null, state: 'unknown', grants: true, revokes: false };
  const v = values[condition.topic]?.value;
  return {
    element: el, condition, option, optionFrom,
    value: v ?? null, state: conditionState(condition, v), grants: effectiveGrants(condition), revokes: effectiveRevokes(condition),
  };
}

/** Every topic an element watches (selector topic + all option topics). */
export function elementTopics(el: LoaElement): string[] {
  return el.type === 'selector' ? [el.topic, ...Object.values(el.options).map((o) => o.topic)] : [el.topic];
}

/** One occurrence of a section on a train's route. */
export interface SectionMatch {
  section: LoaSection;
  /** Stable state key: `${section.id}#${occurrence}` (occurrence counts from 0 along the route). */
  key: string;
  /** Indices into train.stops of the `from` and `to` stops. */
  fromIndex: number;
  toIndex: number;
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/** Whether `only` / `except` let this train have the section (globs on train_id and name; either matching counts). */
function trainAllowed(section: LoaSection, train: Train): boolean {
  const ids = [train.train_id, train.name].filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  const only = (section.only ?? []).filter((p) => p.trim() !== '');
  if (only.length && !ids.some((id) => globMatchAny(only, id))) return false;
  if (ids.some((id) => globMatchAny(section.except ?? [], id))) return false;
  return true;
}

/**
 * Sections that apply to a train, in route order (spec §11.2). Station names
 * match case-insensitively. Each `to` pairs with the most recent preceding,
 * not-yet-used `from`; `only`/`except` globs test train_id and train name.
 *
 * "Not yet used": the `from` must come after the previous pair's `to`, so
 * occurrences of one section never overlap. Sections whose `from` and `to`
 * name the same station are ignored. Ties (same `from` stop) keep config order.
 */
export function sectionsForTrain(train: Train, stations: Station[], config: LoaConfig): SectionMatch[] {
  const nameById = new Map(stations.map((s) => [s.id, norm(s.name)]));
  const route = train.stops.map((s) => nameById.get(s.station_id) ?? null);
  const found: { section: LoaSection; order: number; fromIndex: number; toIndex: number }[] = [];

  (config?.sections ?? []).forEach((section, order) => {
    const from = norm(section.from);
    const to = norm(section.to);
    if (!from || !to || from === to || !trainAllowed(section, train)) return;
    let lastFrom = -1;
    let lastTo = -1;
    route.forEach((name, i) => {
      if (name === from) lastFrom = i;
      else if (name === to && lastFrom > lastTo) {
        found.push({ section, order, fromIndex: lastFrom, toIndex: i });
        lastTo = i;
      }
    });
  });

  found.sort((a, b) => a.fromIndex - b.fromIndex || a.order - b.order || a.toIndex - b.toIndex);
  const seen = new Map<string, number>();
  return found.map(({ section, fromIndex, toIndex }) => {
    const n = seen.get(section.id) ?? 0;
    seen.set(section.id, n + 1);
    return { section, key: `${section.id}#${n}`, fromIndex, toIndex };
  });
}

// ── Latch (spec §11.4) ──────────────────────────────────────────────────────

export type SectionPhase = 'unknown' | 'await' | 'granted' | 'complete';

/** Persisted per device under timetable + train id. Keys are SectionMatch.key. */
export interface LoaTrainState {
  v: 3;
  /** Train.id (the LiveRun id, not the JMRI train_id). */
  trainId: string;
  granted: string[];
  complete: string[];
}

export interface SectionView {
  match: SectionMatch;
  phase: SectionPhase;
  /** Live element states, in config order (also for granted / complete sections). */
  elements: ElementView[];
  /** Granting elements not clear-or-caution ('stop' or 'unknown'): what the strip names after "AWAIT:". */
  pending: ElementView[];
  /** The first section on the route that isn't complete. */
  current: boolean;
}

export function initialLoaState(trainId: string): LoaTrainState {
  return { v: 3, trainId, granted: [], complete: [] };
}

/** Accepts stored JSON only if it is a state for this train (older versions keep their grants and completions). */
export function parseLoaState(raw: unknown, trainId: string): LoaTrainState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { v?: unknown; trainId?: unknown; granted?: unknown; complete?: unknown };
  const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (![1, 2, 3].includes(s.v as number) || s.trainId !== trainId || !strings(s.granted) || !strings(s.complete)) return null;
  return { v: 3, trainId, granted: s.granted, complete: s.complete };
}

/** Whether any element can revoke the section's authority (a selector counts if any option can). */
export function hasRevoke(section: LoaSection): boolean {
  return section.elements.some((el) =>
    el.type === 'selector'
      ? Object.values(el.options ?? {}).some((o) => effectiveRevokes(o))
      : effectiveRevokes(el));
}

/**
 * One evaluation of every section against the current topic values. Returns
 * the same `state` object when nothing changed (so callers can skip saving),
 * and a view per match in route order.
 */
export function stepLoa(
  state: LoaTrainState,
  matches: SectionMatch[],
  values: Record<string, LoaValue>,
): { state: LoaTrainState; sections: SectionView[] } {
  const granted = new Set(state.granted);
  const complete = new Set(state.complete);
  let changed = false;
  // Section ids with an earlier not-complete occurrence: later ones can't latch yet.
  const openIds = new Set<string>();

  const sections: SectionView[] = matches.map((match) => {
    const elements = match.section.elements.map((el) => evaluateElement(el, values));
    // Only "grants" elements gate the grant; the others are shown (and may revoke) but never hold it up.
    const gating = elements.filter((e) => e.grants);
    const pending = gating.filter((e) => e.state === 'stop' || e.state === 'unknown');
    const view = (phase: SectionPhase): SectionView => ({ match, phase, elements, pending, current: false });

    if (complete.has(match.key)) return view('complete');
    const firstOpen = !openIds.has(match.section.id);
    openIds.add(match.section.id);

    if (granted.has(match.key)) {
      if (!elements.some((e) => e.revokes && e.state === 'stop')) return view('granted');
      // Revoked: the authority is released and the section is done.
      granted.delete(match.key);
      complete.add(match.key);
      changed = true;
      return view('complete');
    }
    if (firstOpen && gating.length > 0 && pending.length === 0) {
      granted.add(match.key);
      changed = true;
      return view('granted');
    }
    if (!firstOpen || gating.some((e) => e.state === 'stop')) return view('await');
    return view('unknown');
  });

  const cur = sections.find((s) => s.phase !== 'complete');
  if (cur) cur.current = true;
  const next: LoaTrainState = changed
    ? { v: 3, trainId: state.trainId, granted: [...granted], complete: [...complete] }
    : state;
  return { state: next, sections };
}

/** The current section (first not complete), or null when none / all complete. */
export function currentSection(sections: SectionView[]): SectionView | null {
  return sections.find((s) => s.current) ?? null;
}

/** a and b hold the same value received at the same time. */
const sameLoaValue = (a: LoaValue | undefined, b: LoaValue): boolean => !!a && a.value === b.value && a.at === b.at;

/**
 * Applies a sync 'loa-values' message to the held values: full replaces,
 * otherwise merge. Returns prev itself when nothing actually changed, so
 * consumers' memos stay put.
 */
export function applyLoaValues(
  prev: Record<string, LoaValue>,
  msg: { values: Record<string, LoaValue>; full: boolean },
): Record<string, LoaValue> {
  const incoming = msg.values ?? {};
  const keys = Object.keys(incoming);
  if (msg.full) {
    const same = keys.length === Object.keys(prev).length && keys.every((k) => sameLoaValue(prev[k], incoming[k]));
    return same ? prev : { ...incoming };
  }
  if (keys.every((k) => sameLoaValue(prev[k], incoming[k]))) return prev;
  return { ...prev, ...incoming };
}
