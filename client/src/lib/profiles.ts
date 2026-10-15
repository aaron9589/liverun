import type { FunctionKeyRef, JmriRosterEntry, ProfileFunction, TrainProfile } from '../types';
import { globMatchAny } from './glob';

/**
 * Picks the train profile for a train_id (spec §7.3): the first profile with a
 * matching glob wins; otherwise the first profile with no globs (fallback).
 */
export function resolveProfile(profiles: TrainProfile[], trainId: string | null | undefined): TrainProfile | null {
  const id = (trainId ?? '').trim();
  if (id) {
    const hit = profiles.find((p) => p.match.some((m) => m.trim() !== '') && globMatchAny(p.match, id));
    if (hit) return hit;
  }
  return profiles.find((p) => p.match.every((m) => m.trim() === '')) ?? null;
}

export type ActionSkipReason =
  /** The profile doesn't map this action — nothing to send. */
  | 'unmapped'
  /** The key is a roster label but the loco isn't in the roster (or no roster yet). */
  | 'no-roster-entry'
  /** The loco's roster entry has no function with that label. */
  | 'label-not-found'
  /** Malformed key (fn out of 0–68, blank label). */
  | 'bad-key';

export type ResolvedAction =
  | { ok: true; fn: number; spec: ProfileFunction }
  | { ok: false; reason: ActionSkipReason };

const MAX_FN = 68;

/** "F6" → 6; null if not a function name. */
export function parseFunctionName(name: string): number | null {
  const m = /^F(\d{1,2})$/i.exec(name.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n <= MAX_FN ? n : null;
}

function keyToFn(key: FunctionKeyRef, roster: JmriRosterEntry | null): number | ActionSkipReason {
  if ('fn' in key) return Number.isInteger(key.fn) && key.fn >= 0 && key.fn <= MAX_FN ? key.fn : 'bad-key';
  const label = key.label.trim().toLowerCase();
  if (!label) return 'bad-key';
  if (!roster) return 'no-roster-entry';
  const hit = roster.functionKeys.find((k) => k.label.trim().toLowerCase() === label);
  if (!hit) return 'label-not-found';
  return parseFunctionName(hit.name) ?? 'label-not-found';
}

/** Resolves a profile action to a concrete decoder function number for one loco. */
export function resolveAction(profile: TrainProfile | null, action: string, roster: JmriRosterEntry | null): ResolvedAction {
  const spec = profile?.functions[action];
  if (!spec) return { ok: false, reason: 'unmapped' };
  const fn = keyToFn(spec.key, roster);
  return typeof fn === 'number' ? { ok: true, fn, spec } : { ok: false, reason: fn };
}

/** Short human text for why an action won't drive JMRI. */
export function describeSkip(reason: ActionSkipReason): string {
  switch (reason) {
    case 'unmapped': return 'not mapped in profile';
    case 'no-roster-entry': return 'loco not in JMRI roster';
    case 'label-not-found': return 'function label not on this loco';
    case 'bad-key': return 'invalid function key';
  }
}
