import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { DEFAULT_LAYOUT } from './layoutDefaults';

// Keeps the client fallback in step with the server's LAYOUT_DEFAULTS.
describe('DEFAULT_LAYOUT', () => {
  it('matches server/db.js LAYOUT_DEFAULTS', () => {
    const require = createRequire(import.meta.url);
    const { LAYOUT_DEFAULTS } = require('../../../server/db.js');
    expect(DEFAULT_LAYOUT).toEqual(LAYOUT_DEFAULTS);
  });
});
