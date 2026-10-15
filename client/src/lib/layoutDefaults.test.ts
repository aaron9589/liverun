import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { DEFAULT_LAYOUT, mergeLayoutPatch } from './layoutDefaults';

// Keeps the client fallback in step with the server's LAYOUT_DEFAULTS.
describe('DEFAULT_LAYOUT', () => {
  it('matches server/db.js LAYOUT_DEFAULTS', () => {
    const require = createRequire(import.meta.url);
    const { LAYOUT_DEFAULTS } = require('../../../server/db.js');
    expect(DEFAULT_LAYOUT).toEqual(LAYOUT_DEFAULTS);
  });
});

describe('mergeLayoutPatch', () => {
  it('keeps fields a partial import leaves out', () => {
    const merged = mergeLayoutPatch(DEFAULT_LAYOUT, { stats: { enabled: true }, loa: { sections: [] } });
    expect(merged.stats).toEqual({ ...DEFAULT_LAYOUT.stats, enabled: true });
    expect(merged.boarding).toBe(DEFAULT_LAYOUT.boarding);
    expect(merged.loa.sections).toEqual([]);
  });
  it('replaces arrays and ignores prototype keys', () => {
    const merged = mergeLayoutPatch({ a: [1, 2], b: { c: 1 } }, JSON.parse('{"a":[3],"__proto__":{"x":1}}'));
    expect(merged).toEqual({ a: [3], b: { c: 1 } });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
