import { describe, it, expect } from 'vitest';
import type { Train, TrainStop } from '../types';
import { sequenceStops, currentStop, autoSelectTrain, sortByRun, formsNext, runningOrder, inRunningOrder } from './stops';

const st = (id: string, arrival: string | null, departure: string | null): TrainStop =>
  ({ id, train_id: 't', station_id: id, arrival, departure });
const tr = (id: string, stops: TrainStop[], crew_id?: string): Train =>
  ({ id, timetable_id: 'x', name: id, color: '#fff', notes: '', crew_id, stops });

describe('sequenceStops', () => {
  it('unwraps across midnight and skips untimed stops', () => {
    const seq = sequenceStops(tr('a', [st('1', null, '23:50'), st('2', null, null), st('3', '00:05', '00:07'), st('4', '00:20', null)]));
    expect(seq.map((s) => [s.arr, s.dep])).toEqual([[1430, 1430], [1445, 1447], [1460, 1460]]);
  });
});

describe('currentStop', () => {
  const seq = sequenceStops(tr('a', [st('1', null, '10:00'), st('2', '10:10', '10:10'), st('3', '10:20', '10:25'), st('4', '10:40', null)]));
  it('pin wins', () => expect(currentStop(seq, 600, '3')).toEqual({ index: 2, state: 'pinned' }));
  it('at start, pass-through, window', () => {
    expect(currentStop(seq, 600, null)).toEqual({ index: 0, state: 'at' });
    expect(currentStop(seq, 610, null)).toEqual({ index: 1, state: 'at' });
    expect(currentStop(seq, 622, null)).toEqual({ index: 2, state: 'at' });
  });
  it('between stops is next', () => expect(currentStop(seq, 615, null)).toEqual({ index: 2, state: 'next' }));
  it('before run is first as next; after run is none', () => {
    expect(currentStop(seq, 540, null)).toEqual({ index: 0, state: 'next' });
    expect(currentStop(seq, 700, null)).toEqual({ index: -1, state: 'none' });
  });
  it('null clock is none', () => expect(currentStop(seq, null, null).state).toBe('none'));
  it('midnight wrap', () => {
    const m = sequenceStops(tr('m', [st('1', null, '23:50'), st('2', '00:05', '00:07'), st('3', '00:20', null)]));
    expect(currentStop(m, 5, null)).toEqual({ index: 1, state: 'at' });
    expect(currentStop(m, 23 * 60 + 55, null)).toEqual({ index: 1, state: 'next' });
    expect(currentStop(m, 12, null)).toEqual({ index: 2, state: 'next' });
  });
});

describe('train selection', () => {
  const a = tr('a', [st('1', null, '08:00'), st('2', '09:00', null)], 'c');
  const b = tr('b', [st('1', null, '10:00'), st('2', '11:00', null)], 'c');
  const late = tr('late', [st('1', null, '23:30'), st('2', '00:30', null)], 'c');
  it('sorts by start', () => expect(sortByRun([b, a]).map((t) => t.id)).toEqual(['a', 'b']));
  it('contains clock / next / fallback', () => {
    expect(autoSelectTrain([a, b], 8 * 60 + 30)?.id).toBe('a');
    expect(autoSelectTrain([a, b], 9 * 60 + 30)?.id).toBe('b');
    expect(autoSelectTrain([a, b], 12 * 60)?.id).toBe('a');
    expect(autoSelectTrain([a, b], null)?.id).toBe('a');
    expect(autoSelectTrain([late], 15)?.id).toBe('late');
  });
  it('forms next', () => {
    expect(formsNext(a, [a, b])?.id).toBe('b');
    expect(formsNext(b, [a, b])).toBeNull();
  });
});

describe('runningOrder (planner stores stops in station order)', () => {
  // C402 from Base MTP B: stored Staging (Up) 06:03 / Kembla Jn 05:38 / Kiama 05:19
  const up = tr('C402', [st('sta', '06:03', null), st('kjn', '05:38', '05:38'), st('kia', null, '05:19')]);
  it('reverses a train stored backwards', () => {
    expect(runningOrder(up.stops).map((s) => s.id)).toEqual(['kia', 'kjn', 'sta']);
    expect(sequenceStops(up).map((s) => s.stop.id)).toEqual(['kia', 'kjn', 'sta']);
    expect(inRunningOrder(up).stops[0].id).toBe('kia');
  });
  it('keeps a forward train (same array / object)', () => {
    const down = tr('K421', [st('kia', null, '05:19'), st('kjn', '05:38', '05:38'), st('sta', '06:03', null)]);
    expect(runningOrder(down.stops)).toBe(down.stops);
    expect(inRunningOrder(down)).toBe(down);
  });
  it('is midnight-safe and carries untimed stops along', () => {
    const late = tr('N1', [st('c', '00:10', null), st('x', null, null), st('a', null, '23:50')]);
    expect(runningOrder(late.stops).map((s) => s.id)).toEqual(['a', 'x', 'c']);
    const forward = tr('N2', [st('a', null, '23:50'), st('c', '00:10', null)]);
    expect(runningOrder(forward.stops)).toBe(forward.stops);
  });
  it('fixes run spans and auto-select for backwards-stored trains', () => {
    const later = tr('L', [st('kia', null, '07:00'), st('sta', '07:30', null)]);
    expect(sortByRun([later, up]).map((t) => t.id)).toEqual(['C402', 'L']);
    expect(autoSelectTrain([later, up], 5 * 60 + 40)?.id).toBe('C402');
  });
});
