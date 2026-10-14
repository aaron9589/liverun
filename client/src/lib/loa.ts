/**
 * Limit of Authority (spec §11): which sections apply to a train, element
 * states from the server's topic cache, and the per-train latch.
 *
 * CONTRACT (phase 6 wave 0): signatures are fixed; bodies are stubs until 6A.
 * The LOA editor preview (6B) and the guard panel (6C) build against these.
 */
import type { LoaCondition, LoaConfig, LoaElement, LoaSection, LoaValue, Station, Train } from '../types';

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
  /** Effective `revokes` (defaults: token → true, others → false). */
  revokes: boolean;
}

/** State of one condition for a payload (undefined = no value yet → 'unknown'). Clear wins over caution. */
export function conditionState(cond: LoaCondition, value: string | undefined): ElementState {
  void cond; void value;
  return 'unknown';
}

/** Evaluate an element (resolving selectors) against the topic cache. */
export function evaluateElement(el: LoaElement, values: Record<string, LoaValue>): ElementView {
  void values;
  return { element: el, condition: el.type === 'selector' ? null : el, value: null, state: 'unknown', revokes: false };
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

/**
 * Sections that apply to a train, in route order (spec §11.2). Station names
 * match case-insensitively. Each `to` pairs with the most recent preceding,
 * not-yet-used `from`; `only`/`except` globs test train_id and train name.
 */
export function sectionsForTrain(train: Train, stations: Station[], config: LoaConfig): SectionMatch[] {
  void train; void stations; void config;
  return [];
}
