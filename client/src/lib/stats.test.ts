import { describe, expect, it } from 'vitest';
import { statsMessage, statsPayload, statsTopic, type StatsRecord } from './stats';
import type { StatsConfig } from '../types';

const rec: StatsRecord = {
  train: '23L', trainId: 'CityRail V-12', station: 'Kiama', boarded: 41, leftBehind: 3,
  runners: 1, clock: '7:45', dwellSeconds: 52, at: '2026-01-01T00:00:00.000Z',
};
const cfg: StatsConfig = { enabled: true, topic: 'trains/stats/passengersMoved/{train}', payload: 'count', publish_on: 'door_close' };

describe('stats', () => {
  it('sanitises placeholders', () => {
    expect(statsTopic('a/{train}/{trainId}/{station}', { train: 'a/b', trainId: 'x+y', station: 'c#d' })).toBe('a/a_b/x_y/c_d');
  });
  it('count payload is a plain integer', () => {
    expect(statsPayload('count', rec)).toBe('41');
  });
  it('json payload has the documented fields', () => {
    expect(JSON.parse(statsPayload('json', rec))).toEqual({
      train: '23L', trainId: 'CityRail V-12', station: 'Kiama', boarded: 41, leftBehind: 3,
      runners: 1, clock: '7:45', dwellSeconds: 52, at: rec.at,
    });
  });
  it('honours enabled, topic and publish_on', () => {
    expect(statsMessage(cfg, 'door_close', rec)).toEqual({ topic: 'trains/stats/passengersMoved/23L', payload: '41' });
    expect(statsMessage(cfg, 'boarding_start', rec)).toBeNull();
    expect(statsMessage({ ...cfg, enabled: false }, 'door_close', rec)).toBeNull();
    expect(statsMessage({ ...cfg, topic: ' ' }, 'door_close', rec)).toBeNull();
  });
});
