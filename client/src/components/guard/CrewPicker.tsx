import type { Crew } from '../../types';

interface Props {
  crews: Crew[];
  onPick: (crewId: string) => void;
}

/** Crew chooser (spec D11). '*' means all trains. */
export function CrewPicker({ crews, onPick }: Props) {
  return (
    <div className="flex-1 overflow-auto px-4 py-8">
      <div className="max-w-md mx-auto flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-center">Who are you?</h2>
        <p className="text-sm text-slate-400 text-center mb-2">Pick your crew to see only your trains.</p>
        {crews.length === 0 && (
          <p className="text-sm text-amber-300/90 text-center">
            No crews are set up for the guard panel. In the planner, tick <span className="font-semibold">Guard</span> next to a crew.
          </p>
        )}
        {crews.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            className="min-h-[56px] flex items-center gap-3 px-4 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-blue-500 text-left text-lg"
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
        <button
          onClick={() => onPick('*')}
          className="min-h-[56px] px-4 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 text-left mt-2"
        >
          All trains
        </button>
      </div>
    </div>
  );
}
