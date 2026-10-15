import type { Crew } from '../../types';

interface Props {
  crews: Crew[];
  onPick: (crewId: string) => void;
}

/** Crew chooser for Crew jobs: every crew in the timetable (spec P18), no "all trains". */
export function CrewPicker({ crews, onPick }: Props) {
  return (
    <div className="flex-1 overflow-auto px-4 py-8">
      <div className="max-w-md mx-auto flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-center">Who are you?</h2>
        <p className="text-sm text-slate-400 text-center mb-2">Pick your crew to see your jobs.</p>
        {crews.length === 0 && (
          <p className="text-sm text-amber-300/90 text-center">This timetable has no crews yet. Ask Control to add them in the planner.</p>
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
      </div>
    </div>
  );
}
