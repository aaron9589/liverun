import { describe, it, expect } from 'vitest';
import type { LoaCondition, LoaConfig, LoaSection, LoaSelector, LoaValue, Station, Train, TrainStop } from '../types';
import {
  conditionState, evaluateElement, sectionsForTrain, stepLoa, initialLoaState, parseLoaState,
  currentSection, applyLoaValues, hasGrant, hasRevoke,
  type LoaTrainState, type SectionMatch,
} from './loa';

const station = (id: string, name: string): Station =>
  ({ id, timetable_id: 'x', name, short_code: id, distance: null, graph_pos: 0, sort_order: 0, branch_name: null });
const STATIONS = [station('kia', 'Kiama'), station('gw', 'Gerringong'), station('bry', 'Berry'), station('now', 'Nowra'), station('bom', ' BOMADERRY ')];

let stopN = 0;
const st = (station_id: string, arrival: string | null = null, departure: string | null = null): TrainStop =>
  ({ id: `s${stopN++}`, train_id: 't', station_id, arrival, departure });
const train = (stops: TrainStop[], over: Partial<Train> = {}): Train =>
  ({ id: 't1', timetable_id: 'x', name: 'Run 1', color: '#fff', notes: '', stops, ...over });

const sig = (topic: string, over: Partial<LoaCondition> = {}): LoaCondition =>
  ({ type: 'signal', label: topic, topic, clear: ['THROWN'], ...over });
const token = (topic: string, over: Partial<LoaCondition> = {}): LoaCondition =>
  ({ type: 'token', label: topic, topic, clear: ['CATS'], ...over });
const section = (id: string, from: string, to: string, over: Partial<LoaSection> = {}): LoaSection =>
  ({ id, name: `${from} → ${to}`, from, to, only: [], except: [], elements: [], ...over });
const config = (...sections: LoaSection[]): LoaConfig => ({ sections });
const vals = (o: Record<string, string>): Record<string, LoaValue> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, at: '2026-01-01T00:00:00Z' }]));
const spans = (ms: SectionMatch[]) => ms.map((m) => [m.key, m.fromIndex, m.toIndex]);

describe('conditionState', () => {
  const c = sig('t', { clear: ['R28?; Lit; Unheld', 'THROWN'], caution: ['R2*', 'THROWN'] });
  it('no value is unknown', () => expect(conditionState(c, undefined)).toBe('unknown'));
  it('clear globs, trimmed and case-insensitive', () => {
    expect(conditionState(c, ' R285; Lit; Unheld ')).toBe('clear');
    expect(conditionState(c, 'thrown')).toBe('clear'); // clear wins over caution
  });
  it('caution globs', () => expect(conditionState(c, 'R2; Lit; Unheld')).toBe('caution'));
  it('anything else is stop', () => {
    expect(conditionState(c, 'R300; Lit; Unheld')).toBe('stop');
    expect(conditionState(c, '')).toBe('stop');
  });
  it('blank patterns never match', () => expect(conditionState(sig('t', { clear: [' '] }), '')).toBe('stop'));
  it('missing caution list', () => expect(conditionState({ type: 'condition', label: '', topic: 't', clear: ['A'] }, 'B')).toBe('stop'));
});

describe('evaluateElement', () => {
  it('plain condition with grants / revokes defaults', () => {
    expect(evaluateElement(sig('a'), vals({ a: 'THROWN' }))).toEqual({
      element: sig('a'), condition: sig('a'), value: 'THROWN', state: 'clear', grants: true, revokes: false,
    });
    expect(evaluateElement(sig('a', { grants: false }), {}).grants).toBe(false);
    expect(evaluateElement(token('s'), {})).toMatchObject({ value: null, state: 'unknown', revokes: true });
    expect(evaluateElement(token('s', { revokes: false }), {}).revokes).toBe(false);
    expect(evaluateElement(sig('a', { revokes: true }), {}).revokes).toBe(true);
  });

  const selector: LoaSelector = {
    type: 'selector', label: 'Kiama departure', topic: 'turnout', default: 'CLOSED',
    options: { CLOSED: sig('sig25'), THROWN: token('sig27', { clear: ['R286'] }) },
  };
  it('selector uses default until its topic has a value', () => {
    expect(evaluateElement(selector, vals({ sig25: 'THROWN' }))).toMatchObject({
      option: 'CLOSED', optionFrom: 'default', condition: selector.options.CLOSED, value: 'THROWN', state: 'clear', revokes: false,
    });
  });
  it('selector picks the option from its value (exact, then case-insensitive)', () => {
    expect(evaluateElement(selector, vals({ turnout: 'THROWN', sig27: 'R286' }))).toMatchObject({
      option: 'THROWN', optionFrom: 'value', state: 'clear', revokes: true,
    });
    expect(evaluateElement(selector, vals({ turnout: ' thrown ', sig27: 'X' }))).toMatchObject({ option: 'THROWN', state: 'stop' });
  });
  it('selector value naming no option is unknown, never the default', () => {
    expect(evaluateElement(selector, vals({ turnout: 'INCONSISTENT', sig25: 'THROWN' }))).toMatchObject({
      option: 'INCONSISTENT', optionFrom: 'value', condition: null, value: null, state: 'unknown', revokes: false,
    });
  });
  it('missing default option is unknown', () => {
    expect(evaluateElement({ ...selector, default: 'NOPE' }, {})).toMatchObject({ condition: null, state: 'unknown' });
  });
});

describe('sectionsForTrain', () => {
  const cfg = config(section('kb', 'Kiama', 'Berry'), section('bk', 'berry', 'KIAMA'), section('bn', 'Berry', 'Nowra'));

  it('matches with intermediate stations, in route order', () => {
    const t = train([st('kia'), st('gw'), st('bry'), st('now')]);
    expect(spans(sectionsForTrain(t, STATIONS, cfg))).toEqual([['kb#0', 0, 2], ['bn#0', 2, 3]]);
  });
  it('out and back gets both directions', () => {
    const t = train([st('kia'), st('bry'), st('kia')]);
    expect(spans(sectionsForTrain(t, STATIONS, cfg))).toEqual([['kb#0', 0, 1], ['bk#0', 1, 2]]);
  });
  it('repeat occurrences get their own keys', () => {
    const t = train([st('kia'), st('bry'), st('kia'), st('bry'), st('kia')]);
    expect(spans(sectionsForTrain(t, STATIONS, cfg))).toEqual([['kb#0', 0, 1], ['bk#0', 1, 2], ['kb#1', 2, 3], ['bk#1', 3, 4]]);
  });
  it('pairs each to with the most recent from; no overlap between occurrences', () => {
    const c = config(section('kb', 'Kiama', 'Berry'));
    expect(spans(sectionsForTrain(train([st('kia'), st('gw'), st('kia'), st('bry')]), STATIONS, c))).toEqual([['kb#0', 2, 3]]);
    expect(spans(sectionsForTrain(train([st('kia'), st('bry'), st('bry')]), STATIONS, c))).toEqual([['kb#0', 0, 1]]);
  });
  it('wrong order, missing stations and unknown station ids match nothing', () => {
    expect(sectionsForTrain(train([st('bry'), st('now')]), STATIONS, config(section('nb', 'Nowra', 'Berry')))).toEqual([]);
    expect(sectionsForTrain(train([st('kia'), st('???'), st('gw')]), STATIONS, cfg)).toEqual([]);
    expect(sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(section('x', 'Kiama', 'Albion Park')))).toEqual([]);
  });
  it('station names are trimmed and case-insensitive; from === to is ignored', () => {
    const t = train([st('now'), st('bom'), st('now')]);
    expect(spans(sectionsForTrain(t, STATIONS, config(section('nb', ' nowra', 'Bomaderry'), section('nn', 'Nowra', 'NOWRA'))))).toEqual([['nb#0', 0, 1]]);
  });
  it('ties on the same from stop keep config order', () => {
    const t = train([st('kia'), st('bry'), st('now')]);
    const c = config(section('kn', 'Kiama', 'Nowra'), section('kb', 'Kiama', 'Berry'));
    expect(spans(sectionsForTrain(t, STATIONS, c))).toEqual([['kn#0', 0, 2], ['kb#0', 0, 1]]);
  });
  it('only / except test train_id and name (either counts)', () => {
    const route = [st('kia'), st('bry')];
    const c = (over: Partial<LoaSection>) => config(section('kb', 'Kiama', 'Berry', over));
    const pax = train(route, { name: 'SP12', train_id: '3801' });
    const light = train(route, { name: 'LE1', train_id: '4401' });
    expect(sectionsForTrain(pax, STATIONS, c({ only: ['SP*'] }))).toHaveLength(1);
    expect(sectionsForTrain(pax, STATIONS, c({ only: ['38??'] }))).toHaveLength(1);
    expect(sectionsForTrain(light, STATIONS, c({ only: ['SP*'] }))).toHaveLength(0);
    expect(sectionsForTrain(light, STATIONS, c({ only: [' '] }))).toHaveLength(1); // blank = no restriction
    expect(sectionsForTrain(light, STATIONS, c({ except: ['le*'] }))).toHaveLength(0);
    expect(sectionsForTrain(light, STATIONS, c({ except: ['4401'] }))).toHaveLength(0);
    expect(sectionsForTrain(pax, STATIONS, c({ except: ['LE*'] }))).toHaveLength(1);
    expect(sectionsForTrain(pax, STATIONS, c({ only: ['SP*'], except: ['3801'] }))).toHaveLength(0);
    expect(sectionsForTrain(train(route, { name: 'X', train_id: undefined }), STATIONS, c({ only: ['3801'] }))).toHaveLength(0);
  });
});

describe('stepLoa latch', () => {
  // Kiama → Berry → Kiama; both directions share the staff.
  const kb = section('kb', 'Kiama', 'Berry', { elements: [sig('down'), token('staff')] });
  const bk = section('bk', 'Berry', 'Kiama', { elements: [sig('up'), token('staff')] });
  const t = train([st('kia'), st('bry'), st('kia')]);
  const matches = sectionsForTrain(t, STATIONS, config(kb, bk));
  const phases = (r: ReturnType<typeof stepLoa>) => r.sections.map((s) => s.phase);

  /** Steps through a list of value snapshots, threading state. */
  function run(snaps: Record<string, string>[], start: LoaTrainState = initialLoaState('t1'), ms = matches) {
    let state = start;
    let last!: ReturnType<typeof stepLoa>;
    for (const v of snaps) {
      last = stepLoa(state, ms, vals(v));
      state = last.state;
    }
    return last;
  }

  it('unknown until values arrive; stop beats unknown', () => {
    expect(phases(run([{}]))).toEqual(['unknown', 'unknown']);
    expect(phases(run([{ staff: 'CATS' }]))).toEqual(['unknown', 'unknown']);
    expect(phases(run([{ down: 'CLOSED' }]))).toEqual(['await', 'unknown']);
  });

  it('grants only when every element is clear at once', () => {
    const r = run([{ down: 'THROWN', staff: 'CATS' }]);
    expect(phases(r)).toEqual(['granted', 'unknown']);
    expect(r.state.granted).toEqual(['kb#0']);
    expect(r.sections[0].current).toBe(true);
    expect(r.sections[0].pending).toEqual([]);
  });

  it('non-simultaneous clears do not grant', () => {
    const r = run([{ down: 'THROWN', staff: 'OUT' }, { down: 'CLOSED', staff: 'CATS' }]);
    expect(phases(r)).toEqual(['await', 'unknown']);
    expect(r.state.granted).toEqual([]);
    expect(r.sections[0].pending.map((e) => e.element.label)).toEqual(['down']);
  });

  it('caution counts as clear for the grant', () => {
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('down', { clear: ['G'], caution: ['Y'] })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    const r = stepLoa(initialLoaState('t1'), ms, vals({ down: 'Y' }));
    expect(r.sections[0].phase).toBe('granted');
    expect(r.sections[0].elements[0].state).toBe('caution');
  });

  it('the old Kiama → Berry run: departure signal back to stop holds, staff sunk at Berry releases', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }]);
    // The train passes the departure signal; it returns to stop (and can't re-clear while the staff is out)
    r = run([{ down: 'CLOSED', staff: 'CATS' }, {}], r.state);
    expect(phases(r)[0]).toBe('granted');
    // Staff sunk at Berry: released, the panel moves on to the next section
    r = run([{ down: 'CLOSED', staff: 'IN', up: 'CLOSED' }], r.state);
    expect(phases(r)).toEqual(['complete', 'await']);
    expect(r.state).toMatchObject({ granted: [], complete: ['kb#0'] });
    expect(currentSection(r.sections)?.match.key).toBe('bk#0');
    // Back toward Kiama: the staff is issued again with the up signal clear
    r = run([{ down: 'CLOSED', staff: 'CATS', up: 'THROWN' }], r.state);
    expect(phases(r)).toEqual(['complete', 'granted']);
  });

  it('a released section is frozen: a following train getting the same staff cannot re-grant it', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }, { down: 'CLOSED', staff: 'IN' }]);
    expect(phases(r)[0]).toBe('complete');
    r = run([{ down: 'THROWN', staff: 'CATS' }], r.state);
    expect(phases(r)[0]).toBe('complete');
  });

  it('explicit revokes on a signal; revokes: false on a token', () => {
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('down', { revokes: true }), token('staff', { revokes: false })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    let r = run([{ down: 'THROWN', staff: 'CATS' }, { down: 'THROWN', staff: 'IN' }], undefined, ms);
    expect(r.sections[0].phase).toBe('granted');
    r = run([{ down: 'CLOSED', staff: 'IN' }], r.state, ms);
    expect(r.sections[0].phase).toBe('complete');
  });

  it('only "grants" elements gate the grant; a revoke-only element still releases it', () => {
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('down'), token('staff'), sig('home', { grants: false, revokes: true })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    // 'home' is red and has no say in the grant, nor in the AWAIT list
    let r = run([{ down: 'CLOSED', staff: 'CATS', home: 'CLOSED' }], undefined, ms);
    expect(r.sections[0].phase).toBe('await');
    expect(r.sections[0].pending.map((e) => e.element.label)).toEqual(['down']);
    r = run([{ down: 'THROWN', staff: 'CATS', home: 'CLOSED' }], r.state, ms);
    expect(r.sections[0].phase).toBe('granted');
    // ...but it revokes when it goes back to stop after clearing
    r = run([{ down: 'THROWN', staff: 'CATS', home: 'THROWN' }, { down: 'CLOSED', staff: 'CATS', home: 'CLOSED' }], r.state, ms);
    expect(r.sections[0].phase).toBe('complete');
    // No granting element at all: never granted
    const none = section('kb', 'Kiama', 'Berry', { elements: [sig('down', { grants: false })] });
    const ms2 = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(none));
    expect(stepLoa(initialLoaState('t1'), ms2, vals({ down: 'THROWN' })).sections[0].phase).toBe('unknown');
  });

  it('a revoking element already at stop when granted does not release it until it has cleared', () => {
    // signal S grants; token T only revokes and is at stop when S clears
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('s'), token('t', { grants: false })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    let r = run([{ s: 'THROWN', t: 'IN' }], undefined, ms);
    expect(r.sections[0].phase).toBe('granted');
    expect(r.state.armed['kb#0']).toEqual([]);
    r = run([{ s: 'THROWN', t: 'IN' }, { s: 'CLOSED', t: 'IN' }], r.state, ms); // re-stepped: still granted
    expect(r.sections[0].phase).toBe('granted');
    r = run([{ s: 'CLOSED', t: 'CATS' }], r.state, ms); // T clears: armed
    expect(r.state.armed['kb#0']).toEqual([1]);
    r = run([{ s: 'CLOSED', t: 'IN' }], r.state, ms); // ...and back to stop: released
    expect(r.sections[0].phase).toBe('complete');
    expect(r.state.armed['kb#0']).toBeUndefined();
  });

  it('hasRevoke looks through selector options', () => {
    expect(hasRevoke(kb)).toBe(true);
    expect(hasRevoke(section('x', 'A', 'B', { elements: [sig('a')] }))).toBe(false);
    const sel: LoaSelector = { type: 'selector', label: 's', topic: 'p', default: 'A', options: { A: sig('a'), B: sig('b', { revokes: true }) } };
    expect(hasRevoke(section('x', 'A', 'B', { elements: [sel] }))).toBe(true);
    expect(hasGrant(section('x', 'A', 'B', { elements: [sig('a', { grants: false })] }))).toBe(false);
    expect(hasGrant(kb)).toBe(true);
  });

  it('a later occurrence of the same section cannot latch until the earlier one is released', () => {
    const k = section('kb', 'Kiama', 'Berry', { elements: [sig('down'), token('staff')] });
    const ms = sectionsForTrain(train([st('kia'), st('bry'), st('kia'), st('bry')]), STATIONS, config(k));
    let r = run([{ down: 'THROWN', staff: 'CATS' }], undefined, ms);
    // kb#1 waits for kb#0 even though everything is clear: that clear is kb#0's authority
    expect(r.sections.map((s) => [s.match.key, s.phase])).toEqual([['kb#0', 'granted'], ['kb#1', 'await']]);
    expect(r.sections[1].pending).toEqual([]);
    r = run([{ down: 'CLOSED', staff: 'IN' }, { down: 'THROWN', staff: 'CATS' }], r.state, ms);
    expect(r.sections.map((s) => s.phase)).toEqual(['complete', 'granted']);
  });

  it('different sections may latch ahead of the train', () => {
    const r = run([{ down: 'THROWN', staff: 'CATS', up: 'THROWN' }]);
    expect(phases(r)).toEqual(['granted', 'granted']);
  });

  it('a section with no elements is never granted', () => {
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(section('kb', 'Kiama', 'Berry')));
    expect(stepLoa(initialLoaState('t1'), ms, {}).sections[0].phase).toBe('unknown');
  });

  it('returns the same state object when nothing changed', () => {
    const s0 = initialLoaState('t1');
    expect(stepLoa(s0, matches, vals({ down: 'CLOSED' })).state).toBe(s0);
    const g = stepLoa(s0, matches, vals({ down: 'THROWN', staff: 'CATS' })).state;
    expect(g).not.toBe(s0);
    expect(stepLoa(g, matches, vals({ down: 'CLOSED', staff: 'CATS' })).state).toBe(g);
  });
});

describe('helpers', () => {
  it('parseLoaState validates and upgrades older versions', () => {
    const s = { v: 4, trainId: 't1', granted: ['a#0'], armed: { 'a#0': [1] }, complete: ['b#0'] };
    expect(parseLoaState(s, 't1')).toEqual(s);
    expect(parseLoaState(s, 't2')).toBeNull();
    expect(parseLoaState({ ...s, v: 5 }, 't1')).toBeNull();
    // Older versions keep grants and completions; nothing is armed yet (re-armed when next seen clear)
    const old = { ...s, armed: {} };
    expect(parseLoaState({ v: 1, trainId: 't1', granted: ['a#0'], complete: ['b#0'] }, 't1')).toEqual(old);
    expect(parseLoaState({ v: 2, trainId: 't1', granted: ['a#0'], departed: [], revoked: [], complete: ['b#0'] }, 't1')).toEqual(old);
    expect(parseLoaState({ v: 3, trainId: 't1', granted: ['a#0'], complete: ['b#0'] }, 't1')).toEqual(old);
    expect(parseLoaState({ ...s, granted: [1] }, 't1')).toBeNull();
    expect(parseLoaState(null, 't1')).toBeNull();
  });
});

describe('applyLoaValues', () => {
  const a = { value: '1', at: 't1' };
  const b = { value: '2', at: 't2' };
  it('merges deltas, keeping identity when nothing changed', () => {
    const prev = { a };
    expect(applyLoaValues(prev, { values: { a: { ...a } }, full: false })).toBe(prev);
    expect(applyLoaValues(prev, { values: {}, full: false })).toBe(prev);
    expect(applyLoaValues(prev, { values: { b }, full: false })).toEqual({ a, b });
    expect(applyLoaValues(prev, { values: { a: { value: '1', at: 't9' } }, full: false })).toEqual({ a: { value: '1', at: 't9' } });
  });
  it('full replaces (dropping stale topics), keeping identity when identical', () => {
    const prev = { a, b };
    expect(applyLoaValues(prev, { values: { a: { ...a }, b: { ...b } }, full: true })).toBe(prev);
    expect(applyLoaValues(prev, { values: { a }, full: true })).toEqual({ a });
    expect(applyLoaValues(prev, { values: {}, full: true })).toEqual({});
  });
});
