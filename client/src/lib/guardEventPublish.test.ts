import { describe, it, expect } from 'vitest';
import type { Station, Train, TrainStop } from '../types';
import { eventPublishPayload } from './guardEventPublish';
import type { RolledEvent } from './guardEvents';

const stations = [
  { id: 'k', name: 'Kiama' }, { id: 'b', name: 'Berry' }, { id: 'x', name: 'Pass' },
] as Station[];
const stop = (id: string, st: string, arr: string | null, dep: string | null): TrainStop =>
  ({ id, train_id: 't', station_id: st, arrival: arr, departure: dep });
const train = {
  id: 't', timetable_id: 'x', name: 'SL21', color: '#fff', notes: '', train_id: 'V-12',
  stops: [stop('1', 'k', null, '7:00'), stop('2', 'x', null, null), stop('3', 'b', '7:20', null)],
} as Train;
const ev = (o: Partial<RolledEvent>): RolledEvent => ({
  placementId: 'p', stopKey: 'k#0', kind: 'station', eventId: null, happens: true, message: 'Hello',
  sound: '', status: 'fired', src: '', ...o,
});

describe('eventPublishPayload', () => {
  const now = Date.UTC(2026, 0, 1);
  it('station event names the stop; inline id', () => {
    expect(eventPublishPayload(ev({}), train, stations, 421, now)).toEqual({
      train: 'SL21', trainId: 'V-12', stop: 'Kiama', event: 'inline', message: 'Hello',
      clock: '7:01', at: '2026-01-01T00:00:00.000Z',
    });
  });
  it('en-route event names the section to the next timed stop; null clock', () => {
    const p = eventPublishPayload(ev({ kind: 'enroute', eventId: 'brakes' }), train, stations, null, now);
    expect(p.section).toBe('Kiama → Berry');
    expect(p.event).toBe('brakes');
    expect(p.clock).toBeNull();
    expect(p.stop).toBeUndefined();
  });
});
