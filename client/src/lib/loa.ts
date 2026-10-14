/**
 * Limit of Authority (spec §11): which sections apply to a train, element
 * states from the server's topic cache, and the per-train latch.
 *
 * Everything here is pure; the state is plain JSON so the guard panel can
 * persist it (localStorage per timetable + train, see hooks/useLoa.ts).
 * "Reset LOA for this train" = discard the stored state (`initialLoaState`).
 *
 * Usage:
 *   matches = sectionsForTrain(train, stations, layout.loa)
 *   ({ state, sections } = stepLoa(state, matches, values, { currentStopIndex }))   on every change
 *   ({ state, sections } = stepLoa(state, matches, values, { currentStopIndex, doorOpenStopIndex }))   on Doors Open
 *   ({ state, sections } = stepLoa(state, matches, values, { currentStopIndex, doorCloseStopIndex }))  on Doors Close
 *   warn = departureWarning(sections, doorStopIndex)                                on Doors Close
 *
 * Stop indices are indices into `train.stops` (every stop, timed or not), not
 * into `sequenceStops()`, which skips untimed stops. `routeStopIndex()`
 * converts the §6.3 current stop (`currentStop()` over `sequenceStops()`).
 *
 * Section phases:
 *   unknown   not granted; no granting element is definitely not clear, but
 *             at least one has no value yet (or the section has none)
 *   await     not granted; a granting element is 'stop', or an earlier
 *             occurrence of the same section is still open (see below)
 *   granted   latched: every "grants" element (all by default) was
 *             clear-or-caution in the same step (L1). It holds until a
 *             "revokes" element (tokens by default) goes 'stop' ('unknown'
 *             never revokes):
 *             before the train has left `from` that withdraws the authority
 *             (back to await); after, it ends it (complete), e.g. the staff
 *             handed back at the far end
 *   complete  unlatched after departure (above); or, as fallbacks, doors
 *             opened at `to` when nothing will unlatch (never granted, or no
 *             unlatch element), or the train moved on past `to` (doors opened
 *             or a stop pinned beyond it). Frozen: never re-evaluated
 *
 * "Left `from`": Doors Close at `from`, or any later Doors Open / pinned stop.
 * Never the fast clock: a late train would otherwise lose its authority.
 *
 * Only the first not-complete occurrence of each section id can be granted:
 * a later occurrence (the same section again on the way back out) shares its
 * elements, and would otherwise latch at the first occurrence's grant and stay
 * granted forever when it has no revoking element. Different sections may
 * latch ahead of the train (authority for the next section given early).
 */
import type { LoaCondition, LoaConfig, LoaElement, LoaSection, LoaValue, Station, Train } from '../types';
import { globMatchAny } from './glob';
import type { SeqStop } from './stops';

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
  v: 2;
  /** Train.id (the LiveRun id, not the JMRI train_id). */
  trainId: string;
  granted: string[];
  /** Sections whose `from` the train has left (Doors Close there, or any later door event / pin). */
  departed: string[];
  /**
   * Revoked before departure while every granting element was still clear: they
   * need a fresh all-clear (some granting element drops first) to grant again.
   */
  revoked: string[];
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

export interface LoaPosition {
  /** train.stops index of the §6.3 current stop (see routeStopIndex), or null when unknown. */
  currentStopIndex: number | null;
  /** Set only on the step for a Doors Open: the train.stops index the doors opened at. */
  doorOpenStopIndex?: number | null;
  /** Set only on the step for a Doors Close: the train.stops index the doors were opened at. */
  doorCloseStopIndex?: number | null;
}

export function initialLoaState(trainId: string): LoaTrainState {
  return { v: 2, trainId, granted: [], departed: [], revoked: [], complete: [] };
}

/** Accepts stored JSON only if it is a state for this train (v1 had no `departed`). */
export function parseLoaState(raw: unknown, trainId: string): LoaTrainState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { v?: unknown; trainId?: unknown; granted?: unknown; departed?: unknown; revoked?: unknown; complete?: unknown };
  const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if ((s.v !== 1 && s.v !== 2) || s.trainId !== trainId || !strings(s.granted) || !strings(s.complete)) return null;
  const departed = s.v === 2 && strings(s.departed) ? s.departed : [];
  const revoked = s.v === 2 && strings(s.revoked) ? s.revoked : [];
  return { v: 2, trainId, granted: s.granted, departed, revoked, complete: s.complete };
}

/** Whether any element can unlatch the section's authority (a selector counts if any option can). */
export function hasUnlatch(section: LoaSection): boolean {
  return section.elements.some((el) =>
    el.type === 'selector'
      ? Object.values(el.options ?? {}).some((o) => effectiveRevokes(o))
      : effectiveRevokes(el));
}

/**
 * One evaluation of every section against the current values and position.
 * Returns the same `state` object when nothing changed (so callers can skip
 * saving), and a view per match in route order.
 */
export function stepLoa(
  state: LoaTrainState,
  matches: SectionMatch[],
  values: Record<string, LoaValue>,
  pos: LoaPosition,
): { state: LoaTrainState; sections: SectionView[] } {
  const granted = new Set(state.granted);
  const departed = new Set(state.departed);
  const revoked = new Set(state.revoked);
  const complete = new Set(state.complete);
  let changed = false;
  const { currentStopIndex, doorOpenStopIndex, doorCloseStopIndex } = pos;
  // Section ids with an earlier not-complete occurrence: later ones can't latch yet.
  const openIds = new Set<string>();

  const sections: SectionView[] = matches.map((match) => {
    const elements = match.section.elements.map((el) => evaluateElement(el, values));
    // Only "grants" elements gate the grant; the others are shown (and may revoke) but never hold it up.
    const gating = elements.filter((e) => e.grants);
    let pending = gating.filter((e) => e.state === 'stop' || e.state === 'unknown');
    const view = (phase: SectionPhase): SectionView => ({ match, phase, elements, pending, current: false });

    if (complete.has(match.key)) return view('complete');
    const finish = (): SectionView => {
      complete.add(match.key);
      granted.delete(match.key);
      revoked.delete(match.key);
      changed = true;
      return view('complete');
    };

    // Fallbacks, so the panel never sticks on a section: the train has clearly
    // moved on past `to` (doors opened beyond it, or a stop beyond it pinned), or
    // doors opened at `to` and nothing will unlatch (never granted, or no
    // unlatch element). Otherwise a granted section waits for its unlatch.
    const beyond = (doorOpenStopIndex != null && doorOpenStopIndex > match.toIndex)
      || (currentStopIndex != null && currentStopIndex > match.toIndex);
    const atTo = doorOpenStopIndex != null && doorOpenStopIndex === match.toIndex;
    if (beyond || (atTo && !(granted.has(match.key) && hasUnlatch(match.section)))) return finish();

    if (!departed.has(match.key)) {
      const left = (doorCloseStopIndex != null && doorCloseStopIndex === match.fromIndex)
        || (doorOpenStopIndex != null && doorOpenStopIndex > match.fromIndex)
        || (currentStopIndex != null && currentStopIndex > match.fromIndex);
      if (left) { departed.add(match.key); changed = true; }
    }

    const firstOpen = !openIds.has(match.section.id);
    openIds.add(match.section.id);

    if (granted.has(match.key)) {
      if (!elements.some((e) => e.revokes && e.state === 'stop')) return view('granted');
      // An unlatch element went back to not clear: after the train has left
      // `from` that ends the authority (e.g. staff returned at the far end);
      // before, the authority was withdrawn and the section awaits again.
      if (departed.has(match.key)) return finish();
      granted.delete(match.key);
      if (pending.length === 0) revoked.add(match.key);
      changed = true;
    }
    // A revoke by an element that doesn't grant leaves the granting ones clear:
    // hold until one of them drops, so the old all-clear can't re-grant at once.
    if (revoked.has(match.key)) {
      if (pending.length > 0) { revoked.delete(match.key); changed = true; }
      else {
        // Name what revoked it; if that has cleared again, the granting elements must re-clear.
        const revokers = elements.filter((e) => e.revokes && e.state === 'stop');
        pending = revokers.length ? revokers : gating;
        return view('await');
      }
    }
    if (!granted.has(match.key) && firstOpen && gating.length > 0 && pending.length === 0) {
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
    ? { v: 2, trainId: state.trainId, granted: [...granted], departed: [...departed], revoked: [...revoked], complete: [...complete] }
    : state;
  return { state: next, sections };
}

/** The current section (first not complete), or null when none / all complete. */
export function currentSection(sections: SectionView[]): SectionView | null {
  return sections.find((s) => s.current) ?? null;
}

/**
 * Departure warning (spec §11.6, L2): doors closed at train.stops[stopIndex].
 * Returns the first not-complete section starting there that has no authority
 * ('await' or 'unknown': an element without a value is no proof of
 * authority), or null. Pass the stop the doors were opened at, not where the
 * clock is now. Whether to warn at all is `LoaConfig.warn_on_depart`.
 */
export function departureWarning(sections: SectionView[], stopIndex: number): SectionView | null {
  return sections.find((s) => s.match.fromIndex === stopIndex && (s.phase === 'await' || s.phase === 'unknown')) ?? null;
}

/**
 * train.stops index of the §6.3 current stop: `currentStop(seq, …).index` is an
 * index into `seq = sequenceStops(train)`. Returns null when there is no
 * current stop (index -1: no clock, or the run is over).
 */
export function routeStopIndex(train: Train, seq: SeqStop[], seqIndex: number): number | null {
  const s = seqIndex >= 0 ? seq[seqIndex] : undefined;
  if (!s) return null;
  const i = train.stops.indexOf(s.stop);
  if (i >= 0) return i;
  const byId = train.stops.findIndex((x) => x.id === s.stop.id);
  return byId >= 0 ? byId : null;
}

/** train.stops index of a stop id (e.g. the stop a door event was recorded at), or null. */
export function stopIndexOf(train: Train, stopId: string): number | null {
  const i = train.stops.findIndex((s) => s.id === stopId);
  return i >= 0 ? i : null;
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
