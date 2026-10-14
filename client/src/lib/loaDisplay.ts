import type { ElementView, SectionView } from './loa';

/** Label shown for an element: a selector shows the applied condition's label. */
export function elementLabel(e: ElementView): string {
  return e.condition?.label ?? e.element.label;
}

/** "Kiama → Berry" for a section view, using the config's from/to names. */
export function sectionRoute(s: SectionView): string {
  return `${s.match.section.from} → ${s.match.section.to}`;
}

export type StripTone = 'granted' | 'await' | 'unknown';

/** Text + tone of the always-visible strip (spec §11.6). */
export function stripText(s: SectionView): { tone: StripTone; text: string } {
  const labels = s.pending.map(elementLabel).join(', ');
  if (s.phase === 'granted') return { tone: 'granted', text: `${sectionRoute(s)} · AUTHORITY GRANTED` };
  if (s.phase === 'await') return { tone: 'await', text: `AWAIT: ${labels || s.match.section.name}` };
  const missing = s.elements.filter((e) => e.state === 'unknown').map(elementLabel).join(', ');
  return { tone: 'unknown', text: `${sectionRoute(s)} · waiting for signal data${missing ? `: ${missing}` : ''}` };
}

/** Departure warning text: "No authority: <section name>". */
export function warningText(s: SectionView): { title: string; detail: string } {
  return {
    title: `No authority: ${s.match.section.name || sectionRoute(s)}`,
    detail: s.pending.map(elementLabel).join(', '),
  };
}

/** Small "via X" note for a selector row, or null for plain elements. */
export function selectorNote(e: ElementView): string | null {
  if (e.element.type !== 'selector') return null;
  if (e.optionFrom === 'default') return 'default';
  return e.option ? `via ${e.option}` : null;
}
