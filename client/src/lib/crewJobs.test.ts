import { describe, expect, it } from 'vitest';
import { fmtMins, jobSummary, nextOpenJob, parseOpenState } from './crewJobs';
import type { SeqStop } from './stops';
import type { TrainStop } from '../types';

const seqStop = (station_id: string, arr: number, dep: number): SeqStop => ({
  stop: { id: station_id, train_id: 't', station_id, arrival: null, departure: null } as TrainStop,
  arr,
  dep,
});
const stations = [{ id: 'a', name: 'Kiama' }, { id: 'b', name: 'Bombo' }];

describe('fmtMins', () => {
  it('pads and wraps past midnight', () => {
    expect(fmtMins(5)).toBe('00:05');
    expect(fmtMins(1450)).toBe('00:10');
  });
});

describe('jobSummary', () => {
  it('uses first departure and last arrival', () => {
    expect(jobSummary([seqStop('a', 860, 860), seqStop('b', 902, 910)], stations)).toBe('Kiama 14:20 → Bombo 15:02');
  });
  it('handles empty and single-stop runs', () => {
    expect(jobSummary([], stations)).toBeNull();
    expect(jobSummary([seqStop('a', 860, 870)], stations)).toBe('Kiama 14:20');
  });
  it('falls back for unknown stations', () => {
    expect(jobSummary([seqStop('x', 0, 0), seqStop('b', 60, 60)], stations)).toBe('? 00:00 → Bombo 01:00');
  });
});

describe('nextOpenJob', () => {
  it('is the first job in run order not marked done', () => {
    expect(nextOpenJob([{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }, { id: 'c' }])).toBe('b');
    expect(nextOpenJob([{ id: 'a', status: 'completed' }, { id: 'b' }])).toBe('b');
  });
  it('is null when every job is done or there are none', () => {
    expect(nextOpenJob([{ id: 'a', status: 'completed' }])).toBeNull();
    expect(nextOpenJob([])).toBeNull();
  });
});

describe('parseOpenState', () => {
  it('reads saved booleans and drops anything else', () => {
    expect(parseOpenState('{"a":true,"b":false,"c":1}')).toEqual({ a: true, b: false });
  });
  it('treats missing or malformed storage as nothing saved', () => {
    expect(parseOpenState(null)).toEqual({});
    expect(parseOpenState('not json')).toEqual({});
    expect(parseOpenState('[true]')).toEqual({});
    expect(parseOpenState('null')).toEqual({});
  });
});
