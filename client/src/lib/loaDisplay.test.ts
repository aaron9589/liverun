import { describe, expect, it } from 'vitest';
import { stripText, warningText } from './loaDisplay';
import type { ElementView, SectionView } from './loa';

const cond = (label: string) => ({ type: 'signal' as const, label, topic: 't', clear: ['clear'] });
const ev = (label: string, state: ElementView['state'], extra: Partial<ElementView> = {}): ElementView => {
  const element = cond(label);
  return { element, condition: element, value: null, state, grants: true, revokes: false, ...extra };
};
const sv = (phase: SectionView['phase'], elements: ElementView[]): SectionView => ({
  match: { section: { id: 's', name: 'Kiama-Berry', from: 'Kiama', to: 'Berry', only: [], except: [], elements: [] }, key: 's#0', fromIndex: 0, toIndex: 1 },
  phase, elements, pending: elements.filter((e) => e.state === 'stop' || e.state === 'unknown'), current: true,
});

describe('loaDisplay', () => {
  it('formats granted, await and unknown strips', () => {
    expect(stripText(sv('granted', [ev('A', 'clear')]))).toEqual({ tone: 'granted', text: 'Kiama → Berry · AUTHORITY GRANTED' });
    expect(stripText(sv('await', [ev('Staff', 'stop'), ev('Sig 7', 'unknown'), ev('X', 'clear')])).text).toBe('AWAIT: Staff, Sig 7');
    expect(stripText(sv('unknown', [ev('Staff', 'unknown'), ev('X', 'clear')]))).toEqual({
      tone: 'unknown', text: 'Kiama → Berry · waiting for signal data: Staff',
    });
  });
  it('uses the applied condition label for selectors', () => {
    const sel = { type: 'selector' as const, label: 'Points', topic: 'p', options: {}, default: 'A' };
    const e: ElementView = { element: sel, condition: cond('Sig 9'), option: 'CLOSED', optionFrom: 'value', value: null, state: 'stop', grants: true, revokes: false };
    expect(stripText(sv('await', [e])).text).toBe('AWAIT: Sig 9');
  });
  it('warning text', () => {
    expect(warningText(sv('await', [ev('Staff', 'stop')]))).toEqual({ title: 'No authority: Kiama-Berry', detail: 'Staff' });
  });
});
