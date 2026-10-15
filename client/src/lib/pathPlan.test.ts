import { describe, expect, it } from 'vitest';
import type { Path, PathRequest, PathRequestStop, Timetable, Train } from '../types';
import { describeSource, pendingTrainId, planDraft, planRoute } from './pathPlan';
import { runningOrder } from './stops';

// Main line A–B–C–D–E (graph_pos rising = Down), branch J off C: C–J–K.
const STATIONS: [string, string, number][] = [
  ['a', 'Alpha', 0], ['b', 'Bravo', 10], ['c', 'Charlie', 20], ['j', 'Juliet', 25], ['k', 'Kilo', 28],
  ['d', 'Delta', 30], ['e', 'Echo', 40],
];
const NAMES = new Map(STATIONS.map(([id, name]) => [id, name]));
const nameOf = (id: string) => NAMES.get(id) ?? id;

/** A path from [station, travel_time_from_prev] pairs (dwell set to 3 to prove it's ignored). */
const path = (id: string, name: string, legs: [string, number][]): Path => ({
  id, timetable_id: 't', name,
  stops: legs.map(([station_id, travel], i) => ({
    id: `${id}-${i}`, path_id: id, station_id, sort_order: i, travel_time_from_prev: travel, dwell_time: 3,
  })),
});

const train = (id: string, name: string): Train => ({ id, timetable_id: 't', name, color: '#fff', notes: '', stops: [] });

const tt = (paths: Path[], over: Partial<Timetable> = {}, settings: Partial<Timetable['settings']> = {}): Timetable => ({
  id: 't', name: 'T', description: '', start_time: '06:00', end_time: '23:59', created_at: '', updated_at: '',
  stations: STATIONS.map(([id, name, graph_pos], i) => ({
    id, timetable_id: 't', name, short_code: id.toUpperCase(), distance: null, graph_pos, sort_order: i, branch_name: null,
  })),
  trains: [], paths,
  crews: [{ id: 'c1', timetable_id: 't', name: 'Crew 1', color: '#ff0000' }],
  settings: { clock_enabled: false, clock_broker_url: '', clock_topic: '', auto_assign_min_break: 0, ...settings },
  ...over,
});

const pt = (station_id: string, over: Partial<PathRequestStop> = {}): PathRequestStop => ({ station_id, kind: 'stop', minutes: 0, ...over });

const req = (stops: PathRequestStop[], over: Partial<PathRequest> = {}): PathRequest => ({
  id: 'r1', timetable_id: 't', crew_id: 'c1', stops, ready_at: '10:00',
  status: 'in_review', created_at: '', updated_at: '', ...over,
});

const MAIN = path('p-main', 'Alpha–Echo', [['a', 0], ['b', 4], ['c', 6], ['d', 5], ['e', 3]]);

/** [station, arrival, departure] in running order. */
const times = (t: Train) => runningOrder(t.stops).map((s) => [s.station_id, s.arrival, s.departure]);

describe('single path', () => {
  it('routes forwards along one path with passing stations timed', () => {
    const r = planDraft(req([pt('a'), pt('d')]), tt([MAIN]), null);
    expect(r.source).toEqual({ kind: 'path', pathId: 'p-main', pathName: 'Alpha–Echo' });
    expect(r.legs).toEqual([{ fromStationId: 'a', toStationId: 'd', viaStationIds: ['b', 'c'], minutes: 15, source: 'path' }]);
    expect(r.warnings).toEqual([]);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:04', '10:04'], ['c', '10:10', '10:10'], ['d', '10:15', null],
    ]);
  });

  it('routes a reversed path (Up), stored in station order', () => {
    const r = planDraft(req([pt('e'), pt('b')]), tt([MAIN]), null);
    expect(r.source.kind).toBe('path');
    expect(r.legs[0]).toMatchObject({ fromStationId: 'e', toStationId: 'b', viaStationIds: ['d', 'c'], minutes: 14 });
    expect(r.train.direction).toBe('Up');
    // Stored in timetable station order (b, c, d, e) — backwards for an Up train.
    expect(r.train.stops.map((s) => s.station_id)).toEqual(['b', 'c', 'd', 'e']);
    // Running order recovers the planned order.
    expect(times(r.train)).toEqual([
      ['e', null, '10:00'], ['d', '10:03', '10:03'], ['c', '10:08', '10:08'], ['b', '10:14', null],
    ]);
  });

  it('chooses the most direct of several fitting paths, then by name', () => {
    const loop = path('p-loop', 'Aardvark loop', [['a', 0], ['b', 4], ['j', 2], ['c', 2], ['d', 5]]);
    const direct = path('p-z', 'Zulu', [['a', 0], ['c', 9], ['d', 5]]);
    const directToo = path('p-y', 'Yankee', [['a', 0], ['c', 8], ['d', 5]]);
    const r = planRoute(req([pt('a'), pt('d')]), tt([loop, MAIN, direct, directToo]));
    expect(r.source).toEqual({ kind: 'path', pathId: 'p-y', pathName: 'Yankee' });
    expect(r.legs[0].minutes).toBe(13);
  });

  it('holds an intermediate requested point mid-path, with its dwell', () => {
    const r = planDraft(req([pt('a'), pt('c', { kind: 'shunt', minutes: 20 }), pt('e')]), tt([MAIN]), null);
    expect(r.legs.map((l) => [l.fromStationId, l.toStationId, l.viaStationIds, l.minutes])).toEqual([
      ['a', 'c', ['b'], 10], ['c', 'e', ['d'], 8],
    ]);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:04', '10:04'], ['c', '10:10', '10:30'], ['d', '10:35', '10:35'], ['e', '10:38', null],
    ]);
    const c = r.train.stops.find((s) => s.station_id === 'c')!;
    expect(c.special_instructions).toBe('Shunt 20 min');
  });

  it('does not fit requested points out of order on a path', () => {
    const r = planRoute(req([pt('b'), pt('a'), pt('c')]), tt([MAIN]));
    expect(r.source.kind).not.toBe('path');
  });

  it('ignores the path dwell times (template is a timing source only)', () => {
    const r = planDraft(req([pt('a'), pt('c')]), tt([MAIN]), null);
    const b = r.train.stops.find((s) => s.station_id === 'b')!;
    expect(b.arrival).toBe(b.departure);
  });
});

describe('inferred', () => {
  const branch = path('p-br', 'Branch', [['c', 0], ['j', 3], ['k', 2]]);

  it('chains paths across a junction', () => {
    const r = planDraft(req([pt('a'), pt('k')]), tt([MAIN, branch]), null);
    expect(r.source).toEqual({ kind: 'inferred', pathNames: ['Alpha–Echo', 'Branch'] });
    expect(r.legs).toEqual([{ fromStationId: 'a', toStationId: 'k', viaStationIds: ['b', 'c', 'j'], minutes: 15, source: 'inferred' }]);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:04', '10:04'], ['c', '10:10', '10:10'], ['j', '10:13', '10:13'], ['k', '10:15', null],
    ]);
  });

  it('uses the median of a shared leg (even count → mean of the middle two)', () => {
    const slow = path('p-slow', 'Slow', [['a', 0], ['b', 8]]);
    const r = planRoute(req([pt('a'), pt('k')]), tt([MAIN, branch, slow]));
    // a–b: median(4, 8) = 6 → 6 + 6 + 3 + 2 = 17
    expect(r.legs[0].minutes).toBe(17);
    expect(r.source).toEqual({ kind: 'inferred', pathNames: ['Alpha–Echo', 'Branch', 'Slow'] });
  });

  it('takes the median of an odd count and rounds the leg total', () => {
    const p1 = path('p1', 'One', [['j', 0], ['k', 1]]);
    const p2 = path('p2', 'Two', [['j', 0], ['k', 2]]);
    const p3 = path('p3', 'Three', [['j', 0], ['k', 9]]);
    const p4 = path('p4', 'Four', [['c', 0], ['j', 2.5]]);
    // c–j 2.5 + j–k median(1,2,9)=2 = 4.5 → 5 (round half up)
    expect(planRoute(req([pt('c'), pt('k')]), tt([p1, p2, p3, p4])).legs[0].minutes).toBe(5);
  });

  it('picks the fastest route (Dijkstra)', () => {
    const shortcut = path('p-sc', 'Shortcut', [['a', 0], ['j', 4]]);
    const r = planRoute(req([pt('a'), pt('k')]), tt([MAIN, branch, shortcut]));
    expect(r.legs[0]).toMatchObject({ viaStationIds: ['j'], minutes: 6 });
    expect(r.source).toEqual({ kind: 'inferred', pathNames: ['Branch', 'Shortcut'] });
  });

  it('splits a leg across vias in proportion to the medians, whole and monotonic, total exact', () => {
    const p1 = path('p1', 'One', [['a', 0], ['b', 1]]);
    const p2 = path('p2', 'Two', [['a', 0], ['b', 2]]);
    const p3 = path('p3', 'Three', [['b', 0], ['c', 1.5]]);
    const p4 = path('p4', 'Four', [['c', 0], ['d', 1.5]]);
    // a–b 1.5, b–c 1.5, c–d 1.5 → 4.5 → 5 min; vias at round(5·1/3)=2, round(5·2/3)=3
    const r = planDraft(req([pt('a'), pt('d')]), tt([p1, p2, p3, p4]), null);
    expect(r.legs[0].minutes).toBe(5);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:02', '10:02'], ['c', '10:03', '10:03'], ['d', '10:05', null],
    ]);
  });

  it('mixes inferred and no-data legs, with a warning', () => {
    const r = planDraft(req([pt('a'), pt('c'), pt('k')]), tt([path('p-ab', 'AB', [['a', 0], ['b', 4]]), path('p-bc', 'BC', [['b', 0], ['c', 6]])]), null);
    expect(r.source).toEqual({ kind: 'inferred', pathNames: ['AB', 'BC'] });
    expect(r.legs.map((l) => [l.source, l.minutes, l.viaStationIds])).toEqual([['inferred', 10, ['b']], ['none', 5, []]]);
    expect(r.warnings).toEqual(['Charlie → Kilo: no path data, 5 min used']);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:04', '10:04'], ['c', '10:10', '10:11'], ['k', '10:16', null],
    ]);
    expect(describeSource(r.source, r.legs, nameOf)).toBe('Inferred from 2 paths · ⚠ Charlie → Kilo: no path data');
  });

  it('falls back when a route would pass a station already in the train', () => {
    const r = planDraft(req([pt('b'), pt('k'), pt('a')]), tt([MAIN, branch]), null);
    expect(r.legs[0]).toMatchObject({ source: 'inferred', viaStationIds: ['c', 'j'] });
    expect(r.legs[1]).toMatchObject({ source: 'none', viaStationIds: [], minutes: 5 });
    expect(r.warnings).toEqual(['Kilo → Alpha: route would pass Juliet twice, 5 min used']);
    expect(r.train.stops.map((s) => s.station_id).sort()).toEqual(['a', 'b', 'c', 'j', 'k']);
  });

  it('falls back when a via is a later requested point', () => {
    const r = planRoute(req([pt('a'), pt('d'), pt('c')]), tt([MAIN]));
    expect(r.legs[0]).toMatchObject({ source: 'none' });
    expect(r.warnings[0]).toBe('Alpha → Delta: route would pass Charlie twice, 5 min used');
    expect(r.legs[1]).toMatchObject({ source: 'inferred', viaStationIds: [], minutes: 5 });
  });

  it('ignores negative and non-finite legs', () => {
    const bad = path('p-bad', 'Bad', [['a', 0], ['b', -2], ['c', Number.NaN]]);
    const r = planRoute(req([pt('a'), pt('c')]), tt([bad]));
    expect(r.source).toEqual({ kind: 'none' });
  });

  it('drops path stops at stations not in the timetable, merging their legs', () => {
    const p = path('p-gone', 'Gone', [['a', 0], ['zz', 2], ['b', 3]]);
    const r = planRoute(req([pt('a'), pt('b')]), tt([p]));
    expect(r.legs[0]).toMatchObject({ source: 'path', viaStationIds: [], minutes: 5 });
  });

  it('allows 0-minute legs', () => {
    const r = planRoute(req([pt('a'), pt('b')]), tt([path('p0', 'Zero', [['a', 0], ['b', 0]])]));
    expect(r.legs[0]).toMatchObject({ source: 'path', minutes: 0 });
  });
});

describe('no path data', () => {
  it('uses request_default_leg_min and reports none', () => {
    const r = planDraft(req([pt('a'), pt('e')]), tt([], {}, { request_default_leg_min: 7 }), null);
    expect(r.source).toEqual({ kind: 'none' });
    expect(r.legs).toEqual([{ fromStationId: 'a', toStationId: 'e', viaStationIds: [], minutes: 7, source: 'none' }]);
    expect(r.warnings).toEqual(['Alpha → Echo: no path data, 7 min used']);
    expect(times(r.train)).toEqual([['a', null, '10:00'], ['e', '10:07', null]]);
    expect(describeSource(r.source, r.legs, nameOf)).toBe('No path data');
  });

  it('guards duplicate requested stations', () => {
    const r = planRoute(req([pt('a'), pt('b'), pt('a')]), tt([MAIN]));
    expect(r.legs).toHaveLength(1);
    expect(r.warnings).toEqual(['Alpha requested twice, ignored']);
  });
});

describe('stops', () => {
  it('applies dwell rules per kind and the terminal rule', () => {
    const r = planDraft(req([
      pt('a', { note: 'Off the loco road', location_alias: 'Road 2' }),
      pt('b', { kind: 'stop', minutes: 0, note: 'Pick up staff' }),
      pt('c', { kind: 'work', minutes: 0 }),
      pt('d', { kind: 'work', minutes: 5, note: 'Unload' }),
      pt('e', { location_alias: 'Siding 1' }),
    ]), tt([MAIN]), null);
    expect(times(r.train)).toEqual([
      ['a', null, '10:00'], ['b', '10:04', '10:05'], ['c', '10:11', '10:11'], ['d', '10:16', '10:21'], ['e', '10:24', null],
    ]);
    const by = new Map(r.train.stops.map((s) => [s.station_id, s]));
    expect(by.get('a')).toMatchObject({ location_alias: 'Road 2', special_instructions: 'Off the loco road' });
    expect(by.get('b')!.special_instructions).toBe('Pick up staff');
    expect(by.get('c')!.special_instructions).toBe('Work 0 min');
    expect(by.get('d')!.special_instructions).toBe('Work 5 min: Unload');
    expect(by.get('e')).toMatchObject({ location_alias: 'Siding 1', departure: null });
  });

  it('gives passing stations nothing but times', () => {
    const r = planDraft(req([pt('a'), pt('c')]), tt([MAIN]), null);
    const b = r.train.stops.find((s) => s.station_id === 'b')!;
    expect(b).toEqual({ id: b.id, train_id: r.train.id, station_id: 'b', arrival: '10:04', departure: '10:04' });
  });

  it('uses pending ids for the train and its stops (n = running position)', () => {
    const r = planDraft(req([pt('e'), pt('c')]), tt([MAIN]), null);
    expect(r.train.id).toBe(pendingTrainId('r1'));
    expect(r.train.id).toBe('pending:r1');
    expect(runningOrder(r.train.stops).map((s) => s.id)).toEqual(['pending:r1:0', 'pending:r1:1', 'pending:r1:2']);
    expect(r.train.stops.every((s) => s.train_id === 'pending:r1')).toBe(true);
  });

  it('stores an Up train with branch stations in station order and runningOrder recovers the plan', () => {
    const branch = path('p-br', 'Branch', [['c', 0], ['j', 3], ['k', 2]]);
    const r = planDraft(req([pt('k'), pt('a')]), tt([MAIN, branch]), null);
    expect(r.train.direction).toBe('Up');
    expect(r.train.stops.map((s) => s.station_id)).toEqual(['a', 'b', 'c', 'j', 'k']);
    expect(runningOrder(r.train.stops).map((s) => s.station_id)).toEqual(['k', 'j', 'c', 'b', 'a']);
  });
});

describe('start time', () => {
  const two = [pt('a'), pt('b')];
  const settings = { request_lead_min: 3 };

  it('uses ready_at when the clock is unknown', () => {
    expect(planDraft(req(two, { ready_at: '14:20' }), tt([MAIN]), null).startMinutes).toBe(860);
  });

  it('uses ready_at when it is not before the clock', () => {
    expect(planDraft(req(two, { ready_at: '14:20' }), tt([MAIN], {}, settings), 600).startMinutes).toBe(860);
    expect(planDraft(req(two, { ready_at: '10:00' }), tt([MAIN], {}, settings), 600).startMinutes).toBe(600);
  });

  it('uses the clock rounded up plus the lead when ready_at is past', () => {
    expect(planDraft(req(two, { ready_at: '09:00' }), tt([MAIN], {}, settings), 600.2).startMinutes).toBe(604);
  });

  it('uses the clock plus the default lead (2) for ASAP', () => {
    const r = planDraft(req(two, { ready_at: null }), tt([MAIN]), 600);
    expect(r.startMinutes).toBe(602);
    expect(r.train.stops[0].departure).toBe('10:02');
  });

  it('uses the timetable start time with no clock and no ready_at', () => {
    const r = planDraft(req(two, { ready_at: null }), tt([MAIN]), null);
    expect(r.startMinutes).toBe(360);
    expect(times(r.train)).toEqual([['a', null, '06:00'], ['b', '06:04', null]]);
  });

  it('treats a ready_at just after midnight as the future from a late clock', () => {
    expect(planDraft(req(two, { ready_at: '00:10' }), tt([MAIN]), 1430).startMinutes).toBe(1450);
  });

  it('wraps times past midnight', () => {
    const r = planDraft(req([pt('a'), pt('d')], { ready_at: null }), tt([MAIN]), 1435);
    expect(r.startMinutes).toBe(1437);
    expect(times(r.train)).toEqual([
      ['a', null, '23:57'], ['b', '00:01', '00:01'], ['c', '00:07', '00:07'], ['d', '00:12', null],
    ]);
  });
});

describe('train fields', () => {
  it('fills name, crew, colour, loco, notes, request link and direction', () => {
    const r = planDraft(req([pt('a'), pt('c')], { loco: 'NR 101', notes: 'Grain empties' }), tt([MAIN]), null);
    expect(r.train).toMatchObject({
      name: 'PR1', crew_id: 'c1', color: '#ff0000', train_id: 'NR 101', notes: 'Grain empties',
      request_id: 'r1', timetable_id: 't', direction: 'Down',
    });
  });

  it('numbers past used names with the prefix, skipping gaps correctly', () => {
    const trains = [train('1', 'PR1'), train('2', 'PR2'), train('3', 'PR4'), train('4', 'PR3a'), train('5', 'XPR3')];
    expect(planDraft(req([pt('a'), pt('b')]), tt([MAIN], { trains }), null).train.name).toBe('PR3');
  });

  it('uses the configured prefix', () => {
    const trains = [train('1', 'X1'), train('2', 'PR1')];
    expect(planDraft(req([pt('a'), pt('b')]), tt([MAIN], { trains }, { request_train_prefix: 'X' }), null).train.name).toBe('X2');
  });

  it('falls back to defaults for an unknown crew and missing loco/notes', () => {
    const r = planDraft(req([pt('a'), pt('b')], { crew_id: 'nobody' }), tt([MAIN]), null);
    expect(r.train).toMatchObject({ color: '#3b82f6', train_id: '', notes: '', crew_id: 'nobody' });
  });
});

describe('describeSource', () => {
  it('describes each kind', () => {
    expect(describeSource({ kind: 'path', pathId: 'p', pathName: 'Kiama–Bombo' }, [], nameOf)).toBe('Path Kiama–Bombo');
    expect(describeSource({ kind: 'inferred', pathNames: ['One'] }, [], nameOf)).toBe('Inferred from 1 path');
    expect(describeSource({ kind: 'none' }, [], nameOf)).toBe('No path data');
  });
});
