import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { JmriRosterEntry, TrainProfile } from '../types';
import { resolveAction, type ResolvedAction } from '../lib/profiles';
import { ActionRunnerCore } from '../lib/actionRunner';
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
 * Runs train-profile actions against a JMRI throttle (spec §7.2/§7.3); timing
 * lives in lib/actionRunner.ts. One runner instance per component, so pending
 * off-timers survive re-renders and always use the latest throttle.
 *
 * stopAll() also runs automatically on unmount, on pagehide (registered first, so
 * before useJmriThrottle releases) and when the roster entry or profile
 * changes — but callers should still call it before switching train.
 */
export function useProfileActions(
  throttle: JmriThrottle,
  profile: TrainProfile | null,
  roster: JmriRosterEntry | null,
): ActionRunner {
  const throttleRef = useRef(throttle);
  throttleRef.current = throttle;

  const coreRef = useRef<ActionRunnerCore | null>(null);
  if (!coreRef.current) {
    coreRef.current = new ActionRunnerCore({
      setFunction: (fn, on) => throttleRef.current.setFunction(fn, on),
      getFunction: (fn) => throttleRef.current.functions[fn],
    });
  }
  const core = coreRef.current;

  const resolve = useCallback((action: string) => resolveAction(profile, action, roster), [profile, roster]);
  const press = useCallback((action: string) => {
    const resolved = resolve(action);
    return { resolved, sent: core.press(action, resolved) };
  }, [resolve, core]);
  const release = useCallback((action: string) => core.release(action), [core]);
  const stopAll = useCallback(() => core.stopAll(), [core]);

  // Loco / profile changed or unmounting: turn off what we left on (the
  // throttle hook releases after this, so the offs reach the old loco).
  const rosterName = roster?.name ?? null;
  const profileId = profile?.id ?? null;
  useEffect(() => () => core.stopAll(), [core, rosterName, profileId]);

  // Layout effect + capture: registered before useJmriThrottle's (passive)
  // pagehide listener, so our "off"s go out before it releases the throttle.
  useLayoutEffect(() => {
    const onHide = () => core.stopAll();
    window.addEventListener('pagehide', onHide, { capture: true });
    return () => window.removeEventListener('pagehide', onHide, { capture: true });
  }, [core]);

  return useMemo(() => ({ resolve, press, release, stopAll }), [resolve, press, release, stopAll]);
}
