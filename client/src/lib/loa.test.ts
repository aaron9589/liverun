import { describe, it, expect } from 'vitest';
import type { LoaCondition, LoaConfig, LoaSection, LoaSelector, LoaValue, Station, Train, TrainStop } from '../types';
import {
  conditionState, evaluateElement, sectionsForTrain, stepLoa, initialLoaState, parseLoaState,
  departureWarning, currentSection, routeStopIndex, stopIndexOf, applyLoaValues, hasUnlatch,
  type LoaTrainState, type SectionMatch,
} from './loa';
import { sequenceStops, currentStop } from './stops';

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
const config = (...sections: LoaSection[]): LoaConfig => ({ sections, warn_on_depart: true });
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
  const at0 = { currentStopIndex: 0 };
  const phases = (r: ReturnType<typeof stepLoa>) => r.sections.map((s) => s.phase);

  /** Steps through a list of value snapshots, threading state. */
  function run(snaps: Record<string, string>[], pos = at0, start: LoaTrainState = initialLoaState('t1')) {
    let state = start;
    let last!: ReturnType<typeof stepLoa>;
    for (const v of snaps) {
      last = stepLoa(state, matches, vals(v), pos);
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
    const r = stepLoa(initialLoaState('t1'), ms, vals({ down: 'Y' }), at0);
    expect(r.sections[0].phase).toBe('granted');
    expect(r.sections[0].elements[0].state).toBe('caution');
  });

  it('signal back to stop does not revoke; unknown does not revoke', () => {
    const r = run([{ down: 'THROWN', staff: 'CATS' }, { down: 'CLOSED', staff: 'CATS' }, {}]);
    expect(r.sections[0].phase).toBe('granted');
    expect(r.sections[0].pending.map((e) => e.state)).toEqual(['unknown', 'unknown']);
  });

  it('token going stop revokes back to await; a later all-clear re-grants', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }, { down: 'CLOSED', staff: 'IN' }]);
    expect(r.sections[0].phase).toBe('await');
    expect(r.state.granted).toEqual([]);
    r = run([{ down: 'THROWN', staff: 'CATS' }], at0, r.state);
    expect(r.sections[0].phase).toBe('granted');
  });

  it('explicit revokes on a signal; revokes: false on a token', () => {
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('down', { revokes: true }), token('staff', { revokes: false })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    let r = stepLoa(initialLoaState('t1'), ms, vals({ down: 'THROWN', staff: 'CATS' }), at0);
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'IN' }), at0);
    expect(r.sections[0].phase).toBe('granted');
    r = stepLoa(r.state, ms, vals({ down: 'CLOSED', staff: 'IN' }), at0);
    expect(r.sections[0].phase).toBe('await');
  });

  it('a granted section holds past doors open at to until the staff is returned, then completes', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }]);
    // Depart Kiama (doors were opened and closed there), signal back to stop behind the train
    r = stepLoa(r.state, matches, vals({ down: 'THROWN', staff: 'CATS' }), { currentStopIndex: null, doorCloseStopIndex: 0 });
    expect(r.state.departed).toEqual(['kb#0']);
    r = stepLoa(r.state, matches, vals({ down: 'CLOSED', staff: 'CATS' }), { currentStopIndex: null });
    expect(phases(r)[0]).toBe('granted');
    // Doors open at Berry: still granted, the staff is still out
    r = stepLoa(r.state, matches, vals({ down: 'CLOSED', staff: 'CATS' }), { currentStopIndex: null, doorOpenStopIndex: 1 });
    expect(phases(r)[0]).toBe('granted');
    // Staff handed back: authority ends
    r = stepLoa(r.state, matches, vals({ down: 'CLOSED', staff: 'IN', up: 'CLOSED' }), { currentStopIndex: null });
    expect(phases(r)).toEqual(['complete', 'await']);
    expect(r.state.complete).toEqual(['kb#0']);
    expect(r.state.granted).toEqual([]);
    expect(r.sections.map((s) => s.current)).toEqual([false, true]);
    // Back toward Kiama: the staff is issued again with the up signal clear
    r = stepLoa(r.state, matches, vals({ down: 'CLOSED', staff: 'CATS', up: 'THROWN' }), { currentStopIndex: null });
    expect(phases(r)).toEqual(['complete', 'granted']);
    expect(currentSection(r.sections)?.match.key).toBe('bk#0');
  });

  it('an unlatch before leaving from withdraws the authority instead of ending it', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }]);
    r = stepLoa(r.state, matches, vals({ down: 'THROWN', staff: 'IN' }), { currentStopIndex: null, doorOpenStopIndex: 0 });
    expect(phases(r)[0]).toBe('await');
    expect(r.state.complete).toEqual([]);
    expect(departureWarning(r.sections, 0)?.match.key).toBe('kb#0');
  });

  it('a later door event or pin also counts as leaving from (train ran through it)', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }]);
    const ms = sectionsForTrain(train([st('kia'), st('gw'), st('bry')]), STATIONS, config(kb));
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS' }), { currentStopIndex: null, doorOpenStopIndex: 1 });
    expect(r.state.departed).toEqual(['kb#0']);
    r = stepLoa(r.state, ms, vals({ down: 'CLOSED', staff: 'IN' }), { currentStopIndex: null });
    expect(r.sections[0].phase).toBe('complete');
  });

  it('doors open at to completes when nothing will unlatch: never granted, or no unlatch element', () => {
    let r = run([{ down: 'CLOSED', staff: 'IN' }]);
    r = stepLoa(r.state, matches, vals({ down: 'CLOSED', staff: 'IN' }), { currentStopIndex: null, doorOpenStopIndex: 1 });
    expect(phases(r)[0]).toBe('complete');
    const sigOnly = section('kb', 'Kiama', 'Berry', { elements: [sig('down')] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(sigOnly));
    expect(hasUnlatch(sigOnly)).toBe(false);
    let q = stepLoa(initialLoaState('t1'), ms, vals({ down: 'THROWN' }), at0);
    expect(q.sections[0].phase).toBe('granted');
    q = stepLoa(q.state, ms, vals({ down: 'CLOSED' }), { currentStopIndex: null, doorOpenStopIndex: 1 });
    expect(q.sections[0].phase).toBe('complete');
  });

  it('arriving at to is not complete; moving past it is', () => {
    let r = run([{ down: 'THROWN', staff: 'CATS' }], { currentStopIndex: 1 });
    expect(r.sections[0].phase).toBe('granted');
    r = stepLoa(r.state, matches, {}, { currentStopIndex: 2 });
    expect(phases(r)).toEqual(['complete', 'unknown']);
  });

  it('doors open past to also completes; no position completes nothing', () => {
    const r = stepLoa(initialLoaState('t1'), matches, {}, { currentStopIndex: null, doorOpenStopIndex: 2 });
    expect(phases(r)).toEqual(['complete', 'complete']);
    expect(currentSection(r.sections)).toBeNull();
    expect(phases(stepLoa(initialLoaState('t1'), matches, {}, { currentStopIndex: null }))).toEqual(['unknown', 'unknown']);
  });

  it('only "grants" elements gate the grant; a revoke-only element still releases it', () => {
    // Old Illawarra logic as config: all three grant, only the staff revokes (the default for tokens).
    const c = section('kb', 'Kiama', 'Berry', { elements: [sig('down'), token('staff'), sig('home', { grants: false, revokes: true })] });
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(c));
    // 'home' is red and has no say in the grant, nor in the AWAIT list
    let r = stepLoa(initialLoaState('t1'), ms, vals({ down: 'CLOSED', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].phase).toBe('await');
    expect(r.sections[0].pending.map((e) => e.element.label)).toEqual(['down']);
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].phase).toBe('granted');
    // ...but it does revoke: clear then back to stop, before departure → await
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS', home: 'THROWN' }), at0);
    expect(r.sections[0].phase).toBe('granted');
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].phase).toBe('await');
    expect(r.sections[0].pending.map((e) => e.element.label)).toEqual(['home']);
    // The granting elements are still clear, but that is the old grant: no instant re-grant...
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].phase).toBe('await');
    // ...until a granting element drops and everything clears again
    r = stepLoa(r.state, ms, vals({ down: 'CLOSED', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].pending.map((e) => e.element.label)).toEqual(['down']);
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', staff: 'CATS', home: 'CLOSED' }), at0);
    expect(r.sections[0].phase).toBe('granted');
    // No granting element at all: never granted
    const none = section('kb', 'Kiama', 'Berry', { elements: [sig('down', { grants: false })] });
    const ms2 = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(none));
    expect(stepLoa(initialLoaState('t1'), ms2, vals({ down: 'THROWN' }), at0).sections[0].phase).toBe('unknown');
  });

  it('a later occurrence of the same section cannot latch until the earlier one completes', () => {
    const k = section('kb', 'Kiama', 'Berry', { elements: [sig('down')] });
    const back = section('bk', 'Berry', 'Kiama', { elements: [sig('up')] });
    const ms = sectionsForTrain(train([st('kia'), st('bry'), st('kia'), st('bry')]), STATIONS, config(k, back));
    let r = stepLoa(initialLoaState('t1'), ms, vals({ down: 'THROWN', up: 'CLOSED' }), at0);
    // kb#1 waits for kb#0 even though its signal is clear: that clear is kb#0's authority
    expect(r.sections.map((s) => [s.match.key, s.phase])).toEqual([['kb#0', 'granted'], ['bk#0', 'await'], ['kb#1', 'await']]);
    expect(r.sections[2].pending).toEqual([]);
    r = stepLoa(r.state, ms, vals({ down: 'CLOSED', up: 'CLOSED' }), { currentStopIndex: 2 });
    expect(r.sections.map((s) => s.phase)).toEqual(['complete', 'await', 'await']);
    r = stepLoa(r.state, ms, vals({ down: 'THROWN', up: 'CLOSED' }), { currentStopIndex: 2 });
    expect(r.sections.map((s) => s.phase)).toEqual(['complete', 'await', 'granted']);
  });

  it('different sections may latch ahead of the train', () => {
    const r = run([{ down: 'THROWN', staff: 'CATS', up: 'THROWN' }]);
    expect(phases(r)).toEqual(['granted', 'granted']);
  });

  it('a section with no elements is never granted', () => {
    const ms = sectionsForTrain(train([st('kia'), st('bry')]), STATIONS, config(section('kb', 'Kiama', 'Berry')));
    expect(stepLoa(initialLoaState('t1'), ms, {}, at0).sections[0].phase).toBe('unknown');
  });

  it('returns the same state object when nothing changed', () => {
    const s0 = initialLoaState('t1');
    expect(stepLoa(s0, matches, vals({ down: 'CLOSED' }), at0).state).toBe(s0);
    const g = stepLoa(s0, matches, vals({ down: 'THROWN', staff: 'CATS' }), at0).state;
    expect(g).not.toBe(s0);
    expect(stepLoa(g, matches, vals({ down: 'CLOSED', staff: 'CATS' }), at0).state).toBe(g);
  });
});

describe('departureWarning', () => {
  const kb = section('kb', 'Kiama', 'Berry', { elements: [token('staff')] });
  const bn = section('bn', 'Berry', 'Nowra', { elements: [token('staff2')] });
  const ms = sectionsForTrain(train([st('kia'), st('bry'), st('now')]), STATIONS, config(kb, bn));
  it('warns for an await or unknown section starting at the stop', () => {
    expect(departureWarning(stepLoa(initialLoaState('t1'), ms, vals({ staff: 'IN' }), { currentStopIndex: 0 }).sections, 0)?.match.key).toBe('kb#0');
    expect(departureWarning(stepLoa(initialLoaState('t1'), ms, {}, { currentStopIndex: 0 }).sections, 0)?.match.key).toBe('kb#0');
  });
  it('no warning when granted, or at a stop that starts no section', () => {
    const r = stepLoa(initialLoaState('t1'), ms, vals({ staff: 'CATS' }), { currentStopIndex: 0 });
    expect(departureWarning(r.sections, 0)).toBeNull();
    expect(departureWarning(r.sections, 2)).toBeNull();
    expect(departureWarning(r.sections, 1)?.match.key).toBe('bn#0');
  });
  it('no warning for a completed section', () => {
    const r = stepLoa(initialLoaState('t1'), ms, {}, { currentStopIndex: null, doorOpenStopIndex: 1 });
    expect(departureWarning(r.sections, 0)).toBeNull();
  });
});

describe('helpers', () => {
  it('parseLoaState validates', () => {
    const s = { v: 2, trainId: 't1', granted: ['a#0'], departed: ['a#0'], revoked: ['b#0'], complete: [] };
    expect(parseLoaState(s, 't1')).toEqual(s);
    expect(parseLoaState(s, 't2')).toBeNull();
    expect(parseLoaState({ ...s, v: 3 }, 't1')).toBeNull();
    // v1 (before `departed`) is upgraded
    expect(parseLoaState({ v: 1, trainId: 't1', granted: ['a#0'], complete: [] }, 't1')).toEqual({ ...s, departed: [], revoked: [] });
    expect(parseLoaState({ ...s, granted: [1] }, 't1')).toBeNull();
    expect(parseLoaState(null, 't1')).toBeNull();
  });
  it('routeStopIndex maps a sequenceStops index to train.stops (untimed stops skipped by seq)', () => {
    const t = train([st('kia', null, '10:00'), st('gw'), st('bry', '10:20', '10:22'), st('now', '10:40', null)]);
    const seq = sequenceStops(t);
    expect(routeStopIndex(t, seq, currentStop(seq, 621, null).index)).toBe(2);
    expect(routeStopIndex(t, seq, currentStop(seq, 630, null).index)).toBe(3);
    expect(routeStopIndex(t, seq, currentStop(seq, null, null).index)).toBeNull();
    // copies of the stop objects still resolve by id
    expect(routeStopIndex({ ...t, stops: t.stops.map((s) => ({ ...s })) }, seq, 1)).toBe(2);
    expect(stopIndexOf(t, t.stops[3].id)).toBe(3);
    expect(stopIndexOf(t, 'nope')).toBeNull();
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
