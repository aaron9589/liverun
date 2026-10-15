import { describe, expect, it } from 'vitest';
import { buildBoardingContext, stopPosition } from './boardingContext';
import { sequenceStops } from './stops';
import type { Station, Train } from '../types';

const st = (id: string, w?: number) => ({ id, name: id.toUpperCase(), boarding_weight: w }) as unknown as Station;
const stop = (id: string, a: string | null, d: string | null) =>
  ({ id: 's-' + id, train_id: 't', station_id: id, arrival: a, departure: d }) as never;
const train = {
  id: 't', name: '23L', train_id: 'V-12', direction: 'Up',
  stops: [stop('a', null, '07:00'), stop('b', '07:10', '07:12'), stop('c', '07:20', null)],
} as unknown as Train;
const seq = sequenceStops(train);
const stations = [st('a'), st('b', 1.5), st('c')];

describe('boardingContext', () => {
  it('positions', () => {
    expect(stopPosition(0, 3)).toBe('origin');
    expect(stopPosition(1, 3)).toBe('intermediate');
    expect(stopPosition(2, 3)).toBe('terminus');
  });
  it('uses the clock and station weight', () => {
    const c = buildBoardingContext({ train, seq, stations, clockMinutes: 7 * 60 + 11, pinnedStopId: null })!;
    expect(c.position).toBe('intermediate');
    expect(c.count.stationWeight).toBe(1.5);
    expect(c.count.clockMinutes).toBe(431);
    expect(c.count.direction).toBe('Up');
  });
  it('pin wins and clock falls back to the scheduled time', () => {
    const c = buildBoardingContext({ train, seq, stations, clockMinutes: null, pinnedStopId: 's-c' })!;
    expect(c.position).toBe('terminus');
    expect(c.count.clockMinutes).toBe(7 * 60 + 20);
  });
  it('null when no stop is known', () => {
    expect(buildBoardingContext({ train, seq, stations, clockMinutes: null, pinnedStopId: null })).toBeNull();
  });
});
