import { describe, expect, it } from 'vitest';
import type { PathRequest, Timetable, Train } from '../types';
import {
  apiErrorText, buildSubmit, canSubmit, defaultFrom, myRequests, requestStatusText, requestToasts, routeLabel,
  cancelAskText, canAskCancel, controlNote, isFaded, type RequestDraft,
} from './pathRequests';

const stations = [
  { id: 'k', name: 'Kiama' }, { id: 'b', name: 'Bombo' }, { id: 'd', name: 'Dunmore' },
];

const req = (over: Partial<PathRequest> = {}): PathRequest => ({
  id: 'r1', timetable_id: 't', crew_id: 'c1',
  stops: [
    { station_id: 'k', kind: 'stop', minutes: 0 },
    { station_id: 'b', kind: 'shunt', minutes: 20 },
    { station_id: 'd', kind: 'stop', minutes: 0 },
  ],
  status: 'pending', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const train = (id: string, name: string, crew: string, stops: [string, string | null, string | null][], alias?: string): Train => ({
  id, timetable_id: 't', name, color: '#fff', notes: '', crew_id: crew,
  stops: stops.map(([station_id, arrival, departure], i) => ({
    id: `${id}-${i}`, train_id: id, station_id, arrival, departure, ...(i === stops.length - 1 && alias ? { location_alias: alias } : {}),
  })),
});

const tt = (trains: Train[] = []): Timetable => ({
  id: 't', name: 'T', description: '', start_time: '00:00', end_time: '23:59',
  stations: stations.map((s, i) => ({ ...s, timetable_id: 't', short_code: s.id, distance: 0, graph_pos: i, sort_order: i })),
  trains, paths: [], crews: [{ id: 'c1', timetable_id: 't', name: 'Crew 1', color: '#f00' }, { id: 'c3', timetable_id: 't', name: 'Crew 3', color: '#0f0' }],
  settings: { clock_enabled: false, clock_broker_url: '', clock_topic: '', auto_assign_min_break: 0 },
} as unknown as Timetable);

const draft = (over: Partial<RequestDraft> = {}): RequestDraft => ({
  crewId: 'c1', loco: '', from: { stationId: 'k', alias: '' }, via: [], to: { stationId: 'd', alias: '' },
  asap: true, readyAt: '', notes: '', ...over,
});

describe('routeLabel', () => {
  it('shows work minutes and sidings', () => {
    expect(routeLabel(req(), stations)).toBe('Kiama → Bombo (shunt 20) → Dunmore');
    const r = req({ stops: [{ station_id: 'k', location_alias: 'Rd 2', kind: 'stop', minutes: 0 }, { station_id: 'd', kind: 'stop', minutes: 0 }] });
    expect(routeLabel(r, stations)).toBe('Kiama Rd 2 → Dunmore');
  });
  it('labels stops with minutes and plain passing stops', () => {
    const r = req({ stops: [
      { station_id: 'k', kind: 'stop', minutes: 0 }, { station_id: 'b', kind: 'stop', minutes: 5 },
      { station_id: 'x', kind: 'stop', minutes: 0 }, { station_id: 'd', kind: 'stop', minutes: 0 }] });
    expect(routeLabel(r, stations)).toBe('Kiama → Bombo (stop 5) → ? → Dunmore');
  });
});

describe('requestStatusText', () => {
  const t = tt([train('p', 'PR3', 'c3', [['k', null, '10:00']])]);
  it('covers each status', () => {
    expect(requestStatusText(req(), t, 'c1')).toBe('Waiting for Control');
    expect(requestStatusText(req({ status: 'in_review' }), t, 'c1')).toBe('Control is plotting your path');
    expect(requestStatusText(req({ status: 'declined', control_note: 'No room' }), t, 'c1')).toBe('Declined: No room');
    expect(requestStatusText(req({ status: 'withdrawn' }), t, 'c1')).toBe('Withdrawn');
    expect(requestStatusText(req({ status: 'cancelled' }), t, 'c1')).toBe('Cancelled');
  });
  it('accepted: train name, other crew, removed train', () => {
    expect(requestStatusText(req({ status: 'accepted', train_id_created: 'p', assigned_crew_id: 'c1' }), t, 'c1')).toBe('Accepted → PR3');
    expect(requestStatusText(req({ status: 'accepted', train_id_created: 'p', assigned_crew_id: 'c3' }), t, 'c1')).toBe('Accepted → PR3 (assigned to Crew 3)');
    expect(requestStatusText(req({ status: 'accepted', train_id_created: 'gone' }), t, 'c1')).toBe('Accepted → train removed');
  });
});

describe('cancel asks', () => {
  it('open, rejected and ask-again', () => {
    const a = req({ status: 'accepted', cancel_ask: { at: 'x', status: 'open' } });
    expect(cancelAskText(a)).toBe('Waiting for Control');
    expect(canAskCancel(a)).toBe(false);
    const r = req({ status: 'accepted', cancel_ask: { at: 'x', status: 'rejected', control_note: 'Needed' } });
    expect(cancelAskText(r)).toBe('Cancel refused: Needed');
    expect(canAskCancel(r)).toBe(true);
    expect(canAskCancel(req())).toBe(false);
  });
  it('fades accepted cards after five minutes', () => {
    const r = req({ status: 'accepted', updated_at: '2026-01-01T00:00:00Z' });
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    expect(isFaded(r, t0 + 4 * 60_000)).toBe(false);
    expect(isFaded(r, t0 + 6 * 60_000)).toBe(true);
    expect(isFaded({ ...r, cancel_ask: { at: 'x', status: 'open' } }, t0 + 6 * 60_000)).toBe(false);
  });
});

describe('apiErrorText', () => {
  it('unwraps JSON bodies and passes other text through', () => {
    expect(apiErrorText(new Error('{"error":"Too many open requests"}'))).toBe('Too many open requests');
    expect(apiErrorText(new Error('Failed to fetch'))).toBe('Failed to fetch');
  });
});

describe('myRequests', () => {
  it('filters by crew, open first then newest', () => {
    const list = [
      req({ id: 'a', status: 'declined', created_at: '2026-01-03T00:00:00Z' }),
      req({ id: 'b', status: 'pending', created_at: '2026-01-01T00:00:00Z' }),
      req({ id: 'c', status: 'in_review', created_at: '2026-01-02T00:00:00Z' }),
      req({ id: 'd', crew_id: 'c3' }),
      req({ id: 'e', status: 'withdrawn', created_at: '2026-01-04T00:00:00Z' }),
    ];
    expect(myRequests(list, 'c1').map((r) => r.id)).toEqual(['c', 'b', 'e', 'a']);
    expect(myRequests(undefined, 'c1')).toEqual([]);
  });
});

describe('defaultFrom', () => {
  const a = train('a', '1L', 'c1', [['k', null, '08:00'], ['b', '08:30', null]]);
  const b = train('b', '2L', 'c1', [['b', null, '10:00'], ['d', '10:30', null]], 'Siding 1');
  const other = train('o', '9L', 'c3', [['k', null, '09:00'], ['k', '09:05', null]]);
  it('uses the last stop of the most recent started job', () => {
    expect(defaultFrom([a, b, other], 'c1', 9 * 60)).toEqual({ stationId: 'b', alias: '' });
    expect(defaultFrom([a, b, other], 'c1', 11 * 60)).toEqual({ stationId: 'd', alias: 'Siding 1' });
  });
  it('falls back to the first job before any has started, and with no clock', () => {
    expect(defaultFrom([a, b], 'c1', 6 * 60)?.stationId).toBe('b');
    expect(defaultFrom([a, b], 'c1', null)?.stationId).toBe('b');
  });
  it('null with no jobs', () => {
    expect(defaultFrom([other], 'c1', 9 * 60)).toBeNull();
  });
});

describe('canSubmit', () => {
  const via = (stationId: string) => ({ key: 'v', stationId, alias: '', kind: 'stop' as const, minutes: 0, note: '' });
  it('accepts a valid draft', () => expect(canSubmit(draft())).toEqual({ ok: true, reason: null }));
  it('needs From and To', () => {
    expect(canSubmit(draft({ from: { stationId: '', alias: '' } })).ok).toBe(false);
    expect(canSubmit(draft({ to: { stationId: '', alias: '' } })).ok).toBe(false);
  });
  it('From must differ from To', () => {
    const c = canSubmit(draft({ to: { stationId: 'k', alias: '' } }));
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/different/);
  });
  it('stations must be unique and via rows filled', () => {
    expect(canSubmit(draft({ via: [via('b')] })).ok).toBe(true);
    expect(canSubmit(draft({ via: [via('k')] })).ok).toBe(false);
    expect(canSubmit(draft({ via: [via('b'), via('b')] })).ok).toBe(false);
    expect(canSubmit(draft({ via: [via('')] })).ok).toBe(false);
  });
  it('needs a valid time when not ASAP', () => {
    expect(canSubmit(draft({ asap: false, readyAt: '' })).ok).toBe(false);
    expect(canSubmit(draft({ asap: false, readyAt: '14:30' })).ok).toBe(true);
  });
});

describe('buildSubmit', () => {
  it('trims and drops empties; ends are stop/0', () => {
    const out = buildSubmit(draft({
      loco: '  3001 ', notes: '  ', from: { stationId: 'k', alias: ' Rd 2 ' },
      via: [{ key: 'v', stationId: 'b', alias: '  ', kind: 'shunt', minutes: 20, note: ' drop 2 ' }],
    }));
    expect(out).toEqual({
      crewId: 'c1', loco: '3001', readyAt: null,
      stops: [
        { stationId: 'k', locationAlias: 'Rd 2', kind: 'stop', minutes: 0 },
        { stationId: 'b', kind: 'shunt', minutes: 20, note: 'drop 2' },
        { stationId: 'd', kind: 'stop', minutes: 0 },
      ],
    });
  });
  it('sends the ready time and clamps minutes', () => {
    const out = buildSubmit(draft({
      asap: false, readyAt: '14:30', notes: ' hi ',
      via: [{ key: 'v', stationId: 'b', alias: '', kind: 'work', minutes: 999, note: '' }],
    }));
    expect(out.readyAt).toBe('14:30');
    expect(out.notes).toBe('hi');
    expect(out.stops[1].minutes).toBe(240);
  });
});

describe('requestToasts', () => {
  const t = tt([train('p', 'PR3', 'c3', [['k', null, '10:00']])]);
  const after = (over: Partial<PathRequest>) => requestToasts([req()], [req(over)], 'c1', t);
  it('declined, accepted, in review, cancelled', () => {
    expect(after({ status: 'declined', control_note: 'No' })).toEqual([{ message: 'Declined: No', tone: 'danger' }]);
    expect(after({ status: 'accepted', train_id_created: 'p', assigned_crew_id: 'c3' }))
      .toEqual([{ message: 'Path accepted → PR3 (Crew 3)', tone: 'success' }]);
    expect(after({ status: 'in_review' })).toEqual([{ message: 'Control is plotting your path', tone: 'info' }]);
    expect(after({ status: 'cancelled' })[0].message).toBe('Cancelled');
  });
  it('cancel refused once', () => {
    const open = req({ status: 'accepted', cancel_ask: { at: '1', status: 'open' } });
    const rej = req({ status: 'accepted', cancel_ask: { at: '1', status: 'rejected', control_note: 'Needed' } });
    expect(requestToasts([open], [rej], 'c1', t)).toEqual([{ message: 'Cancel refused: Needed', tone: 'warning' }]);
    expect(requestToasts([rej], [rej], 'c1', t)).toEqual([]);
  });
  it('ignores new, other-crew and unchanged requests', () => {
    expect(requestToasts([], [req({ status: 'declined' })], 'c1', t)).toEqual([]);
    expect(requestToasts([req({ crew_id: 'c3' })], [req({ crew_id: 'c3', status: 'declined' })], 'c1', t)).toEqual([]);
    expect(requestToasts([req()], [req()], 'c1', t)).toEqual([]);
    expect(after({ status: 'withdrawn' })).toEqual([]);
  });
});

describe('controlNote', () => {
  it('uses the cancel-approval note on a cancelled request', () => {
    const base = { id: 'r', timetable_id: 't', crew_id: 'c', stops: [], created_at: '', updated_at: '', control_note: 'Via the loop' };
    expect(controlNote({ ...base, status: 'accepted' } as PathRequest)).toBe('Via the loop');
    expect(controlNote({ ...base, status: 'cancelled', cancel_ask: { at: '', status: 'approved', control_note: ' Loco swapped ' } } as PathRequest)).toBe('Loco swapped');
    expect(controlNote({ ...base, status: 'cancelled', cancel_ask: { at: '', status: 'approved' } } as PathRequest)).toBeUndefined();
  });
});

describe('canAskCancel', () => {
  const base = { id: 'r', timetable_id: 't', crew_id: 'c', stops: [], created_at: '', updated_at: '', train_id_created: 'tr1' };
  it('needs an accepted request with no open ask', () => {
    expect(canAskCancel({ ...base, status: 'accepted' } as PathRequest)).toBe(true);
    expect(canAskCancel({ ...base, status: 'pending' } as PathRequest)).toBe(false);
    expect(canAskCancel({ ...base, status: 'accepted', cancel_ask: { at: '', status: 'open' } } as PathRequest)).toBe(false);
    expect(canAskCancel({ ...base, status: 'accepted', cancel_ask: { at: '', status: 'rejected' } } as PathRequest)).toBe(true);
  });
  it('needs the train to still exist when trains are given', () => {
    const r = { ...base, status: 'accepted' } as PathRequest;
    expect(canAskCancel(r, [{ id: 'tr1' }])).toBe(true);
    expect(canAskCancel(r, [{ id: 'other' }])).toBe(false);
  });
  it('is not affected by the card fading', () => {
    const old = { ...base, status: 'accepted', updated_at: '2026-01-01T00:00:00Z' } as PathRequest;
    expect(isFaded(old, Date.parse('2026-01-01T01:00:00Z'))).toBe(true);
    expect(canAskCancel(old, [{ id: 'tr1' }])).toBe(true);
  });
});
