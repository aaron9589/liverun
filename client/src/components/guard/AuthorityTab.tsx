import type { ElementState, SectionPhase, SectionView } from '../../lib/loa';
import { elementLabel, sectionRoute, selectorNote } from '../../lib/loaDisplay';

const DOT: Record<ElementState, string> = {
  clear: 'bg-emerald-400', caution: 'bg-amber-400', stop: 'bg-red-500', unknown: 'bg-slate-600',
};
const BADGE: Record<SectionPhase, { text: string; cls: string }> = {
  granted: { text: 'GRANTED', cls: 'bg-emerald-600/30 text-emerald-300' },
  await: { text: 'AWAIT', cls: 'bg-amber-600/30 text-amber-300' },
  unknown: { text: 'NO DATA', cls: 'bg-slate-700 text-slate-300' },
  complete: { text: 'COMPLETE', cls: 'bg-slate-800 text-slate-500' },
};

/** Every section on the train's route, in order, with element dots (spec §11.6). */
export function AuthorityTab({ sections }: { sections: SectionView[] }) {
  return (
    <div data-testid="authority-tab" className="flex flex-col gap-3">
      {sections.map((s) => {
        const badge = BADGE[s.phase];
        const done = s.phase === 'complete';
        return (
          <div
            key={s.match.key}
            className={`rounded-xl border p-3 ${s.current ? 'border-blue-500 bg-blue-950/30' : 'border-slate-800 bg-slate-900'} ${done ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-2 min-h-[32px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{s.match.section.name}</div>
                <div className="text-xs text-slate-400 truncate">{sectionRoute(s)}</div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded ${badge.cls}`}>{badge.text}</span>
            </div>
            <ul className="mt-2 divide-y divide-slate-800/70">
              {s.elements.map((e, i) => {
                const note = selectorNote(e);
                return (
                  <li key={i} className="flex items-center gap-3 min-h-[40px] py-1">
                    <span className={`w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-slate-300 ${DOT[e.state]}`}>
                      {e.state === 'unknown' ? '?' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{elementLabel(e)}</span>
                      {note && <span className="block text-xs text-slate-500">{note}</span>}
                    </span>
                    <span className="font-mono text-xs text-slate-400 truncate max-w-[40%]">{e.value ?? '—'}</span>
                  </li>
                );
              })}
              {s.elements.length === 0 && <li className="py-2 text-sm text-slate-500">No elements configured</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
