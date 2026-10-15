import { describe, expect, it } from 'vitest';
import type { JmriRosterEntry, TrainProfile } from '../types';
import { globMatch, globMatchAny } from './glob';
import { parseFunctionName, resolveAction, resolveProfile } from './profiles';

const sounds = { door_open: '', door_close: '', bell: '' };
const profiles: TrainProfile[] = [
  { id: 'v', name: 'V set', match: ['CityRail ?V-*'], sounds, functions: { door_open: { key: { label: 'Door Open/Close' }, mode: 'on' }, bell: { key: { fn: 2 }, mode: 'pulse', pulse_ms: 600 } } },
  { id: 't', name: 'Tangara', match: ['CityRail ?T-*', '*tangara*'], sounds, functions: {} },
  { id: 'd', name: 'Default', match: [], sounds, functions: { bell: { key: { fn: 99 }, mode: 'pulse' } } },
];
const roster: JmriRosterEntry = { name: 'CityRail 4V-1', address: '3001', functionKeys: [{ name: 'F6', label: 'door open/close' }, { name: 'F2', label: 'Horn' }] };

describe('glob', () => {
  it('matches * and ? case-insensitively, literal otherwise', () => {
    expect(globMatch('CityRail ?V-*', 'cityrail 4v-12')).toBe(true);
    expect(globMatch('CityRail ?V-*', 'CityRail 44V-12')).toBe(false);
    expect(globMatch('a.b', 'axb')).toBe(false);
    expect(globMatch('(x)+', '(x)+')).toBe(true);
    expect(globMatchAny(['', '  '], 'anything')).toBe(false);
  });
});

describe('resolveProfile', () => {
  it('first matching profile wins, else the empty-match fallback', () => {
    expect(resolveProfile(profiles, 'CityRail 4V-1')?.id).toBe('v');
    expect(resolveProfile(profiles, 'My Tangara Set')?.id).toBe('t');
    expect(resolveProfile(profiles, 'NSWGR 4401')?.id).toBe('d');
    expect(resolveProfile(profiles, '')?.id).toBe('d');
    expect(resolveProfile(profiles.slice(0, 2), 'NSWGR 4401')).toBeNull();
  });
});

describe('resolveAction', () => {
  it('resolves labels via the roster and explicit fn numbers directly', () => {
    expect(resolveAction(profiles[0], 'door_open', roster)).toMatchObject({ ok: true, fn: 6 });
    expect(resolveAction(profiles[0], 'bell', null)).toMatchObject({ ok: true, fn: 2 });
  });
  it('reports why an action is skipped', () => {
    expect(resolveAction(profiles[0], 'door_close', roster)).toEqual({ ok: false, reason: 'unmapped' });
    expect(resolveAction(profiles[0], 'door_open', null)).toEqual({ ok: false, reason: 'no-roster-entry' });
    expect(resolveAction(profiles[0], 'door_open', { ...roster, functionKeys: [] })).toEqual({ ok: false, reason: 'label-not-found' });
    expect(resolveAction(profiles[2], 'bell', roster)).toEqual({ ok: false, reason: 'bad-key' });
    expect(resolveAction(null, 'bell', roster)).toEqual({ ok: false, reason: 'unmapped' });
  });
  it('parses JMRI function names', () => {
    expect(parseFunctionName('F0')).toBe(0);
    expect(parseFunctionName('f28')).toBe(28);
    expect(parseFunctionName('F69')).toBeNull();
    expect(parseFunctionName('Light')).toBeNull();
  });
});
