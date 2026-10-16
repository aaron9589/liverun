import { describe, it, expect } from 'vitest';
import type { PathRequest, Station } from '../types';
import { sortRequests, badgeCount, queueRequests, routeSummary, newRequestEvents, ageLabel } from './requestQueue';

const st = (id: string, name: string) => ({ id, name } as Station);
const stations = [st('a', 'Kiama'), st('b', 'Bombo'), st('c', 'Dunmore')];

function req(id: string, status: PathRequest['status'], created = '2026-01-01T10:00:00Z', extra: Partial<PathRequest> = {}): PathRequest {
  return {
    id, timetable_id: 't', crew_id: 'c1', status, created_at: created, updated_at: created,
    stops: [{ station_id: 'a', kind: 'stop', minutes: 0 }, { station_id: 'b', kind: 'stop', minutes: 0 }],
    ...extra,
  };
}
const ask = { at: 'x', status: 'open' as const };

describe('sortRequests', () => {
  it('puts open first, newest first within groups', () => {
    const list = [
      req('old-closed', 'declined', '2026-01-01T09:00:00Z'),
      req('new-closed', 'withdrawn', '2026-01-01T11:00:00Z'),
      req('old-open', 'pending', '2026-01-01T08:00:00Z'),
      req('ask', 'accepted', '2026-01-01T07:00:00Z', { cancel_ask: ask }),
      req('new-open', 'in_review', '2026-01-01T12:00:00Z'),
      req('plain-accepted', 'accepted', '2026-01-01T13:00:00Z'),
    ];
    expect(sortRequests(list).map((r) => r.id)).toEqual(['new-open', 'old-open', 'ask', 'plain-accepted', 'new-closed', 'old-closed']);
  });
});

describe('badgeCount', () => {
  it('counts pending and open asks only', () => {
    expect(badgeCount(undefined, [])).toBe(0);
    expect(badgeCount([
      req('1', 'pending'), req('2', 'in_review'), req('3', 'accepted', undefined, { cancel_ask: ask, train_id_created: 't3' }),
      req('4', 'accepted', undefined, { cancel_ask: { ...ask, status: 'rejected' }, train_id_created: 't4' }),
    ], [{ id: 't3' }, { id: 't4' }])).toBe(2);
  });
  it('does not count an ask whose train is gone', () => {
    expect(badgeCount([req('3', 'accepted', undefined, { cancel_ask: ask, train_id_created: 'gone' })], [])).toBe(0);
  });
});

describe('queueRequests', () => {
  it('keeps only what Control still has to deal with', () => {
    const list = [
      req('p', 'pending'), req('r', 'in_review', '2026-01-01T11:00:00Z'),
      req('acc', 'accepted', undefined, { train_id_created: 't1' }),
      req('ask', 'accepted', undefined, { train_id_created: 't1', cancel_ask: ask }),
      req('ask-gone', 'accepted', undefined, { train_id_created: 'deleted', cancel_ask: ask }),
      req('dec', 'declined'), req('wd', 'withdrawn'), req('can', 'cancelled'),
    ];
    expect(queueRequests(list, [{ id: 't1' }]).map((r) => r.id)).toEqual(['r', 'p', 'ask']);
  });
});

describe('routeSummary', () => {
  it('shows work stops and sidings', () => {
    const r = req('1', 'pending', undefined, {
      stops: [
        { station_id: 'a', kind: 'stop', minutes: 0 },
        { station_id: 'b', kind: 'shunt', minutes: 20, note: 'flour' },
        { station_id: 'c', kind: 'stop', minutes: 0, location_alias: 'Loop' },
      ],
    });
    expect(routeSummary(r, stations)).toBe('Kiama → Bombo (shunt 20, flour) → Dunmore (Loop)');
  });
});

describe('newRequestEvents', () => {
  it('ignores the first snapshot', () => {
    expect(newRequestEvents(null, [req('1', 'pending')])).toEqual([]);
  });
  it('detects new pending, open asks and withdrawals', () => {
    const prev = [req('1', 'pending'), req('2', 'accepted'), req('3', 'in_review')];
    const next = [req('1', 'withdrawn'), req('2', 'accepted', undefined, { cancel_ask: ask }), req('3', 'in_review'), req('4', 'pending'), req('5', 'declined')];
    expect(newRequestEvents(prev, next).map((e) => `${e.kind}:${e.request.id}`).sort())
      .toEqual(['cancel-ask:2', 'new:4', 'withdrawn:1']);
  });
  it('does not repeat an unchanged ask', () => {
    const l = [req('2', 'accepted', undefined, { cancel_ask: ask })];
    expect(newRequestEvents(l, l)).toEqual([]);
  });
});

describe('ageLabel', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('formats', () => {
    expect(ageLabel('2026-01-01T11:59:40Z', now)).toBe('just now');
    expect(ageLabel('2026-01-01T11:57:00Z', now)).toBe('3 min ago');
    expect(ageLabel('2026-01-01T09:00:00Z', now)).toBe('3 h ago');
    expect(ageLabel('2025-12-30T12:00:00Z', now)).toBe('2 d ago');
  });
});
