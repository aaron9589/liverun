import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT } from './layoutDefaults';
import {
  BOARDING_EXAMPLE, matchingRules, previewBoarding, resolveTopic, validateBoardingConfig, validateStatsConfig,
} from './boardingSettings';

const clone = <T,>(v: T): T => structuredClone(v);

describe('validateBoardingConfig', () => {
  it('accepts the neutral defaults and the example', () => {
    expect(validateBoardingConfig(DEFAULT_LAYOUT.boarding)).toBeNull();
    expect(validateBoardingConfig({ ...clone(DEFAULT_LAYOUT.boarding), ...clone(BOARDING_EXAMPLE) })).toBeNull();
  });
  it('rejects out-of-range and malformed values', () => {
    const b = () => clone(DEFAULT_LAYOUT.boarding);
    expect(validateBoardingConfig({ ...b(), max_passengers: 2000 })).toMatch(/max passengers/);
    expect(validateBoardingConfig({ ...b(), tick_s: 0 })).toMatch(/Tick/);
    expect(validateBoardingConfig({ ...b(), runner_count: [3, 1] })).toMatch(/min must not exceed/);
    expect(validateBoardingConfig({ ...b(), demand_curve: [] })).toMatch(/at least one/);
    expect(validateBoardingConfig({ ...b(), demand_curve: [['25:00', 1]] })).toMatch(/00:00 and 24:00/);
    expect(validateBoardingConfig({ ...b(), rules: [{ name: 'x', when: { from: 'zz' }, factor: 1 }] })).toMatch(/from must be HH:MM/);
    expect(validateBoardingConfig({ ...b(), rules: [{ name: 'x', when: {}, factor: -1 }] })).toMatch(/factor/);
  });
  it('only validates alighting when shown', () => {
    const b = clone(DEFAULT_LAYOUT.boarding);
    b.alighting.max_passengers = 5000;
    expect(validateBoardingConfig(b)).toBeNull();
    expect(validateBoardingConfig({ ...b, show_alighting: true })).toMatch(/Alighting/);
  });
});

describe('validateStatsConfig', () => {
  const s = DEFAULT_LAYOUT.stats;
  it('mirrors the server rules', () => {
    expect(validateStatsConfig(s)).toBeNull();
    expect(validateStatsConfig({ ...s, enabled: true })).toMatch(/required/);
    expect(validateStatsConfig({ ...s, topic: 'a/+/b' })).toMatch(/wildcards/);
    expect(validateStatsConfig({ ...s, topic: 'a/{nope}' })).toMatch(/Unknown placeholder/);
    expect(validateStatsConfig({ ...s, topic: 'a/{train' })).toMatch(/unmatched/);
    expect(validateStatsConfig({ ...s, enabled: true, topic: 'trains/{train}/{trainId}/{station}' })).toBeNull();
  });
});

describe('resolveTopic', () => {
  it('substitutes and sanitises', () => {
    expect(resolveTopic('t/{train}/{station}', { train: 'SL21 a/b', trainId: '1', station: 'C#1+' })).toBe('t/SL21 a_b/C_1_');
  });
});

describe('preview', () => {
  const model = { ...clone(DEFAULT_LAYOUT.boarding), ...clone(BOARDING_EXAMPLE) };
  it('finds matching rules including factor 1', () => {
    const ctx = { clockMinutes: 7 * 60 + 45, direction: 'Down', position: 'intermediate' as const };
    expect(matchingRules(model.rules, ctx).map((r) => r.name)).toEqual(['AM counter-peak']);
    expect(matchingRules([{ name: 'n', when: {}, factor: 1 }], ctx)).toHaveLength(1);
  });
  it('gives an ordered range around the expectation', () => {
    const p = previewBoarding(model, { clockMinutes: 7 * 60 + 45, direction: 'Up', position: 'intermediate' });
    expect(p.expected).toBeGreaterThan(40);
    expect(p.low).toBeLessThanOrEqual(p.median);
    expect(p.median).toBeLessThanOrEqual(p.high);
    expect(p.high).toBeGreaterThan(p.low);
  });
});
