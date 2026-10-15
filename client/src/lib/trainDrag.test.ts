import { describe, expect, it } from 'vitest';
import type { TrainStop } from '../types';
import { dragStopTime, shiftStops } from './trainDrag';

const st = (id: string, arrival: string | null, departure: string | null): TrainStop =>
  ({ id, train_id: 't', station_id: id, arrival, departure });
const times = (stops: TrainStop[]) => stops.map((s) => `${s.id} ${s.arrival ?? '-'}/${s.departure ?? '-'}`);

// KN-6 as stored (station order, so backwards): Kiama arr 13:18, Berry 12:32/12:50, Nowra dep 12:10
const kn6 = [st('kia', '13:18', null), st('bry', '12:32', '12:50'), st('now', null, '12:10')];

describe('shiftStops', () => {
  it('moves every time and keeps the stored order', () => {
    expect(times(shiftStops(kn6, 5))).toEqual(['kia 13:23/-', 'bry 12:37/12:55', 'now -/12:15']);
    expect(times(shiftStops(kn6, -10))).toEqual(['kia 13:08/-', 'bry 12:22/12:40', 'now -/12:00']);
    expect(shiftStops(kn6, 0)).toBe(kn6);
  });
  it('wraps across midnight', () => {
    const late = [st('a', null, '23:50'), st('b', '00:20', null)];
    expect(times(shiftStops(late, 15))).toEqual(['a -/00:05', 'b 00:35/-']);
  });
  it('keeps other stop fields', () => {
    const withNote = [{ ...st('a', null, '10:00'), special_instructions: 'x', location_alias: 'Siding' }, st('b', '10:10', null)];
    expect(shiftStops(withNote, 1)[0]).toMatchObject({ special_instructions: 'x', location_alias: 'Siding', departure: '10:01' });
  });
});

describe('dragStopTime', () => {
  it('stretching a dwell pushes the rest of the run later', () => {
    const r = dragStopTime(kn6, 'bry', 'dep', 5);
    expect(r.delta).toBe(5);
    expect(times(r.stops)).toEqual(['kia 13:23/-', 'bry 12:32/12:55', 'now -/12:10']);
  });
  it('a later arrival lengthens the running time and moves everything after it', () => {
    expect(times(dragStopTime(kn6, 'bry', 'arr', 3).stops)).toEqual(['kia 13:21/-', 'bry 12:35/12:53', 'now -/12:10']);
  });
  it('pulling a pass-through stop apart makes it a dwell', () => {
    const pass = [st('a', null, '10:00'), st('b', '10:10', '10:10'), st('c', '10:30', null)];
    expect(times(dragStopTime(pass, 'b', 'dep', 4).stops)).toEqual(['a -/10:00', 'b 10:10/10:14', 'c 10:34/-']);
  });
  it('never makes a negative dwell or running time', () => {
    const r = dragStopTime(kn6, 'bry', 'dep', -30);
    expect(r.delta).toBe(-18);
    expect(times(r.stops)).toEqual(['kia 13:00/-', 'bry 12:32/12:32', 'now -/12:10']);
    expect(dragStopTime(kn6, 'bry', 'arr', -60).delta).toBe(-22);
  });
  it('first departure moves the whole train; no arrival on the first stop', () => {
    expect(times(dragStopTime(kn6, 'now', 'dep', 2).stops)).toEqual(times(shiftStops(kn6, 2)));
    expect(dragStopTime(kn6, 'now', 'arr', 5)).toEqual({ stops: kn6, delta: 0 });
    expect(dragStopTime(kn6, 'nope', 'dep', 5)).toEqual({ stops: kn6, delta: 0 });
  });
  it('works across midnight', () => {
    const late = [st('a', null, '23:50'), st('b', '23:58', '23:59'), st('c', '00:20', null)];
    expect(times(dragStopTime(late, 'b', 'dep', 5).stops)).toEqual(['a -/23:50', 'b 23:58/00:04', 'c 00:25/-']);
  });
});
