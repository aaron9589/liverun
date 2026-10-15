import { describe, it, expect } from 'vitest';
import type { GuardEventDef, GuardEventPlacement, Train, TrainStop } from '../types';
import { mulberry32 } from './boarding';
import {
  rollEvents,
  reconcileRolled,
  onDoor,
  tick,
  stopKeyOf,
  stopKeysOf,
  pendingEvents,
  type RolledState,
  type Rng,
} from './guardEvents';

const hm = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

let idSeq = 0;
const st = (station: string, arrival: string | null, departure: string | null, guard_events?: GuardEventPlacement[]): TrainStop => ({
  id: `s${++idSeq}`,
  train_id: 't1',
  station_id: station,
  arrival,
  departure,
  ...(guard_events ? { guard_events } : {}),
});
const tr = (stops: TrainStop[]): Train => ({ id: 't1', timetable_id: 'x', name: 'T1', color: '#fff', notes: '', stops });
/** Re-save: same content, fresh stop ids (as the server does). */
const remint = (t: Train): Train => ({ ...t, stops: t.stops.map((s) => ({ ...s, id: `s${++idSeq}` })) });

/** Cycling fixed-value RNG. */
const fixed = (...vals: number[]): Rng => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

const lib: GuardEventDef[] = [
  { id: 'brakes', name: 'Sticking brakes', kind: 'enroute', messages: ['Brakes dragging', 'Brake smell'], sound: 'squeal.mp3', action: 'brake_squeal' },
  { id: 'unruly', name: 'Unruly passenger', kind: 'station', messages: ['Unruly passenger car 2'], sound: '' },
  { id: 'empty', name: 'Nameless fallback', kind: 'station', messages: [], sound: '' },
];

const station = (id: string, extra: Partial<GuardEventPlacement> = {}): GuardEventPlacement => ({
  id, kind: 'station', messages: [`msg ${id}`], probability: 1, trigger: 'door_open', delay_s: [10, 10], ...extra,
});
const enroute = (id: string, at: number, extra: Partial<GuardEventPlacement> = {}): GuardEventPlacement => ({
  id, kind: 'enroute', messages: [`msg ${id}`], probability: 1, at: [at, at], ...extra,
});

/** A dep 10:00 → B pass 10:10 → C 10:20/10:25 → D arr 10:40. */
const line = (pl: { A?: GuardEventPlacement[]; B?: GuardEventPlacement[]; C?: GuardEventPlacement[]; D?: GuardEventPlacement[] }): Train =>
  tr([st('A', null, '10:00', pl.A), st('B', '10:10', '10:10', pl.B), st('C', '10:20', '10:25', pl.C), st('D', '10:40', null, pl.D)]);

const rng = mulberry32(42);
const now = (realMs: number, clock: string | null) => ({ realMs, clockMin: clock === null ? null : hm(clock) });

describe('stop identity', () => {
  it('keys by station + visit, stable across re-mint', () => {
    const t = tr([st('A', null, '10:00'), st('B', '10:10', '10:11'), st('A', '10:20', null)]);
    expect(stopKeysOf(t)).toEqual(['A#0', 'B#0', 'A#1']);
    expect(stopKeyOf(t, t.stops[2].id)).toBe('A#1');
    expect(stopKeysOf(remint(t))).toEqual(stopKeysOf(t));
    expect(stopKeyOf(t, 'nope')).toBeNull();
  });
});

describe('rollEvents', () => {
  it('probability 0 never happens, 1 always happens', () => {
    const t = line({ A: [station('p0', { probability: 0 }), station('p1', { probability: 1 })] });
    for (let seed = 0; seed < 50; seed++) {
      const s = rollEvents(t, lib, mulberry32(seed));
      expect(s.events.find((e) => e.placementId === 'p0')?.happens).toBe(false);
      expect(s.events.find((e) => e.placementId === 'p1')?.happens).toBe(true);
    }
  });

  it('picks a message from the pool and a delay within range', () => {
    const t = line({ C: [station('m', { messages: ['one', 'two', 'three'], delay_s: [0, 20] })] });
    // draws: probability, message, timing
    const s = rollEvents(t, lib, fixed(0.1, 0.7, 0.25));
    expect(s.events[0]).toMatchObject({ message: 'three', delayMs: 5000, trigger: 'door_open', stopKey: 'C#0' });
    const seen = new Set<string>();
    const r = mulberry32(7);
    for (let i = 0; i < 60; i++) seen.add(rollEvents(t, lib, r).events[0].message);
    expect(seen).toEqual(new Set(['one', 'two', 'three']));
  });

  it('library vs inline vs override; unknown id and bad inline reported', () => {
    const t = line({
      A: [
        { id: 'lib', event: 'brakes', probability: 1, at: [0.5, 0.5] },
        { id: 'ovr', event: 'brakes', messages: ['Custom wording'], probability: 1 },
        { id: 'blank', event: 'brakes', messages: [''], probability: 1 },
        { id: 'inl', kind: 'station', messages: ['Inline'], probability: 1 },
        { id: 'unk', event: 'nope', probability: 1 },
        { id: 'nokind', messages: ['x'], probability: 1 },
        { id: 'nomsg', kind: 'station', messages: [], probability: 1 },
        { id: 'fallback', event: 'empty', probability: 1 },
      ],
    });
    const s = rollEvents(t, lib, fixed(0));
    const by = (id: string) => s.events.find((e) => e.placementId === id);
    expect(by('lib')).toMatchObject({ kind: 'enroute', eventId: 'brakes', message: 'Brakes dragging', sound: 'squeal.mp3', action: 'brake_squeal', at: 0.5 });
    expect(by('ovr')).toMatchObject({ kind: 'enroute', message: 'Custom wording', sound: 'squeal.mp3', action: 'brake_squeal', at: 0.2 });
    expect(by('blank')?.message).toBe('Brakes dragging');
    expect(by('inl')).toMatchObject({ kind: 'station', eventId: null, message: 'Inline', sound: '', delayMs: 0 });
    expect(by('inl')?.action).toBeUndefined();
    expect(by('fallback')?.message).toBe('Nameless fallback');
    expect(by('unk')).toBeUndefined();
    expect(s.problems).toEqual([
      { placementId: 'unk', stopKey: 'A#0', reason: 'unknown_event', eventId: 'nope' },
      { placementId: 'nokind', stopKey: 'A#0', reason: 'no_kind' },
      { placementId: 'nomsg', stopKey: 'A#0', reason: 'no_messages' },
    ]);
  });

  it('en-route on the last stop has no section', () => {
    const s = rollEvents(line({ D: [enroute('last', 0.5)] }), lib, rng);
    expect(s.problems).toEqual([{ placementId: 'last', stopKey: 'D#0', reason: 'no_section' }]);
    expect(tick(s, line({ D: [enroute('last', 0.5)] }), now(0, '23:00')).fired).toEqual([]);
  });
});

describe('station events', () => {
  it('fire only after their trigger + delay, once', () => {
    const t = line({ C: [station('a', { delay_s: [10, 10] })] });
    let s = rollEvents(t, lib, rng);
    expect(tick(s, t, now(1e6, '10:20')).fired).toEqual([]); // no trigger yet
    let r = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', ...now(1000, '10:20') });
    expect(r.fired).toEqual([]);
    s = r.state;
    expect(tick(s, t, now(10_999, '10:20')).fired).toEqual([]);
    // repeated press doesn't re-arm / postpone
    s = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', ...now(5000, '10:20') }).state;
    r = tick(s, t, now(11_000, '10:21'));
    expect(r.fired.map((e) => e.placementId)).toEqual(['a']);
    expect(r.fired[0]).toMatchObject({ status: 'fired', firedAtMs: 11_000, firedClockMin: hm('10:21') });
    expect(tick(r.state, t, now(99_000, '10:22')).fired).toEqual([]);
    expect(onDoor(r.state, t, { type: 'door_open', stopKey: 'C#0', ...now(99_000, '10:22') }).fired).toEqual([]);
  });

  it('only their own trigger, stop and visit', () => {
    const t = tr([st('A', null, '10:00'), st('B', '10:10', '10:11'), st('A', '10:20', '10:21', [station('v2', { trigger: 'door_close', delay_s: [0, 0] })]), st('C', '10:30', null)]);
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'A#0', ...now(0, '10:00') }).state; // first visit
    s = onDoor(s, t, { type: 'door_open', stopKey: 'A#1', ...now(10, '10:20') }).state; // wrong trigger
    expect(tick(s, t, now(1e9, '10:21')).fired).toEqual([]);
    const r = onDoor(s, t, { type: 'door_close', stopKey: 'A#1', ...now(20, '10:21') }); // delay 0 fires at once
    expect(r.fired.map((e) => e.placementId)).toEqual(['v2']);
  });

  it('door events at a stop without placements are harmless', () => {
    const t = line({ C: [station('a')] });
    const s = rollEvents(t, lib, rng);
    const r = onDoor(s, t, { type: 'door_open', stopKey: 'A#0', ...now(0, '10:00') });
    expect(r.fired).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(pendingEvents(r.state).map((e) => e.placementId)).toEqual(['a']);
  });

  it('dropped when the train moves on before the trigger; still fires with clock null', () => {
    const t = line({ B: [station('b', { trigger: 'boarding_done' })], C: [station('c', { delay_s: [0, 0] })] });
    const s = rollEvents(t, lib, rng);
    const r = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', realMs: 0, clockMin: null });
    expect(r.dropped.map((e) => e.placementId)).toEqual(['b']);
    expect(r.fired.map((e) => e.placementId)).toEqual(['c']);
    expect(r.fired[0].firedClockMin).toBeNull();
  });
});

describe('en-route events', () => {
  const fires = (s: RolledState, t: Train, clock: string): string[] => tick(s, t, now(0, clock)).fired.map((e) => e.placementId);

  it('falls back to the scheduled departure when no Doors Close is recorded', () => {
    const t = line({ C: [enroute('e', 0.5)] }); // 10:25 + 0.5 × 15 = 10:32.5
    const s = rollEvents(t, lib, rng);
    expect(fires(s, t, '10:32')).toEqual([]);
    expect(fires(s, t, '10:33')).toEqual(['e']);
  });

  it('is anchored on the actual Doors Close (late running shifts it)', () => {
    const t = line({ C: [enroute('e', 0.5)] });
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', ...now(0, '10:28') }).state;
    expect(fires(s, t, '10:40')).toEqual([]); // standing at C with doors open: not departed
    s = onDoor(s, t, { type: 'door_close', stopKey: 'C#0', ...now(0, '10:30') }).state;
    expect(fires(s, t, '10:37')).toEqual([]);
    expect(fires(s, t, '10:38')).toEqual(['e']); // 10:30 + 7.5
  });

  it('reopened doors hold it until the next close', () => {
    const t = line({ C: [enroute('e', 0.2)] }); // 3 min after departure
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'C#0', ...now(0, '10:25') }).state;
    s = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', ...now(0, '10:26') }).state;
    expect(fires(s, t, '10:29')).toEqual([]);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'C#0', ...now(0, '10:27') }).state;
    expect(fires(s, t, '10:29')).toEqual([]);
    expect(fires(s, t, '10:30')).toEqual(['e']);
  });

  it('is dropped when the train reaches the next stop first (D18)', () => {
    const t = line({ C: [enroute('e', 0.9)] }); // 10:25 + 13.5
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'C#0', ...now(0, '10:25') }).state;
    const r = onDoor(s, t, { type: 'door_open', stopKey: 'D#0', ...now(0, '10:36') });
    expect(r.dropped.map((e) => e.placementId)).toEqual(['e']);
    expect(r.state.events[0].status).toBe('dropped');
    expect(fires(r.state, t, '10:50')).toEqual([]);
  });

  it('pass-through section start adds the scheduled offset from the real departure', () => {
    const t = line({ B: [enroute('e', 0.5)] }); // B→C 10:10→10:20, sched fire 10:15
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'A#0', ...now(0, '10:04') }).state; // 4 late
    expect(fires(s, t, '10:18')).toEqual([]);
    expect(fires(s, t, '10:19')).toEqual(['e']); // 10:04 + 10 + 5
  });

  it('pass-through end: dropped by the next door event further on', () => {
    const t = line({ A: [enroute('e', 0.99)] }); // A→B, B is pass-through
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_close', stopKey: 'A#0', ...now(0, '10:00') }).state;
    const r = onDoor(s, t, { type: 'door_open', stopKey: 'C#0', ...now(0, '10:05') });
    expect(r.dropped.map((e) => e.placementId)).toEqual(['e']);
  });

  it('handles midnight wrap', () => {
    const t = tr([st('X', null, '23:55', [enroute('e', 0.5)]), st('Y', '00:05', '00:06'), st('Z', '00:20', null)]);
    let s = rollEvents(t, lib, rng);
    expect(fires(s, t, '23:59')).toEqual([]);
    expect(fires(s, t, '00:00')).toEqual(['e']); // 23:55 + 5
    expect(fires(s, t, '12:00')).toEqual([]); // long before the run: not fired
    s = onDoor(s, t, { type: 'door_close', stopKey: 'X#0', ...now(0, '23:58') }).state;
    expect(fires(s, t, '00:02')).toEqual([]);
    expect(fires(s, t, '00:03')).toEqual(['e']);
  });

  it('cannot fire without a clock', () => {
    const t = line({ C: [enroute('e', 0)] });
    const s = rollEvents(t, lib, rng);
    expect(tick(s, t, now(0, null)).fired).toEqual([]);
  });

  it('respects probability', () => {
    const t = line({ C: [enroute('e', 0, { probability: 0 })] });
    expect(fires(rollEvents(t, lib, rng), t, '10:39')).toEqual([]);
  });
});

describe('reconcileRolled', () => {
  it('keeps fired state across a re-save, rolls added, forgets removed, re-rolls edited pending', () => {
    const t = line({ A: [station('keep', { delay_s: [0, 0] })], C: [station('gone'), station('edit', { messages: ['old'] })] });
    let s = rollEvents(t, lib, rng);
    s = onDoor(s, t, { type: 'door_open', stopKey: 'A#0', ...now(0, '10:00') }).state;
    expect(s.events.find((e) => e.placementId === 'keep')?.status).toBe('fired');

    const saved = remint(t);
    saved.stops[2] = { ...saved.stops[2], guard_events: [station('edit', { messages: ['new'] })] };
    saved.stops[3] = { ...saved.stops[3], guard_events: [station('added')] };
    const r = reconcileRolled(s, saved, lib, rng);
    expect(r.events.map((e) => [e.placementId, e.stopKey, e.status])).toEqual([
      ['keep', 'A#0', 'fired'],
      ['edit', 'C#0', 'pending'],
      ['added', 'D#0', 'pending'],
    ]);
    expect(r.events.find((e) => e.placementId === 'edit')?.message).toBe('new');
    expect(r.doors).toEqual(s.doors);
    // Re-saving again with no changes keeps every roll as-is.
    expect(reconcileRolled(r, remint(saved), lib, mulberry32(999)).events).toEqual(r.events);
    // The kept event does not fire again.
    expect(onDoor(r, saved, { type: 'door_open', stopKey: 'A#0', ...now(5, '10:00') }).fired).toEqual([]);
  });

  it('keeps an unchanged pending roll (no re-roll on save)', () => {
    const t = line({ C: [station('p', { probability: 0.5, messages: ['a', 'b', 'c', 'd'], delay_s: [0, 60] })] });
    const s = rollEvents(t, lib, mulberry32(3));
    expect(reconcileRolled(s, remint(t), lib, mulberry32(4)).events).toEqual(s.events);
  });

  it('starts fresh for a different train or null', () => {
    const t = line({ C: [station('p')] });
    const s = onDoor(rollEvents(t, lib, rng), t, { type: 'door_open', stopKey: 'A#0', ...now(0, '10:00') }).state;
    expect(reconcileRolled(s, { ...t, id: 'other' }, lib, rng).doors).toEqual({});
    expect(reconcileRolled(null, t, lib, rng).events).toHaveLength(1);
  });
});

describe('serialisation', () => {
  it('JSON round-trip keeps behaviour', () => {
    const t = line({ A: [enroute('en', 0.5)], C: [station('st', { delay_s: [3, 3] })] });
    const run = (persist: boolean): string[] => {
      const out: string[] = [];
      const rt = (x: RolledState): RolledState => (persist ? JSON.parse(JSON.stringify(x)) : x);
      let s = rt(rollEvents(t, lib, mulberry32(11)));
      const steps: Array<(x: RolledState) => ReturnType<typeof tick>> = [
        (x) => onDoor(x, t, { type: 'door_close', stopKey: 'A#0', ...now(0, '10:01') }),
        (x) => tick(x, t, now(1000, '10:05')),
        (x) => tick(x, t, now(2000, '10:06')),
        (x) => onDoor(x, t, { type: 'door_open', stopKey: 'C#0', ...now(3000, '10:21') }),
        (x) => tick(x, t, now(5999, '10:21')),
        (x) => tick(x, t, now(6000, '10:22')),
        (x) => tick(x, t, now(9000, '10:23')),
      ];
      for (const step of steps) {
        const r = step(s);
        out.push(r.fired.map((e) => e.placementId).join(',') + '|' + r.dropped.map((e) => e.placementId).join(','));
        s = rt(r.state);
      }
      return out;
    };
    const plain = run(false);
    expect(plain).toEqual(['|', '|', 'en|', '|', '|', 'st|', '|']);
    expect(run(true)).toEqual(plain);
  });
});
