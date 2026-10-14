import { describe, expect, it } from 'vitest';
import type { BoardingConfig, BoardingModel } from '../types';
import {
  alightingCount,
  createBoardingRun,
  demandAt,
  expectedCount,
  inWindow,
  mulberry32,
  parseHHMM,
  poisson,
  ruleFactor,
  sampleCount,
  type BoardingStep,
} from './boarding';
import { DEFAULT_LAYOUT } from './layoutDefaults';

const cfg: BoardingConfig = DEFAULT_LAYOUT.boarding;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Spec §8.1 Illawarra example, as test data only.
const illawarra: BoardingModel = {
  max_passengers: 60,
  spread: 0.15,
  demand_curve: [['00:00', 0.02], ['05:00', 0.05], ['06:00', 0.4], ['07:00', 0.85], ['08:00', 1], ['09:00', 0.6], ['10:00', 0.35],
    ['14:30', 0.4], ['15:30', 0.6], ['16:30', 0.85], ['17:30', 1], ['18:30', 0.6], ['19:30', 0.3], ['22:00', 0.12], ['24:00', 0.02]],
  rules: [
    { name: 'AM counter-peak', when: { direction: 'Down', from: '06:00', to: '09:30' }, factor: 0.45 },
    { name: 'PM counter-peak', when: { direction: 'Up', from: '15:30', to: '18:30' }, factor: 0.45 },
  ],
  position: { origin: 1.2, intermediate: 1, terminus: 0 },
};

describe('parseHHMM / demandAt', () => {
  it('parses times', () => {
    expect(parseHHMM('07:30')).toBe(450);
    expect(parseHHMM('24:00')).toBe(1440);
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('x')).toBeNull();
  });
  const curve: [string, number][] = [['06:00', 0], ['08:00', 1], ['24:00', 0.5]];
  it('hits exact points and interpolates', () => {
    expect(demandAt(curve, 480)).toBe(1);
    expect(demandAt(curve, 420)).toBeCloseTo(0.5);
    expect(demandAt(curve, 360)).toBe(0);
    expect(demandAt(curve, 1440)).toBeCloseTo(0.5) // 1440 wraps to 00:00 (wrap segment start)
  });
  it('wraps across midnight between last and first points', () => {
    // last 24:00=0.5 -> first 06:00=0 over 360 min: at 03:00 halfway
    expect(demandAt(curve, 180)).toBeCloseTo(0.25);
  });
  it('sorts unsorted input', () => {
    expect(demandAt([['08:00', 1], ['06:00', 0]], 420)).toBeCloseTo(0.5);
  });
  it('empty curve is 1; single point is constant', () => {
    expect(demandAt([], 100)).toBe(1);
    expect(demandAt([['12:00', 0.3]], 5)).toBe(0.3);
  });
});

describe('inWindow / ruleFactor', () => {
  it('handles normal and midnight-crossing windows', () => {
    expect(inWindow(600, 540, 660)).toBe(true);
    expect(inWindow(660, 540, 660)).toBe(false);
    expect(inWindow(23 * 60 + 30, 22 * 60, 2 * 60)).toBe(true);
    expect(inWindow(60, 22 * 60, 2 * 60)).toBe(true);
    expect(inWindow(12 * 60, 22 * 60, 2 * 60)).toBe(false);
  });
  const rules = illawarra.rules;
  it('matches globs case-insensitively and windows', () => {
    expect(ruleFactor(rules, { clockMinutes: 450, direction: 'down' })).toBe(0.45);
    expect(ruleFactor(rules, { clockMinutes: 450, direction: 'Up' })).toBe(1);
    expect(ruleFactor(rules, { clockMinutes: 600, direction: 'Down' })).toBe(1);
  });
  it('missing keys match anything; multiple rules multiply', () => {
    const rs = [
      { name: 'a', when: {}, factor: 2 },
      { name: 'b', when: { train_name: 'ci*' }, factor: 0.5 },
      { name: 'c', when: { train_id: '?1', from: '22:00', to: '02:00' }, factor: 3 },
    ];
    expect(ruleFactor(rs, { clockMinutes: 100 })).toBe(2);
    expect(ruleFactor(rs, { clockMinutes: 100, trainName: 'CIty' })).toBe(1);
    expect(ruleFactor(rs, { clockMinutes: 100, trainName: 'City', trainId: 'A1' })).toBe(3);
    expect(ruleFactor(rs, { clockMinutes: 720, trainName: 'City', trainId: 'A1' })).toBe(1);
  });
});

describe('expectedCount', () => {
  const m = cfg;
  it('neutral defaults', () => {
    expect(expectedCount(m, { clockMinutes: 700, position: 'intermediate' })).toBe(60);
    expect(expectedCount(m, { clockMinutes: 700, position: 'origin' })).toBe(60);
    expect(expectedCount(m, { clockMinutes: 700, position: 'terminus' })).toBe(0);
  });
  it('station weight and position factors apply', () => {
    expect(expectedCount(m, { clockMinutes: 700, position: 'intermediate', stationWeight: 0.5 })).toBe(30);
    expect(expectedCount(illawarra, { clockMinutes: 480, position: 'origin' })).toBeCloseTo(72);
  });
});

describe('sampleCount', () => {
  const ctx = { clockMinutes: 700, position: 'intermediate' as const };
  it('mean near expected, never negative', () => {
    const rng = mulberry32(1);
    const xs = Array.from({ length: 5000 }, () => sampleCount(cfg, ctx, rng));
    expect(Math.abs(mean(xs) - 60) / 60).toBeLessThan(0.03);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    const rng2 = mulberry32(2);
    const small = Array.from({ length: 2000 }, () => sampleCount({ ...cfg, max_passengers: 1 }, ctx, rng2));
    expect(Math.min(...small)).toBeGreaterThanOrEqual(0);
  });
  it('expected 0 gives 0', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) expect(sampleCount(cfg, { clockMinutes: 700, position: 'terminus' }, rng)).toBe(0);
  });
  it('Illawarra realism', () => {
    const rng = mulberry32(4);
    const peak = Array.from({ length: 3000 }, () =>
      sampleCount(illawarra, { clockMinutes: 450 + Math.floor(rng() * 60), direction: 'Up', position: 'intermediate' }, rng));
    expect(mean(peak)).toBeGreaterThan(40);
    const full = Array.from({ length: 3000 }, () =>
      sampleCount(illawarra, { clockMinutes: 450 + Math.floor(rng() * 60), direction: 'Up', position: 'intermediate', stationWeight: 1 }, rng));
    expect(mean(full)).toBeLessThan(90);
    const quiet = Array.from({ length: 3000 }, () =>
      sampleCount(illawarra, { clockMinutes: 600, direction: 'Up', stationWeight: 0.3, position: 'intermediate' }, rng));
    expect(mean(quiet)).toBeGreaterThan(5);
    expect(mean(quiet)).toBeLessThan(15);
  });
  it('alightingCount uses the alighting model', () => {
    const c: BoardingConfig = { ...cfg, alighting: { ...cfg.alighting, max_passengers: 20 } };
    const rng = mulberry32(5);
    const xs = Array.from({ length: 3000 }, () => alightingCount(c, { clockMinutes: 700, position: 'terminus' }, rng));
    expect(Math.abs(mean(xs) - 30)).toBeLessThan(1.5); // 20 × terminus 1.5
  });
});

describe('poisson', () => {
  it('mean approximates lambda', () => {
    for (const l of [0.5, 3, 12, 50]) {
      const rng = mulberry32(7);
      const xs = Array.from({ length: 6000 }, () => poisson(l, rng));
      expect(Math.abs(mean(xs) - l) / l).toBeLessThan(0.05);
    }
    expect(poisson(0, mulberry32(1))).toBe(0);
  });
});

function runAll(c: BoardingConfig, count: number, seed: number, demand = 1) {
  const rng = mulberry32(seed);
  const run = createBoardingRun(c, count, rng, demand);
  const steps: BoardingStep[] = [];
  for (let i = 0; i < 5000; i++) {
    const s = run.next();
    steps.push(s);
    if (s.delayMs === null) break;
  }
  return { run, steps };
}

describe('createBoardingRun', () => {
  it('always terminates and boards everyone (plus runners)', () => {
    for (let count = 0; count <= 200; count += 7) {
      for (let seed = 1; seed <= 10; seed++) {
        const { run, steps } = runAll(cfg, count, seed);
        const last = steps[steps.length - 1];
        expect(last.delayMs).toBeNull();
        expect(last.phase).toBe('done');
        expect(last.remaining).toBe(0);
        const runners = steps.reduce((a, s) => a + s.runnersArrived, 0);
        const boarded = steps.reduce((a, s) => a + s.boardedThisTick, 0);
        expect(boarded).toBe(count + runners);
        expect(run.close()).toEqual({ boarded: count + runners, leftBehind: 0, runners });
      }
    }
  });

  it('reaches stragglers phase and never decreases past zero', () => {
    let withStragglers = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { steps } = runAll(cfg, 60, seed);
      expect(steps.some((s) => s.phase === 'flow')).toBe(true);
      if (steps.some((s) => s.phase === 'stragglers')) withStragglers++;
      for (const s of steps) expect(s.remaining).toBeGreaterThanOrEqual(0);
    }
    expect(withStragglers).toBeGreaterThan(40);
  });

  it('runner group occurs near configured rate, at most once', () => {
    const c: BoardingConfig = { ...cfg, runner_chance: 0.2 };
    let groups = 0;
    const N = 1000;
    for (let seed = 1; seed <= N; seed++) {
      const { steps } = runAll(c, 20, seed * 13);
      const arrivals = steps.filter((s) => s.runnersArrived > 0);
      expect(arrivals.length).toBeLessThanOrEqual(1);
      if (arrivals.length) {
        groups++;
        const n = arrivals[0].runnersArrived;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(3);
        const i = steps.indexOf(arrivals[0]);
        expect(steps[i - 1].phase).toBe('waiting-runners');
        const d = steps[i - 1].delayMs as number;
        expect(d).toBeGreaterThanOrEqual(2000);
        expect(d).toBeLessThanOrEqual(6000);
      }
    }
    expect(groups / N).toBeGreaterThan(0.15);
    expect(groups / N).toBeLessThan(0.25);
  });

  it('demandNow scales runner chance; zero means none', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { steps } = runAll({ ...cfg, runner_chance: 1 }, 10, seed, 0);
      expect(steps.some((s) => s.runnersArrived > 0)).toBe(false);
    }
    const { steps } = runAll({ ...cfg, runner_chance: 1 }, 10, 1, 1);
    expect(steps.some((s) => s.runnersArrived > 0)).toBe(true);
  });

  it('close() mid-run reports leftBehind = remaining', () => {
    const rng = mulberry32(9);
    const run = createBoardingRun(cfg, 100, rng, 1);
    const a = run.next();
    const b = run.next();
    const r = run.close();
    expect(r.leftBehind).toBe(b.remaining);
    expect(r.boarded).toBe(a.boardedThisTick + b.boardedThisTick);
    expect(r.boarded + r.leftBehind).toBe(100);
    expect(run.next().phase).toBe('done');
    expect(run.next().delayMs).toBeNull();
  });

  it('delays are positive and within jitter bounds', () => {
    const { steps } = runAll({ ...cfg, runner_chance: 0 }, 80, 11);
    for (const s of steps) {
      if (s.delayMs === null) continue;
      const base = cfg.tick_s * 1000;
      if (s.phase === 'flow') {
        expect(s.delayMs).toBeGreaterThanOrEqual(Math.floor(base * (1 - cfg.jitter)));
        expect(s.delayMs).toBeLessThanOrEqual(Math.ceil(base * (1 + cfg.jitter)));
      } else {
        expect(s.delayMs).toBeGreaterThanOrEqual(Math.floor(base * 1.5 * (1 - cfg.jitter)));
        expect(s.delayMs).toBeLessThanOrEqual(Math.ceil(base * 4 * (1 + cfg.jitter)));
      }
    }
  });

  it('zero rates still terminate', () => {
    const { steps } = runAll({ ...cfg, flow_rate: 0, straggler_rate: 0, runner_chance: 0 }, 30, 2);
    expect(steps[steps.length - 1].phase).toBe('done');
  });
});
