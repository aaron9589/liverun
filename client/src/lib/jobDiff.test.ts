import { describe, it, expect } from 'vitest';
import { diffJobs, type JobChange } from './jobDiff';
import type { Crew, Timetable, Train, TrainStop } from '../types';

const crew = (id: string, name: string): Crew => ({ id, timetable_id: 'tt', name, color: '#888888' });

let stopSeq = 0;
/** Stop with a fresh id each call — the server re-mints stop ids on every save. */
const stop = (station_id: string, arrival: string | null, departure: string | null): TrainStop =>
  ({ id: `s${++stopSeq}`, train_id: 'x', station_id, arrival, departure });

const train = (id: string, name: string, crew_id: string | undefined, stops: TrainStop[]): Train =>
  ({ id, timetable_id: 'tt', name, color: '#3b82f6', notes: '', crew_id, stops });

const tt = (trains: Train[]): Timetable => ({
  id: 'tt', name: 'TT', description: '', start_time: '06:00', end_time: '22:00',
  created_at: '', updated_at: '', stations: [], paths: [],
  crews: [crew('c1', 'Local Operator 1'), crew('c2', 'Local Operator 2')],
  settings: { clock_enabled: false, clock_broker_url: '', clock_topic: '', auto_assign_min_break: 0 },
  trains,
});

const sl21 = (crewId: string | null = 'c1', name = 'SL21') =>
  train('t1', name, crewId ?? undefined, [stop('A', null, '10:00'), stop('B', '10:10', '10:12'), stop('C', '10:20', null)]);

const types = (changes: JobChange[]) => changes.map((c) => c.type);

describe('diffJobs', () => {
  it('reports nothing for an identical re-save (fresh stop ids, same times)', () => {
    expect(diffJobs(tt([sl21()]), tt([sl21()]), ['c1'])).toEqual([]);
  });

  it('new train for my crew → added; for another crew → nothing', () => {
    const next = tt([sl21(), train('t2', '31L', 'c1', []), train('t3', '40F', 'c2', [])]);
    const changes = diffJobs(tt([sl21()]), next, ['c1']);
    expect(changes).toEqual([{ type: 'added', train: next.trains[1] }]);
  });

  it('deleted train → removed with the old copy', () => {
    const prev = tt([sl21()]);
    expect(diffJobs(prev, tt([]), ['c1'])).toEqual([{ type: 'removed', train: prev.trains[0] }]);
  });

  it('reassigned away → reassigned with the new crew, or null when unassigned', () => {
    const toC2 = diffJobs(tt([sl21()]), tt([sl21('c2')]), ['c1']);
    expect(toC2).toHaveLength(1);
    expect(toC2[0]).toMatchObject({ type: 'reassigned', crew: { id: 'c2', name: 'Local Operator 2' } });
    expect(diffJobs(tt([sl21()]), tt([sl21(null)]), ['c1'])[0]).toMatchObject({ type: 'reassigned', crew: null });
  });

  it('reassigned to my crew → added', () => {
    expect(types(diffJobs(tt([sl21('c2')]), tt([sl21('c1')]), ['c1']))).toEqual(['added']);
  });

  it('time change → retimed with the changed stop ids only', () => {
    const next = sl21();
    next.stops[1] = { ...next.stops[1], departure: '10:15' };
    const changes = diffJobs(tt([sl21()]), tt([next]), ['c1']);
    expect(changes).toEqual([{ type: 'retimed', train: next, stopIds: [next.stops[1].id] }]);
  });

  it('stop added or removed → retimed', () => {
    const added = sl21();
    added.stops.splice(2, 0, stop('D', '10:15', '10:16'));
    expect(diffJobs(tt([sl21()]), tt([added]), ['c1'])).toEqual([{ type: 'retimed', train: added, stopIds: [added.stops[2].id] }]);

    const removed = sl21();
    removed.stops.splice(1, 1);
    expect(diffJobs(tt([sl21()]), tt([removed]), ['c1'])).toEqual([{ type: 'retimed', train: removed, stopIds: [] }]);
  });

  it('repeat visits to a station are matched in order', () => {
    const shuttle = () => train('t9', 'KH02', 'c1', [stop('K', null, '09:00'), stop('J', '09:10', '09:20'), stop('K', '09:30', null)]);
    const next = shuttle();
    next.stops[2] = { ...next.stops[2], arrival: '09:35' };
    expect(diffJobs(tt([shuttle()]), tt([next]), ['c1'])).toEqual([{ type: 'retimed', train: next, stopIds: [next.stops[2].id] }]);
  });

  it('rename and retime together → both', () => {
    const next = sl21('c1', 'SL21A');
    next.stops[0] = { ...next.stops[0], departure: '09:58' };
    const changes = diffJobs(tt([sl21()]), tt([next]), ['c1']);
    expect(types(changes)).toEqual(['renamed', 'retimed']);
    expect(changes[0]).toMatchObject({ oldName: 'SL21' });
  });

  it('ignores trains outside my crews', () => {
    const prev = tt([sl21('c2')]);
    const next = tt([sl21('c2', 'SL99')]);
    expect(diffJobs(prev, next, ['c1'])).toEqual([]);
  });

  it("'' selects unassigned trains", () => {
    expect(types(diffJobs(tt([sl21(null)]), tt([sl21('c1')]), ['']))).toEqual(['reassigned']);
    expect(types(diffJobs(tt([sl21('c1')]), tt([sl21(null)]), ['']))).toEqual(['added']);
  });

  it('null (all trains): crew changes are not reassignments', () => {
    expect(diffJobs(tt([sl21('c1')]), tt([sl21('c2')]), null)).toEqual([]);
    expect(types(diffJobs(tt([]), tt([sl21('c2')]), null))).toEqual(['added']);
    expect(types(diffJobs(tt([sl21('c2')]), tt([]), null))).toEqual(['removed']);
  });
});
