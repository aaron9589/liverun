import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FunctionMode, ProfileFunction } from '../types';
import { ActionRunnerCore } from './actionRunner';
import type { ResolvedAction } from './profiles';

const act = (fn: number, mode: FunctionMode, extra: Partial<ProfileFunction> = {}): ResolvedAction =>
  ({ ok: true, fn, spec: { key: { fn }, mode, ...extra } });

function setup(opts: { connected?: boolean } = {}) {
  const state: Record<number, boolean> = {};
  const sent: string[] = [];
  let connected = opts.connected ?? true;
  const runner = new ActionRunnerCore({
    setFunction: (fn, on) => {
      if (!connected) return false;
      sent.push(`F${fn}=${on}`);
      state[fn] = on;
      return true;
    },
    getFunction: (fn) => state[fn],
  });
  return { runner, sent, state, setConnected: (c: boolean) => { connected = c; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ActionRunnerCore', () => {
  it('on / off send a single command', () => {
    const { runner, sent } = setup();
    expect(runner.press('door_open', act(6, 'on'))).toBe(true);
    expect(runner.press('door_close', act(6, 'off'))).toBe(true);
    expect(sent).toEqual(['F6=true', 'F6=false']);
  });

  it('toggle flips the last reported state (unknown = off)', () => {
    const { runner, sent, state } = setup();
    runner.press('doors', act(4, 'toggle'));
    runner.press('doors', act(4, 'toggle'));
    state[4] = true; // e.g. a handheld turned it on
    runner.press('doors', act(4, 'toggle'));
    expect(sent).toEqual(['F4=true', 'F4=false', 'F4=false']);
  });

  it('pulse turns off after pulse_ms (default 500)', () => {
    const { runner, sent } = setup();
    runner.press('bell', act(2, 'pulse', { pulse_ms: 600 }));
    vi.advanceTimersByTime(599);
    expect(sent).toEqual(['F2=true']);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['F2=true', 'F2=false']);

    runner.press('horn', act(3, 'pulse'));
    vi.advanceTimersByTime(499);
    expect(sent[sent.length - 1]).toBe('F3=true');
    vi.advanceTimersByTime(1);
    expect(sent[sent.length - 1]).toBe('F3=false');
    expect(runner.isActive('horn')).toBe(false);
  });

  it('on_for turns off after duration_s (default 5)', () => {
    const { runner, sent } = setup();
    runner.press('squeal', act(8, 'on_for', { duration_s: 12 }));
    vi.advanceTimersByTime(11_999);
    expect(sent).toEqual(['F8=true']);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['F8=true', 'F8=false']);

    runner.press('fx', act(9, 'on_for'));
    vi.advanceTimersByTime(5_000);
    expect(sent.slice(-2)).toEqual(['F9=true', 'F9=false']);
  });

  it('hold: on at press, off at release; release is a no-op for other modes', () => {
    const { runner, sent } = setup();
    runner.press('bell', act(2, 'hold'));
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual(['F2=true']);
    runner.release('bell');
    runner.release('bell');
    expect(sent).toEqual(['F2=true', 'F2=false']);

    runner.press('door_open', act(6, 'on'));
    runner.release('door_open');
    expect(sent[sent.length - 1]).toBe('F6=true');
  });

  it('a repeat press cancels the pending off-timer of that action first', () => {
    const { runner, sent } = setup();
    runner.press('bell', act(2, 'pulse', { pulse_ms: 1000 }));
    vi.advanceTimersByTime(800);
    runner.press('bell', act(2, 'pulse', { pulse_ms: 1000 }));
    vi.advanceTimersByTime(800); // first timer would have fired at 1000
    expect(sent).toEqual(['F2=true', 'F2=true']);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual(['F2=true', 'F2=true', 'F2=false']);
    vi.advanceTimersByTime(5_000);
    expect(sent).toHaveLength(3);
  });

  it('other actions keep their timers', () => {
    const { runner, sent } = setup();
    runner.press('bell', act(2, 'pulse', { pulse_ms: 1000 }));
    runner.press('squeal', act(8, 'on_for', { duration_s: 2 }));
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(['F2=true', 'F8=true', 'F2=false', 'F8=false']);
  });

  it('stopAll turns off pulsed / held / on_for functions and clears timers', () => {
    const { runner, sent } = setup();
    runner.press('door_open', act(6, 'on')); // latching: not owed an off
    runner.press('bell', act(2, 'pulse'));
    runner.press('buzzer', act(3, 'hold'));
    runner.press('squeal', act(8, 'on_for'));
    sent.length = 0;
    runner.stopAll();
    expect(sent.sort()).toEqual(['F2=false', 'F3=false', 'F8=false']);
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(3);
    runner.release('buzzer');
    expect(sent).toHaveLength(3);
  });

  it('unresolved actions send nothing and leave pending timers alone', () => {
    const { runner, sent } = setup();
    runner.press('bell', act(2, 'pulse'));
    expect(runner.press('bell', { ok: false, reason: 'label-not-found' })).toBe(false);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual(['F2=true', 'F2=false']);
  });

  it('never queues: nothing sent while disconnected, nothing replayed after', () => {
    const { runner, sent, setConnected } = setup({ connected: false });
    expect(runner.press('door_open', act(6, 'on'))).toBe(false);
    expect(runner.press('bell', act(2, 'pulse'))).toBe(false);
    expect(runner.press('buzzer', act(3, 'hold'))).toBe(false);
    expect(runner.isActive('bell')).toBe(false);
    setConnected(true);
    vi.advanceTimersByTime(10_000);
    runner.release('buzzer');
    runner.stopAll();
    expect(sent).toEqual([]);
  });

  it('a pulse off that comes due while disconnected is dropped, not retried', () => {
    const { runner, sent, setConnected } = setup();
    runner.press('bell', act(2, 'pulse'));
    setConnected(false);
    vi.advanceTimersByTime(500);
    setConnected(true);
    vi.advanceTimersByTime(10_000);
    runner.stopAll();
    expect(sent).toEqual(['F2=true']);
  });
});
