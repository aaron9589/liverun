import { describe, it, expect } from 'vitest';
import type { Train, TrainStop } from '../types';
import { sequenceStops, currentStop, autoSelectTrain, sortByRun, formsNext } from './stops';

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
