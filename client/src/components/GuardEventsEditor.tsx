import { useState } from 'react';
import type { GuardEventDef, StationTrigger } from '../types';
import {
  INLINE, effectiveKind, newPlacementForm, newPlacementId, validateForm, type PlacementForm,
} from '../lib/guardEventForm';

interface Props {
  value: PlacementForm[];
  library: GuardEventDef[];
  onChange: (next: PlacementForm[]) => void;
}

const INPUT = 'bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-violet-500/60';

const TRIGGERS: { value: StationTrigger; label: string }[] = [
  { value: 'door_open', label: 'Doors open' },
  { value: 'boarding_done', label: 'Boarding done' },
  { value: 'door_close', label: 'Door close' },
];

/** Collapsed per-stop disclosure for hidden guard events (spec §10.5). */
export function GuardEventsEditor({ value, library, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const patch = (i: number, p: Partial<PlacementForm>) => onChange(value.map((f, j) => (j === i ? { ...f, ...p } : f)));

  return (
    <div className="px-3 pb-2" data-testid="guard-events">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-xs text-violet-300/80 hover:text-violet-200 flex items-center gap-1"
      >
        <span className="inline-block w-3">{open ? '▾' : '▸'}</span>
        Guard events ({value.length})
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-violet-900/60 bg-violet-950/20 p-2 space-y-2">
          <p className="text-[11px] text-violet-300/70">
            Hidden from crews. Only the guard panel sees these; they never appear on station reports or the station board.
          </p>

          {value.map((f, i) => {
            const kind = effectiveKind(f, library);
            const problem = validateForm(f, library);
            return (
              <div key={f.id} className="rounded-md border border-slate-700/70 bg-slate-900/60 p-2 space-y-1.5" data-testid="guard-event-row">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Event"
                    value={f.event}
                    onChange={(e) => patch(i, { event: e.target.value })}
                    className={INPUT}
                  >
                    {library.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.kind === 'enroute' ? 'en route' : 'station'})</option>)}
                    {f.event !== INLINE && !library.some((d) => d.id === f.event) && (
                      <option value={f.event}>{f.event} (missing)</option>
                    )}
                    <option value={INLINE}>Inline…</option>
                  </select>
                  {f.event === INLINE && (
                    <select aria-label="Kind" value={f.kind} onChange={(e) => patch(i, { kind: e.target.value as PlacementForm['kind'] })} className={INPUT}>
                      <option value="station">Station event</option>
                      <option value="enroute">En-route event</option>
                    </select>
                  )}
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    Chance
                    <input
                      aria-label="Probability percent"
                      type="number" min={0} max={100} step={1}
                      value={f.probabilityPct}
                      onChange={(e) => patch(i, { probabilityPct: e.target.value })}
                      className={`${INPUT} w-16`}
                    />
                    %
                  </label>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    className="ml-auto text-xs text-red-400 hover:text-red-300"
                    aria-label="Remove guard event"
                  >
                    Remove
                  </button>
                </div>

                {kind === 'station' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <select aria-label="Trigger" value={f.trigger} onChange={(e) => patch(i, { trigger: e.target.value as StationTrigger })} className={INPUT}>
                      {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    then after
                    <input aria-label="Delay min seconds" type="number" min={0} max={600} value={f.delayMin}
                      onChange={(e) => patch(i, { delayMin: e.target.value })} className={`${INPUT} w-16`} />
                    to
                    <input aria-label="Delay max seconds" type="number" min={0} max={600} value={f.delayMax}
                      onChange={(e) => patch(i, { delayMax: e.target.value })} className={`${INPUT} w-16`} />
                    seconds
                  </div>
                )}
                {kind === 'enroute' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    On the way from this stop to the next stop the train runs to, at
                    <input aria-label="Position min percent" type="number" min={0} max={100} value={f.atMinPct}
                      onChange={(e) => patch(i, { atMinPct: e.target.value })} className={`${INPUT} w-16`} />
                    to
                    <input aria-label="Position max percent" type="number" min={0} max={100} value={f.atMaxPct}
                      onChange={(e) => patch(i, { atMaxPct: e.target.value })} className={`${INPUT} w-16`} />
                    % of the way
                  </div>
                )}

                <textarea
                  aria-label={f.event === INLINE ? 'Messages' : 'Override messages'}
                  rows={f.event === INLINE ? 2 : 1}
                  value={f.messagesText}
                  onChange={(e) => patch(i, { messagesText: e.target.value })}
                  placeholder={f.event === INLINE
                    ? 'Message shown to the guard — one wording per line (one is picked at random)'
                    : 'Optional: override the library wording — one per line'}
                  className={`${INPUT} w-full resize-y`}
                />
                {problem && <p className="text-[11px] text-red-400">{problem}</p>}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onChange([...value, newPlacementForm(newPlacementId(), library)])}
            className="text-xs px-2 py-1 rounded border border-violet-700/60 text-violet-200 hover:bg-violet-900/30"
          >
            + Add guard event
          </button>
        </div>
      )}
    </div>
  );
}
