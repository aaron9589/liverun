import { describe, expect, it } from 'vitest';
import type { AuditEntry, Timetable } from '../types';
import { describeDetail, entryRoute, filterOutcome, formatAuditTime, shortDevice } from './auditView';

const tt = {
  stations: [{ id: 's1', name: 'Kiama' }, { id: 's2', name: 'Bombo' }],
  path_requests: [{ id: 'r1', stops: [{ station_id: 's1', kind: 'stop', minutes: 0 }, { station_id: 's2', kind: 'stop', minutes: 0 }] }],
} as unknown as Timetable;

const e = (over: Partial<AuditEntry>): AuditEntry => ({
  at: '2026-01-01T10:00:00Z', ip: '1.1.1.1', device: '', ua: '', actor: 'control',
  action: 'decline', outcome: 'ok', timetable_id: 't', ...over,
});

describe('describeDetail', () => {
  it('submit', () => {
    const l = describeDetail(e({ action: 'submit', actor: 'crew', detail: {
      stops: [{ station_id: 's1', kind: 'stop', minutes: 0 }, { station_id: 's2', kind: 'stop', minutes: 0 }],
      loco: '3001', ready_at: null, notes: 'hi' } }), tt);
    expect(l).toEqual(['Route: Kiama → Bombo', 'Loco: 3001', 'Ready: ASAP', 'Notes: hi']);
  });
  it('decline / cancel-ask / cancel-reject / withdraw / release', () => {
    expect(describeDetail(e({ detail: { note: 'no' } }), tt)).toEqual(['Reason: no']);
    expect(describeDetail(e({ action: 'cancel-ask', detail: { reason: 'broke' } }), tt)).toEqual(['Reason: broke']);
    expect(describeDetail(e({ action: 'cancel-reject', detail: { note: 'stays' } }), tt)).toEqual(['Reason: stays']);
    expect(describeDetail(e({ action: 'withdraw', detail: { while_plotting: true } }), tt)).toEqual(['Withdrawn while plotting']);
    expect(describeDetail(e({ action: 'withdraw', detail: { while_plotting: false } }), tt)).toEqual([]);
    expect(describeDetail(e({ action: 'release', detail: { reopened: true } }), tt)).toHaveLength(1);
  });
  it('accept', () => {
    const l = describeDetail(e({ action: 'accept', detail: {
      train: { name: 'T1', crew: 'A', loco: '3001', stops: [{ station: 'Kiama', arr: null, dep: '10:00' }, { station: 'Bombo', arr: '10:10', dep: null }] },
      assigned_crew: 'B', note: 'ok',
      moved: [{ name: 'T2', from: [{ station: 'Kiama', arr: '10:00', dep: '10:02' }], to: [{ station: 'Kiama', arr: '10:05', dep: '10:07' }] }],
    } }), tt);
    expect(l[0]).toBe('T1 · 3001 · crew A');
    expect(l[1]).toBe('Kiama 10:00 → Bombo 10:10');
    expect(l).toContain('Assigned to B');
    expect(l).toContain('Note: ok');
    expect(l[l.length - 1]).toBe('Moved T2: Kiama 10:00–10:02 → Kiama 10:05–10:07');
  });
  it('cancel-approve and clear', () => {
    expect(describeDetail(e({ action: 'cancel-approve', detail: { train: { name: 'T1', stops: [] }, note: null } }), tt)[0]).toBe('Deleted train T1');
    expect(describeDetail(e({ action: 'cancel-approve', detail: { train: null } }), tt)).toEqual(['Train already gone']);
    expect(describeDetail(e({ action: 'clear', detail: { removed: ['a', 'b'] } }), tt)).toEqual(['2 requests removed']);
    expect(describeDetail(e({ action: 'clear', detail: { removed: [] } }), tt)).toEqual(['0 requests removed']);
  });
  it('rejected and missing data', () => {
    expect(describeDetail(e({ outcome: 'rejected', error: 'Nope', detail: { status: 'accepted' } }), tt)).toEqual(['Rejected: Nope', 'Request was accepted']);
    expect(describeDetail(e({ outcome: 'rejected' }), tt)).toEqual([]);
    expect(describeDetail(e({ action: 'accept' }), tt)).toEqual([]);
    expect(describeDetail(e({ action: 'accept', detail: {} }), tt)).toEqual([]);
  });
  it('falls back to JSON for unknown actions', () => {
    expect(describeDetail(e({ action: 'zzz' as never, detail: { a: 1 } }), tt)).toEqual(['{"a":1}']);
  });
});

describe('helpers', () => {
  it('entryRoute', () => {
    expect(entryRoute(e({ request_id: 'r1' }), tt)).toBe('Kiama → Bombo');
    expect(entryRoute(e({ request_id: 'gone' }), tt)).toBe('removed request');
    expect(entryRoute(e({}), tt)).toBe('');
  });
  it('filterOutcome / shortDevice / formatAuditTime', () => {
    const list = [e({}), e({ outcome: 'rejected' })];
    expect(filterOutcome(list, '')).toHaveLength(2);
    expect(filterOutcome(list, 'rejected')).toHaveLength(1);
    expect(shortDevice('abcdefghij')).toBe('…efghij');
    expect(shortDevice('abc')).toBe('abc');
    expect(formatAuditTime('nope')).toBe('');
    expect(formatAuditTime('2026-01-01T10:00:00Z')).toMatch(/^\d\d:\d\d:\d\d$/);
  });
});
