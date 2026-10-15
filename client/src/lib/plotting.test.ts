import { describe, it, expect } from 'vitest';
import type { PathRequest, Train, TrainRequest } from '../types';
import { draftFromRequest, plotRequestState, retimeFromDrafts } from './plotting';

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
