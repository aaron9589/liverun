import type { SectionView } from '../../lib/loa';
import { stripText } from '../../lib/loaDisplay';

const TONE = {
  granted: 'bg-emerald-900/50 border-emerald-700 text-emerald-100',
  await: 'bg-amber-900/50 border-amber-700 text-amber-100',
  unknown: 'bg-slate-800 border-slate-700 text-slate-300',
} as const;

/** Always-visible current-section strip under the header (spec §11.6), also when no section applies. */
export function LoaStrip({ sections, current }: { sections: SectionView[]; current: SectionView | null }) {
  if (sections.length === 0) {
    return <div data-testid="loa-strip" data-tone="none" className="px-4 py-1.5 text-xs text-slate-500 bg-slate-900 border-b border-slate-800">Limit of authority: no sections for this train</div>;
  }
  if (!current) {
    return <div data-testid="loa-strip" className="px-4 py-1.5 text-xs text-slate-500 bg-slate-900 border-b border-slate-800">All sections complete</div>;
  }
  const { tone, text } = stripText(current);
  return (
    <div data-testid="loa-strip" data-tone={tone} className={`px-4 py-2 border-b font-semibold truncate ${TONE[tone]}`}>
      {text}
    </div>
  );
}
