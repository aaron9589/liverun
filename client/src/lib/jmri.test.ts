import { describe, it, expect, vi, afterEach } from 'vitest';
import { jmriHttpBase, normaliseRoster, fetchRoster, rankRosterMatches } from './jmri';
import type { JmriRosterEntry } from '../types';

const e = (name: string): JmriRosterEntry => ({ name, address: '1', functionKeys: [] });

describe('jmriHttpBase', () => {
  it('maps wss to https and trims slashes', () => {
    expect(jmriHttpBase('wss://host/json/')).toBe('https://host/json');
  });
  it('maps ws to http and keeps port', () => {
    expect(jmriHttpBase('ws://10.0.0.5:12080/json')).toBe('http://10.0.0.5:12080/json');
  });
  it('returns null for empty, invalid or non-ws', () => {
    expect(jmriHttpBase('')).toBeNull();
    expect(jmriHttpBase('nonsense')).toBeNull();
    expect(jmriHttpBase('https://host/json')).toBeNull();
  });
});

describe('normaliseRoster', () => {
  it('handles typed wrappers', () => {
    const r = normaliseRoster([
      { type: 'rosterEntry', data: { name: 'CR 2L', address: 12, road: 'CR', functionKeys: [{ name: 'F0', label: 'Light', lockable: true }] } },
    ]);
    expect(r).toEqual([
      { name: 'CR 2L', address: '12', road: 'CR', functionKeys: [{ name: 'F0', label: 'Light', lockable: true }] },
    ]);
  });
  it('handles plain arrays, {roster}, and maps; drops nameless', () => {
    expect(normaliseRoster([{ name: 'A' }, { address: '3' }])).toEqual([{ name: 'A', address: '', functionKeys: [] }]);
    expect(normaliseRoster({ roster: [{ name: 'B' }] })).toHaveLength(1);
    expect(normaliseRoster({ x: { name: 'C' }, y: { name: 'D' } })).toHaveLength(2);
    expect(normaliseRoster(null)).toEqual([]);
  });
});

describe('fetchRoster', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GETs <base>/roster and normalises', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ name: 'X' }] });
    vi.stubGlobal('fetch', fn);
    const r = await fetchRoster('wss://h/json/');
    expect(fn.mock.calls[0][0]).toBe('https://h/json/roster');
    expect(r[0].name).toBe('X');
  });
  it('rejects on HTTP error or bad URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchRoster('ws://h/json')).rejects.toThrow();
    await expect(fetchRoster('')).rejects.toThrow();
  });
});

describe('rankRosterMatches', () => {
  const list = [e('Zebra'), e('beta'), e('Alpha'), e('xbeta'), e('Beta2')];
  it('prefix first then substring, alphabetical', () => {
    expect(rankRosterMatches(list, 'BET').map((x) => x.name)).toEqual(['beta', 'Beta2', 'xbeta']);
  });
  it('empty query returns first N alphabetically', () => {
    expect(rankRosterMatches(list, '', 2).map((x) => x.name)).toEqual(['Alpha', 'beta']);
  });
});
