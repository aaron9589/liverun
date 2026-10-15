import type { Station } from '../../types';
import { currentStop, type SeqStop } from '../../lib/stops';

interface Props {
  seq: SeqStop[];
  stations: Station[];
  clock: number | null;
  pinnedStopId: string | null;
  onTogglePin: (stopId: string) => void;
  /** Stops Control just changed; their rows flash briefly. */
  highlightStopIds?: ReadonlySet<string>;
}

/** Stop list for the selected train. Deliberately never renders special_instructions. */
export function StopTable({ seq, stations, clock, pinnedStopId, onTogglePin, highlightStopIds }: Props) {
  const cur = currentStop(seq, clock, pinnedStopId);
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id;

  if (seq.length === 0) {
    return <div className="text-slate-500 text-center py-8">This train has no timed stops.</div>;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="grid grid-cols-[1fr_5rem_5rem] px-4 py-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
        <span>Station</span><span className="text-right">Arr</span><span className="text-right">Dep</span>
      </div>
      {seq.map(({ stop }, i) => {
        const state = i === cur.index ? cur.state : 'none';
        const pass = !!stop.arrival && stop.arrival === stop.departure;
        const rowCls =
          state === 'at' ? 'bg-blue-600/30 border-l-4 border-l-blue-400 text-white'
          : state === 'pinned' ? 'bg-amber-500/20 border-l-4 border-l-amber-400 text-white'
          : state === 'next' ? 'bg-slate-800/60 border-l-4 border-l-slate-500 text-slate-100'
          : 'border-l-4 border-l-transparent text-slate-300';
        const changed = highlightStopIds?.has(stop.id) ? ' ring-2 ring-inset ring-amber-400/80 animate-pulse' : '';
        return (
          <button
            key={stop.id}
            onClick={() => onTogglePin(stop.id)}
            aria-pressed={state === 'pinned'}
            className={`w-full grid grid-cols-[1fr_5rem_5rem] items-center min-h-[52px] px-4 py-1.5 text-left border-b border-slate-800/70 ${rowCls}${changed}`}
          >
            <span className="min-w-0">
              {/* An aliased stop (e.g. a staging road standing in for "Sydney Terminal") leads with the alias; the real location goes underneath. */}
              <span className="block truncate font-medium">{stop.location_alias || name(stop.station_id)}</span>
              {stop.location_alias && <span className="block truncate text-xs text-slate-400">{name(stop.station_id)}</span>}
              {state === 'pinned' && <span className="block text-xs text-amber-300">At platform</span>}
              {state === 'next' && <span className="block text-xs text-slate-400">Next</span>}
            </span>
            {pass ? (
              <span className="col-span-2 text-right font-mono tabular-nums">{stop.departure}<span className="ml-2 text-xs text-slate-500">pass</span></span>
            ) : (
              <>
                <span className="text-right font-mono tabular-nums">{stop.arrival ?? <span className="text-slate-600">–</span>}</span>
                <span className="text-right font-mono tabular-nums">{stop.departure ?? <span className="text-slate-600">–</span>}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
