import { describe, expect, it } from 'vitest';
import {
  acquireMessage, applyError, applyThrottleUpdate, backoffMs, disconnected, functionMessage,
  initialThrottleState, parseIncoming, pingIntervalMs, pingMessage, releaseMessage, releaseRequested,
  startAcquire, validWsUrl, type ThrottleUpdate,
} from './jmriProtocol';

const throttle = (data: object): ThrottleUpdate => {
  const m = parseIncoming(JSON.stringify({ type: 'throttle', data }));
  if (!m || m.kind !== 'throttle') throw new Error('not a throttle message');
  return m;
};

describe('message builders', () => {
  it('use the name key only', () => {
    expect(JSON.parse(pingMessage())).toEqual({ type: 'ping' });
    expect(JSON.parse(acquireMessage('guard-ab12', 'CityRail 4V-1')))
      .toEqual({ type: 'throttle', data: { name: 'guard-ab12', rosterEntry: 'CityRail 4V-1' } });
    expect(JSON.parse(functionMessage('guard-ab12', 6, true)))
      .toEqual({ type: 'throttle', data: { name: 'guard-ab12', F6: true } });
    expect(JSON.parse(releaseMessage('guard-ab12')))
      .toEqual({ type: 'throttle', data: { name: 'guard-ab12', release: null } });
  });
});

describe('helpers', () => {
  it('validWsUrl accepts ws/wss only', () => {
    expect(validWsUrl(' wss://jmri.example.net/json/ ')).toBe('wss://jmri.example.net/json/');
    expect(validWsUrl('ws://localhost:12080/json/')).toBe('ws://localhost:12080/json/');
    expect(validWsUrl('http://jmri/json/')).toBeNull();
    expect(validWsUrl('not a url')).toBeNull();
    expect(validWsUrl('')).toBeNull();
    expect(validWsUrl(undefined)).toBeNull();
  });
  it('pings at 80% of the heartbeat, 15 s when unknown', () => {
    expect(pingIntervalMs(13_500)).toBe(10_800);
    expect(pingIntervalMs(null)).toBe(15_000);
    expect(pingIntervalMs(0)).toBe(15_000);
    expect(pingIntervalMs(500)).toBe(1_000);
  });
  it('backs off 1 s → 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('parseIncoming', () => {
  it('parses hello, pong, error and ignores junk', () => {
    expect(parseIncoming('{"type":"hello","data":{"JMRI":"5.8","json":"5.0","heartbeat":13500}}'))
      .toEqual({ kind: 'hello', heartbeat: 13500, version: '5.8' });
    expect(parseIncoming('{"type":"hello","data":{}}')).toEqual({ kind: 'hello', heartbeat: null, version: null });
    expect(parseIncoming('{"type":"pong"}')).toEqual({ kind: 'pong' });
    expect(parseIncoming('{"type":"error","data":{"code":404,"message":"Unable to find roster entry"}}'))
      .toEqual({ kind: 'error', code: 404, message: 'Unable to find roster entry' });
    expect(parseIncoming('{"type":"power","data":{"state":2}}')).toEqual({ kind: 'other', type: 'power' });
    expect(parseIncoming('nope')).toBeNull();
    expect(parseIncoming('[1,2]')).toBeNull();
    expect(parseIncoming(42)).toBeNull();
  });
  it('parses throttle status, reading name or legacy throttle key', () => {
    const m = throttle({ throttle: 'guard-1', address: 3001, rosterEntry: 'CityRail 4V-1', speed: 0, F0: true, F6: false, F12: 'x', F99: true, clients: 2 });
    expect(m).toEqual({ kind: 'throttle', name: 'guard-1', address: 3001, rosterEntry: 'CityRail 4V-1', released: false, functions: { 0: true, 6: false } });
    expect(throttle({ name: 'guard-1', release: null, clients: 0 }).released).toBe(true);
    expect(throttle({ F6: true }).name).toBeNull();
  });
});

describe('throttle state', () => {
  const acquiring = startAcquire(initialThrottleState, 'CityRail 4V-1');

  it('acquires only on JMRI\'s full status reply', () => {
    expect(acquiring.phase).toBe('acquiring');
    expect(applyThrottleUpdate(acquiring, throttle({ name: 'g', F6: true })).phase).toBe('acquiring');
    const s = applyThrottleUpdate(acquiring, throttle({ name: 'g', address: 3001, F0: false, F6: true }));
    expect(s).toMatchObject({ phase: 'acquired', address: 3001, functions: { 0: false, 6: true }, error: null });
  });

  it('ignores the previous loco\'s release ack while acquiring', () => {
    expect(applyThrottleUpdate(acquiring, throttle({ name: 'g', release: null }))).toBe(acquiring);
  });

  it('merges function changes once acquired (e.g. from a handheld)', () => {
    const s = applyThrottleUpdate(acquiring, throttle({ name: 'g', address: 3001, F0: false, F6: false }));
    const s2 = applyThrottleUpdate(s, throttle({ name: 'g', F6: true }));
    expect(s2.functions).toEqual({ 0: false, 6: true });
    expect(applyThrottleUpdate(s2, throttle({ name: 'g', speed: 0.5 }))).toBe(s2);
  });

  it('a release from JMRI while acquired drops the throttle', () => {
    const s = applyThrottleUpdate(acquiring, throttle({ name: 'g', address: 3001 }));
    expect(applyThrottleUpdate(s, throttle({ name: 'g', release: null }))).toMatchObject({ phase: 'released' });
  });

  it('ignores throttle messages when released', () => {
    expect(applyThrottleUpdate(initialThrottleState, throttle({ name: 'g', address: 1, F1: true }))).toBe(initialThrottleState);
  });

  it('an error mid-acquire fails the acquire', () => {
    const s = applyError(acquiring, 'Unable to find roster entry');
    expect(s).toMatchObject({ phase: 'released', error: 'Unable to find roster entry' });
  });

  it('keeps functions across a reconnect of the same loco, clears them for a new loco', () => {
    const s = applyThrottleUpdate(acquiring, throttle({ name: 'g', address: 3001, F6: true }));
    const dropped = disconnected(s);
    expect(dropped.phase).toBe('released');
    expect(startAcquire(dropped, 'CityRail 4V-1').functions).toEqual({ 6: true });
    expect(startAcquire(dropped, 'NSWGR 4401').functions).toEqual({});
    expect(releaseRequested()).toEqual(initialThrottleState);
  });
});
