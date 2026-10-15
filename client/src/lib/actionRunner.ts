import type { ResolvedAction } from './profiles';

/**
 * Timing logic for train-profile actions (spec §7.3 modes) — framework-free so
 * it can be tested with fake timers. useProfileActions wraps one instance per
 * component so pending off-timers survive re-renders.
 */

export const DEFAULT_PULSE_MS = 500;
export const DEFAULT_ON_FOR_S = 5;

export interface ActionRunnerDeps {
  /** Sends F<fn>=on; false when nothing was sent (not connected / not acquired). */
  setFunction: (fn: number, on: boolean) => boolean;
  /** State JMRI last reported for F<fn> (undefined = unknown, treated as off). */
  getFunction: (fn: number) => boolean | undefined;
}

interface Active {
  fn: number;
  /** Pending off-timer (pulse / on_for). */
  timer: ReturnType<typeof setTimeout> | null;
  /** Turned on by a 'hold' press, awaiting release. */
  held: boolean;
}

export class ActionRunnerCore {
  /** Functions this runner turned on and still owes an "off" for, keyed by action. */
  private active = new Map<string, Active>();

  constructor(private deps: ActionRunnerDeps) {}

  /** Fires an action per its mode (or the press half of 'hold'). Returns whether anything was sent. */
  press(action: string, resolved: ResolvedAction): boolean {
    if (!resolved.ok) return false;
    // A repeat press cancels the previous press's pending off-timer first.
    this.cancel(action);
    const { fn, spec } = resolved;
    const set = this.deps.setFunction;
    switch (spec.mode) {
      case 'on': return set(fn, true);
      case 'off': return set(fn, false);
      case 'toggle': return set(fn, !(this.deps.getFunction(fn) ?? false));
      case 'hold': {
        const sent = set(fn, true);
        if (sent) this.active.set(action, { fn, timer: null, held: true });
        return sent;
      }
      case 'pulse':
      case 'on_for': {
        const ms = spec.mode === 'pulse'
          ? positive(spec.pulse_ms, DEFAULT_PULSE_MS)
          : positive(spec.duration_s, DEFAULT_ON_FOR_S) * 1000;
        const sent = set(fn, true);
        if (sent) {
          const entry: Active = { fn, timer: null, held: false };
          entry.timer = setTimeout(() => {
            if (this.active.get(action) !== entry) return;
            this.active.delete(action);
            set(fn, false);
          }, ms);
          this.active.set(action, entry);
        }
        return sent;
      }
    }
  }

  /** Release half of 'hold'; no-op for anything else. */
  release(action: string): void {
    const a = this.active.get(action);
    if (!a || !a.held) return;
    this.active.delete(action);
    this.deps.setFunction(a.fn, false);
  }

  /** Turns off everything this runner still owes an "off" for and clears all timers. */
  stopAll(): void {
    const entries = [...this.active.values()];
    this.active.clear();
    const off = new Set<number>();
    for (const a of entries) {
      if (a.timer) clearTimeout(a.timer);
      off.add(a.fn);
    }
    for (const fn of off) this.deps.setFunction(fn, false);
  }

  /** True while an action has a pending off-timer or is held (for UI / tests). */
  isActive(action: string): boolean {
    return this.active.has(action);
  }

  private cancel(action: string): void {
    const a = this.active.get(action);
    if (!a) return;
    if (a.timer) clearTimeout(a.timer);
    this.active.delete(action);
  }
}

function positive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
