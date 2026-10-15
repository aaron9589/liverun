// Pure helpers for the Boarding / Stats layout sections: validation (mirrors
// server/layout.js), the documented example, the preview and topic resolution.

import type { BoardingConfig, BoardingModel, BoardingRule, StatsConfig } from '../types';
import { expectedCount, mulberry32, parseHHMM, ruleFactor, sampleCount, type CountContext } from './boarding';

// ── Validation ─────────────────────────────────────────────────────────────

function numIn(v: unknown, min: number, max: number, label: string): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${label} must be a number`;
  if (v < min || v > max) return `${label} must be between ${min} and ${max}`;
  return null;
}

function rangeErr(v: [number, number], min: number, max: number, label: string): string | null {
  return numIn(v[0], min, max, `${label} min`) || numIn(v[1], min, max, `${label} max`)
    || (v[0] > v[1] ? `${label}: min must not exceed max` : null);
}

export function validateBoardingModel(m: BoardingModel, at: string): string | null {
  let e = numIn(m.max_passengers, 0, 1000, `${at} max passengers`) || numIn(m.spread, 0, 2, `${at} spread`);
  if (e) return e;
  if (m.demand_curve.length === 0) return `${at}: demand curve needs at least one point`;
  for (const [i, [t, f]] of m.demand_curve.entries()) {
    if (parseHHMM(t) === null) return `${at}: curve point ${i + 1} needs a time between 00:00 and 24:00`;
    if ((e = numIn(f, 0, Infinity, `${at}: curve point ${i + 1} factor`))) return e;
  }
  for (const [i, r] of m.rules.entries()) {
    const ra = `${at}: rule ${i + 1}${r.name.trim() ? ` "${r.name}"` : ''}`;
    if ((e = numIn(r.factor, 0, Infinity, `${ra} factor`))) return e;
    for (const k of ['from', 'to'] as const) {
      const v = r.when[k];
      if (v !== undefined && parseHHMM(v) === null) return `${ra}: ${k} must be HH:MM`;
    }
  }
  for (const k of ['origin', 'intermediate', 'terminus'] as const) {
    if ((e = numIn(m.position[k], 0, Infinity, `${at} ${k} factor`))) return e;
  }
  return null;
}

export function validateBoardingConfig(b: BoardingConfig): string | null {
  let e = validateBoardingModel(b, 'Boarding');
  if (e) return e;
  const nums: [keyof BoardingConfig, number, number, string][] = [
    ['tick_s', 0.1, 10, 'Tick'], ['jitter', 0, 1, 'Jitter'], ['flow_rate', 0.1, 100, 'Flow rate'],
    ['straggler_threshold', 0, 100, 'Straggler threshold'], ['straggler_rate', 0.1, 100, 'Straggler rate'],
    ['runner_chance', 0, 1, 'Runner chance'], ['start_delay_s', 0, 60, 'Start delay'], ['doil_off_delay_s', 0, 60, 'DOIL-off delay'],
  ];
  for (const [k, lo, hi, label] of nums) {
    if ((e = numIn(b[k], lo, hi, label))) return e;
  }
  if ((e = rangeErr(b.runner_count, 0, 100, 'Runner count'))) return e;
  if ((e = rangeErr(b.runner_delay_s, 0, 60, 'Runner delay'))) return e;
  return b.show_alighting ? validateBoardingModel(b.alighting, 'Alighting') : null;
}

export const TOPIC_PLACEHOLDERS = ['train', 'trainId', 'station'] as const;

export function validateStatsConfig(s: StatsConfig): string | null {
  if (s.topic.length > 200) return 'Topic must be 200 characters or fewer';
  for (const m of s.topic.matchAll(/\{([^{}]*)\}/g)) {
    if (!(TOPIC_PLACEHOLDERS as readonly string[]).includes(m[1])) return `Unknown placeholder {${m[1]}}`;
  }
  const bare = s.topic.replace(/\{[^{}]*\}/g, '');
  if (/[+#]/.test(bare)) return 'Topic must not contain MQTT wildcards (+ or #)';
  if (/[{}]/.test(bare)) return 'Topic has an unmatched brace';
  if (s.enabled && !s.topic.trim()) return 'A topic is required when stats are enabled';
  return null;
}

/** Replace placeholders with sanitised values (/ + # become _), as the guard panel does at publish time. */
export function resolveTopic(template: string, values: { train: string; trainId: string; station: string }): string {
  const clean = (v: string) => v.replace(/[/+#]/g, '_');
  return template.replace(/\{(train|trainId|station)\}/g, (_m, k: keyof typeof values) => clean(values[k]));
}

// ── Example (spec §8.1) ────────────────────────────────────────────────────

/** Documented Illawarra example. Never applied automatically: defaults stay neutral (D13). */
export const BOARDING_EXAMPLE: Pick<BoardingModel, 'demand_curve' | 'rules' | 'position'> = {
  demand_curve: [
    ['00:00', 0.02], ['05:00', 0.05], ['06:00', 0.4], ['07:00', 0.85], ['08:00', 1], ['09:00', 0.6], ['10:00', 0.35],
    ['14:30', 0.4], ['15:30', 0.6], ['16:30', 0.85], ['17:30', 1], ['18:30', 0.6], ['19:30', 0.3], ['22:00', 0.12], ['24:00', 0.02],
  ],
  rules: [
    { name: 'AM counter-peak', when: { direction: 'Down', from: '06:00', to: '09:30' }, factor: 0.45 },
    { name: 'PM counter-peak', when: { direction: 'Up', from: '15:30', to: '18:30' }, factor: 0.45 },
  ],
  position: { origin: 1.2, intermediate: 1, terminus: 0 },
};

// ── Preview ────────────────────────────────────────────────────────────────

/** Rules whose `when` all match (a factor-2 copy is used so factor 1 rules are detected too). */
export function matchingRules(rules: BoardingRule[], ctx: CountContext): BoardingRule[] {
  return rules.filter((r) => ruleFactor([{ ...r, factor: 2 }], ctx) === 2);
}

export interface BoardingPreview {
  expected: number;
  low: number;
  median: number;
  high: number;
  matched: BoardingRule[];
}

/** Expected count plus 10th / 50th / 90th percentile of `samples` draws (seeded, so stable). */
export function previewBoarding(model: BoardingModel, ctx: CountContext, samples = 500, seed = 1): BoardingPreview {
  const rng = mulberry32(seed);
  const xs = Array.from({ length: samples }, () => sampleCount(model, ctx, rng)).sort((a, b) => a - b);
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return {
    expected: expectedCount(model, ctx),
    low: at(0.1),
    median: at(0.5),
    high: at(0.9),
    matched: matchingRules(model.rules, ctx),
  };
}
