import { describe, it, expect } from 'vitest';
import type { GuardEventDef } from '../types';
import {
  newPlacementForm, toForm, fromForm, validateForm, validateStopForms, validateEventsLibrary,
  countPlacementsFor, customActionNames, effectiveKind,
} from './guardEventForm';

const lib: GuardEventDef[] = [
  { id: 'brakes', name: 'Brakes', kind: 'enroute', messages: ['Dragging'], sound: '' },
  { id: 'unruly', name: 'Unruly', kind: 'station', messages: ['Trouble'], sound: '' },
];

describe('placement forms', () => {
  it('round-trips station and en-route placements keeping ids', () => {
    const st = { id: 'a1', kind: 'station' as const, messages: ['x', 'y'], probability: 0.35, trigger: 'door_close' as const, delay_s: [2, 9] as [number, number] };
    expect(fromForm(toForm(st, lib), lib)).toEqual(st);
    const en = { id: 'b2', event: 'brakes', probability: 1, at: [0.25, 0.75] as [number, number] };
    expect(fromForm(toForm(en, lib), lib)).toEqual(en);
  });

  it('library placement never carries trigger for en-route and keeps override messages', () => {
    const f = { ...newPlacementForm('c', lib), messagesText: 'Custom\n\n  line two ' };
    expect(fromForm(f, lib)).toEqual({ id: 'c', event: 'brakes', probability: 1, messages: ['Custom', 'line two'], at: [0.2, 0.8] });
  });

  it('defaults to inline when the library is empty', () => {
    expect(newPlacementForm('z', []).event).toBe('');
  });

  it('validates', () => {
    const base = { ...newPlacementForm('a', lib), event: '', kind: 'station' as const };
    expect(validateForm(base, lib)).toMatch(/message/);
    const ok = { ...base, messagesText: 'Hi' };
    expect(validateForm(ok, lib)).toBeNull();
    expect(validateForm({ ...ok, probabilityPct: '101' }, lib)).toMatch(/Probability/);
    expect(validateForm({ ...ok, delayMin: '30', delayMax: '5' }, lib)).toMatch(/minimum/);
    expect(validateForm({ ...ok, delayMax: '601' }, lib)).toMatch(/Delay/);
    expect(validateForm({ ...ok, delayMax: '' }, lib)).toMatch(/Delay/);
    expect(validateForm({ ...ok, kind: 'enroute', atMinPct: '90', atMaxPct: '10' }, lib)).toMatch(/minimum/);
    expect(validateForm({ ...ok, messagesText: 'x'.repeat(501) }, lib)).toMatch(/500/);
    expect(validateForm({ ...newPlacementForm('a', lib), event: 'gone' }, lib)).toMatch(/no longer/);
    expect(effectiveKind({ ...ok, event: 'unruly' }, lib)).toBe('station');
    expect(validateStopForms([ok, ok], lib)).toMatch(/Duplicate/);
  });
});

describe('library helpers', () => {
  const sound = (n: string) => (n.endsWith('.mp3') ? null : 'bad');
  const def = (o: Partial<GuardEventDef> = {}): GuardEventDef => ({ ...lib[0], ...o });
  it('validates library entries', () => {
    expect(validateEventsLibrary({ library: lib, publish_topic: '' }, sound)).toBeNull();
    for (const bad of [def({ id: 'Bad' }), def({ id: '' }), def({ name: ' ' }), def({ messages: [] }), def({ messages: [' '] }), def({ sound: 'x.txt' }), def({ action: 'Bad Action' })]) {
      expect(validateEventsLibrary({ library: [bad], publish_topic: '' }, sound)).not.toBeNull();
    }
    expect(validateEventsLibrary({ library: [lib[0], lib[0]], publish_topic: '' }, sound)).toMatch(/duplicated/);
    expect(validateEventsLibrary({ library: [], publish_topic: 'a/#' }, sound)).toMatch(/wildcard/);
    expect(validateEventsLibrary({ library: [], publish_topic: 'x'.repeat(201) }, sound)).toMatch(/200/);
  });
  it('counts placements and lists custom actions', () => {
    const trains = [{ stops: [{ guard_events: [{ id: '1', event: 'brakes', probability: 1 }] }, {}] }, { stops: [{ guard_events: [{ id: '2', event: 'brakes', probability: 1 }] }] }];
    expect(countPlacementsFor(trains, 'brakes')).toBe(2);
    expect(countPlacementsFor(trains, 'x')).toBe(0);
    expect(customActionNames([{ functions: { bell: 1, brake_squeal: 1 } }, { functions: { aaa: 1, brake_squeal: 1 } }])).toEqual(['aaa', 'brake_squeal']);
  });
});

describe('probability precision', () => {
  it('keeps one decimal place of a percentage', () => {
    const f = { ...toForm({ id: 'p', event: 'brakes', probability: 1 }, lib), probabilityPct: '12.5' };
    expect(fromForm(f, lib).probability).toBe(0.125);
    expect(fromForm({ ...f, probabilityPct: '0.4' }, lib).probability).toBe(0.004);
    expect(toForm(fromForm(f, lib), lib).probabilityPct).toBe('12.5');
  });
});
