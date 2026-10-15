import { describe, it, expect } from 'vitest';
import type { PathRequest, Train, TrainRequest } from '../types';
import { draftFromRequest, hueOf, pickRequestColor, plotRequestState, plotWarnings, retimeFromDrafts } from './plotting';

const prev: Train = { id: 'pending:r1', timetable_id: 't', name: 'PR1', color: '#fff', notes: '', request_id: 'r1', stops: [] };

describe('draftFromRequest', () => {
  it('keeps the pending id and request id and mints stop ids', () => {
    const data: TrainRequest = {
      name: 'PR2', color: '#000', notes: 'n', trainId: '3001', crewId: 'c1',
      stops: [
        { stationId: 'a', arrival: null, departure: '10:00', locationAlias: 'Loop' },
        { stationId: 'b', arrival: '10:10', departure: null },
      ],
    };
    const t = draftFromRequest(data, prev);
    expect(t.id).toBe('pending:r1');
    expect(t.request_id).toBe('r1');
    expect(t.name).toBe('PR2');
    expect(t.train_id).toBe('3001');
    expect(t.stops.map((s) => s.id)).toEqual(['pending:r1:0', 'pending:r1:1']);
    expect(t.stops[0].location_alias).toBe('Loop');
    expect(t.stops[1].location_alias).toBeNull();
  });
});

describe('retimeFromDrafts', () => {
  it('maps stops to station times', () => {
    const out = retimeFromDrafts([{ trainId: 'x', stops: [{ id: 's', train_id: 'x', station_id: 'a', arrival: null, departure: '09:00' }] }]);
    expect(out).toEqual([{ trainId: 'x', times: [{ stationId: 'a', arrival: null, departure: '09:00' }] }]);
  });
});

describe('plotRequestState', () => {
  const req = (status: PathRequest['status']) => [{ id: 'r1', status } as PathRequest];
  it('classifies', () => {
    expect(plotRequestState(req('in_review'), 'r1')).toBe('ok');
    expect(plotRequestState(req('withdrawn'), 'r1')).toBe('withdrawn');
    expect(plotRequestState(req('declined'), 'r1')).toBe('gone');
    expect(plotRequestState(req('pending'), 'r1')).toBe('gone');
    expect(plotRequestState([], 'r1')).toBe('gone');
    expect(plotRequestState(undefined, 'r1')).toBe('gone');
  });
});

describe('plotWarnings', () => {
  const mk = (id: string, crew: string | undefined, dep: string, arr: string): Train => ({
    id, timetable_id: 't', name: id, color: '#fff', notes: '', crew_id: crew,
    stops: [
      { id: id + 'a', train_id: id, station_id: 'a', arrival: null, departure: dep },
      { id: id + 'b', train_id: id, station_id: 'b', arrival: arr, departure: null },
    ],
  });
  const tt = (trains: Train[]) => ({ trains, crews: [{ id: 'c1', timetable_id: 't', name: 'Crew 1', color: '#000' }] });
  const m = (hhmm: string) => { const [h, mm] = hhmm.split(':').map(Number); return h * 60 + mm; };

  it('keeps plan warnings and adds nothing when clean', () => {
    expect(plotWarnings(mk('d', 'c1', '10:00', '10:20'), tt([]), null, ['no data'])).toEqual(['no data']);
  });
  it('warns when starting before the clock, not with no clock or after it', () => {
    const d = mk('d', undefined, '10:00', '10:20');
    expect(plotWarnings(d, tt([]), m('10:05'), [])).toEqual(['starts 5 min before the fast clock']);
    expect(plotWarnings(d, tt([]), m('09:50'), [])).toEqual([]);
    expect(plotWarnings(d, tt([]), null, [])).toEqual([]);
  });
  it('is midnight-safe for the clock', () => {
    expect(plotWarnings(mk('d', undefined, '23:55', '00:10'), tt([]), m('00:05'), [])).toEqual(['starts 10 min before the fast clock']);
    expect(plotWarnings(mk('d', undefined, '00:10', '00:30'), tt([]), m('23:50'), [])).toEqual([]);
  });
  it('flags overlap with the same crew only', () => {
    const d = mk('d', 'c1', '10:00', '10:30');
    const w = plotWarnings(d, tt([mk('x', 'c1', '10:20', '10:50'), mk('y', 'c2', '10:00', '10:30'), mk('z', 'c1', '10:30', '11:00')]), null, []);
    expect(w).toEqual(['Crew 1 has another job overlapping 10:20\u201310:50']);
  });
  it('detects overlap across midnight', () => {
    const d = mk('d', 'c1', '23:50', '00:20');
    expect(plotWarnings(d, tt([mk('x', 'c1', '00:10', '00:40')]), null, [])).toHaveLength(1);
  });
});

describe('pickRequestColor', () => {
  const t = (color: string) => ({ color });
  it('reads hues and ignores greys', () => {
    expect(hueOf('#ff0000')).toBe(0);
    expect(hueOf('#00ff00')).toBe(120);
    expect(hueOf('#0000ff')).toBe(240);
    expect(hueOf('#888888')).toBeNull();
    expect(hueOf('nope')).toBeNull();
  });
  it('picks a hue far from every existing train colour', () => {
    // Reds, greens and blues in use: the pick lands in the gaps (yellow-ish, cyan-ish or magenta-ish).
    const trains = [t('#ff0000'), t('#00ff00'), t('#0000ff')];
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const h = hueOf(pickRequestColor(trains, () => r))!;
      const gap = Math.min(...[0, 120, 240].map((u) => Math.min(Math.abs(h - u), 360 - Math.abs(h - u))));
      expect(gap).toBeGreaterThanOrEqual(50);
    }
  });
  it('varies with the random source and returns a hex colour', () => {
    const a = pickRequestColor([], () => 0);
    const b = pickRequestColor([], () => 0.5);
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });
});
