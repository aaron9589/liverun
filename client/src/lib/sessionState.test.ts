import { describe, expect, it } from 'vitest';
import { SESSION_STATE_MAX_AGE_MS, readSessionState, stampSessionState } from './sessionState';

describe('sessionState', () => {
  const t0 = 1_000_000_000_000;

  it('round-trips within the window', () => {
    const raw = stampSessionState({ a: 1 }, t0);
    expect(readSessionState(raw, t0 + SESSION_STATE_MAX_AGE_MS)).toEqual({ a: 1, saved_at: t0 });
  });
  it('drops state older than 12 hours', () => {
    const raw = stampSessionState({ a: 1 }, t0);
    expect(readSessionState(raw, t0 + SESSION_STATE_MAX_AGE_MS + 1)).toBeNull();
  });
  it('drops unstamped, non-object and unparsable values', () => {
    expect(readSessionState(JSON.stringify({ a: 1 }), t0)).toBeNull();
    expect(readSessionState(JSON.stringify([1, 2]), t0)).toBeNull();
    expect(readSessionState('{nope', t0)).toBeNull();
    expect(readSessionState(null, t0)).toBeNull();
  });
});
