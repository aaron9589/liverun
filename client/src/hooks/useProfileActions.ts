import { useCallback } from 'react';
import type { JmriRosterEntry, TrainProfile } from '../types';
import { resolveAction, type ResolvedAction } from '../lib/profiles';
import type { JmriThrottle } from './useJmriThrottle';

export interface ActionRunner {
  /** Resolve without sending (for UI chips / previews). */
  resolve: (action: string) => ResolvedAction;
  /**
   * Fire an action per its profile mode (on/off/toggle/pulse/on_for, or the
   * press half of 'hold'). A repeat press cancels that action's pending timers.
   * `sent` is false when unmapped/unresolvable or the throttle isn't acquired.
   */
  press: (action: string) => { resolved: ResolvedAction; sent: boolean };
  /** Release half of 'hold' mode (no-op for other modes). */
  release: (action: string) => void;
  /** Turn off anything this runner left on (pending pulses, on_for, held) and clear timers — call before changing train. */
  stopAll: () => void;
}

/**
 * Runs train-profile actions against a JMRI throttle (spec §7.2/§7.3).
 *
 * CONTRACT STUB — resolves but never sends. Phase 3A implements timing modes.
 */
export function useProfileActions(
  throttle: JmriThrottle,
  profile: TrainProfile | null,
  roster: JmriRosterEntry | null,
): ActionRunner {
  void throttle;
  const resolve = useCallback((action: string) => resolveAction(profile, action, roster), [profile, roster]);
  const press = useCallback((action: string) => ({ resolved: resolve(action), sent: false }), [resolve]);
  const noop = useCallback(() => {}, []);
  return { resolve, press, release: noop, stopAll: noop };
}
