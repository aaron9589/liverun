// Passenger boarding engine (spec §8). Pure: no timers, no DOM, no Math.random.
// Every number comes from the config passed in (D13); the UI drives a run with setTimeout.

import type { BoardingConfig, BoardingModel, BoardingRule } from '../types';
import { globMatch } from './glob';

export type Rng = () => number;
export type StopPosition = 'origin' | 'intermediate' | 'terminus';

const DAY = 1440;

/** Seeded RNG (mulberry32) returning floats in [0,1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "HH:MM" -> minutes since midnight ("24:00" -> 1440); null if malformed. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/**
 * Demand factor at a clock time: piecewise-linear over the curve. The curve is sorted
 * here, and the stretch between the last and first points wraps across midnight.
 * Empty curve -> 1; unparseable points are ignored.
 */
export function demandAt(curve: [string, number][], clockMinutes: number): number {
  const pts = curve
    .map(([t, v]) => [parseHHMM(t), v] as const)
    .filter((p): p is readonly [number, number] => p[0] !== null)
    .sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return 1;
  if (pts.length === 1) return pts[0][1];
  const c = ((clockMinutes % DAY) + DAY) % DAY;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (c >= first[0] && c <= last[0]) {
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i];
      if (c <= t1) {
        const [t0, v0] = pts[i - 1];
        return t1 === t0 ? v1 : v0 + ((v1 - v0) * (c - t0)) / (t1 - t0);
      }
    }
  }
  // Wrap segment: last point (today) -> first point (tomorrow).
  const span = first[0] + DAY - last[0];
  if (span <= 0) return first[1];
  const pos = c > last[0] ? c - last[0] : c + DAY - last[0];
  return last[1] + ((first[1] - last[1]) * pos) / span;
}

/** True if clock lies in [from, to); the window may cross midnight. from === to matches everything. */
export function inWindow(clock: number, from: number, to: number): boolean {
  const c = ((clock % DAY) + DAY) % DAY;
  const f = from % DAY;
  const t = to % DAY;
  if (f === t) return true;
  return f < t ? c >= f && c < t : c >= f || c < t;
}

export interface RuleContext {
  clockMinutes: number;
  direction?: string;
  trainId?: string;
  trainName?: string;
}

function textMatch(pattern: string | undefined, value: string | undefined): boolean {
  if (pattern === undefined || pattern === '') return true;
  return globMatch(pattern.toLowerCase(), (value ?? '').toLowerCase());
}

/** Product of `factor` over every rule whose `when` keys all match. Missing keys match anything. */
export function ruleFactor(rules: BoardingRule[], ctx: RuleContext): number {
  let product = 1;
  for (const r of rules) {
    const w = r.when;
    if (!textMatch(w.direction, ctx.direction)) continue;
    if (!textMatch(w.train_id, ctx.trainId)) continue;
    if (!textMatch(w.train_name, ctx.trainName)) continue;
    if (w.from !== undefined || w.to !== undefined) {
      const from = w.from !== undefined ? parseHHMM(w.from) : 0;
      const to = w.to !== undefined ? parseHHMM(w.to) : DAY;
      if (from === null || to === null) continue;
      if (!inWindow(ctx.clockMinutes, from, to)) continue;
    }
    product *= r.factor;
  }
  return product;
}

export interface CountContext extends RuleContext {
  /** Station.boarding_weight (default 1). */
  stationWeight?: number;
  position: StopPosition;
}

/** Expected passengers: max × demand × Π rules × stationWeight × position factor. */
export function expectedCount(model: BoardingModel, ctx: CountContext): number {
  const e =
    model.max_passengers *
    demandAt(model.demand_curve, ctx.clockMinutes) *
    ruleFactor(model.rules, ctx) *
    (ctx.stationWeight ?? 1) *
    model.position[ctx.position];
  return Math.max(0, e);
}

function normal(rng: Rng): number {
  const u1 = 1 - rng(); // (0,1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Random count: round(max(0, expected + N(0, √expected + spread·expected))). Expected 0 -> 0. */
export function sampleCount(model: BoardingModel, ctx: CountContext, rng: Rng): number {
  const e = expectedCount(model, ctx);
  if (e <= 0) return 0;
  const sd = Math.sqrt(e) + model.spread * e;
  return Math.round(Math.max(0, e + sd * normal(rng)));
}

/** Passengers alighting, using the config's own `alighting` model. */
export function alightingCount(config: BoardingConfig, ctx: CountContext, rng: Rng): number {
  return sampleCount(config.alighting, ctx, rng);
}

/** Poisson sample: Knuth for λ ≤ 30, rounded normal approximation above. */
export function poisson(lambda: number, rng: Rng): number {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export type BoardingPhase = 'flow' | 'stragglers' | 'waiting-runners' | 'done';

export interface BoardingStep {
  remaining: number;
  boardedThisTick: number;
  runnersArrived: number;
  phase: BoardingPhase;
  /** Ms until the UI should call next() again; null = finished, schedule nothing. */
  delayMs: number | null;
}

export interface BoardingCloseResult {
  boarded: number;
  leftBehind: number;
  runners: number;
}

export interface BoardingRun {
  next(): BoardingStep;
  close(): BoardingCloseResult;
}

/** Straggler gaps are a uniform 1.5–4 × tick_s (then jitter applied). */
export const STRAGGLER_GAP_MIN = 1.5;
export const STRAGGLER_GAP_MAX = 4;

/**
 * Boarding run-down state machine.
 * - flow: each tick boards Poisson(flow_rate) while remaining > straggler_threshold.
 * - stragglers: Poisson(straggler_rate) per tick with longer gaps.
 * - when remaining hits 0, once per run, with probability runner_chance × demandNow a
 *   runner group is scheduled ('waiting-runners'); on arrival remaining rises by the group
 *   size (runnersArrived > 0) and they board via straggler flow.
 * A rate of 0 still boards one per tick so a run can't stall.
 */
export function createBoardingRun(
  config: BoardingConfig,
  initialCount: number,
  rng: Rng,
  demandNow: number,
): BoardingRun {
  let remaining = Math.max(0, Math.round(initialCount));
  let boarded = 0;
  let runnersTotal = 0;
  let runnerDecided = false;
  let runnerPending: number | null = null;
  let finished = false;

  const range = ([lo, hi]: [number, number]) => lo + rng() * (hi - lo);
  const jittered = (s: number) => Math.max(1, Math.round(s * 1000 * (1 + (rng() * 2 - 1) * config.jitter)));
  const board = (rate: number) => {
    const n = Math.min(remaining, rate > 0 ? poisson(rate, rng) : 1);
    remaining -= n;
    boarded += n;
    return n;
  };
  const done = (n: number): BoardingStep => ({
    remaining,
    boardedThisTick: n,
    runnersArrived: 0,
    phase: 'done',
    delayMs: null,
  });

  /** Remaining just reached 0: maybe schedule one runner group, else finish. */
  const afterEmpty = (n: number): BoardingStep => {
    if (!runnerDecided) {
      runnerDecided = true;
      if (rng() < config.runner_chance * demandNow) {
        const [lo, hi] = config.runner_count;
        runnerPending = Math.max(1, lo + Math.floor(rng() * (hi - lo + 1)));
        return {
          remaining,
          boardedThisTick: n,
          runnersArrived: 0,
          phase: 'waiting-runners',
          delayMs: Math.max(1, Math.round(range(config.runner_delay_s) * 1000)),
        };
      }
    }
    finished = true;
    return done(n);
  };

  return {
    next() {
      if (finished) return done(0);

      if (runnerPending !== null) {
        const n = runnerPending;
        runnerPending = null;
        remaining += n;
        runnersTotal += n;
        return {
          remaining,
          boardedThisTick: 0,
          runnersArrived: n,
          phase: 'stragglers',
          delayMs: jittered(config.tick_s * range([STRAGGLER_GAP_MIN, STRAGGLER_GAP_MAX])),
        };
      }

      if (remaining === 0) return afterEmpty(0);

      const straggling = remaining <= config.straggler_threshold;
      const n = board(straggling ? config.straggler_rate : config.flow_rate);
      if (remaining === 0) return afterEmpty(n);
      const gap = straggling ? range([STRAGGLER_GAP_MIN, STRAGGLER_GAP_MAX]) : 1;
      return {
        remaining,
        boardedThisTick: n,
        runnersArrived: 0,
        phase: straggling ? 'stragglers' : 'flow',
        delayMs: jittered(config.tick_s * gap),
      };
    },

    close() {
      finished = true;
      runnerPending = null;
      return { boarded, leftBehind: remaining, runners: runnersTotal };
    },
  };
}
