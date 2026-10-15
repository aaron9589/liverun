import { useState } from 'react';
import type { Crew, Train } from '../types';
import type { PlottingState } from './TrainGraph';

interface Props {
  plotting: PlottingState;
  crews: Crew[];
  /** Other trains moved so far this session (drafts). */
  otherMoved: number;
  onChange: (train: Train) => void;
  onEditStops?: () => void;
  onCancel: () => void;
  onAccept: (note: string) => void;
}

/**
 * Edit bar shown above the graph while a path request is being plotted
 * (docs/path-requests-spec.md §5.3). The note is local; mount with key={requestId}
 * so it resets for each request.
 */
export function PlottingBar({ plotting, crews, otherMoved, onChange, onEditStops, onCancel, onAccept }: Props) {
  const [note, setNote] = useState('');
  const { train, requesterName, withdrawn, warnings, busy } = plotting;

  function changeCrew(crewId: string) {
    const crew = crews.find((c) => c.id === crewId);
    // The draft keeps its own colour (picked to stand out), whoever drives it.
    onChange({ ...train, crew_id: crew?.id });
  }

  return (
    <div className="shrink-0 bg-slate-900 border-b border-slate-700 px-3 py-1.5 text-xs text-slate-300 space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium text-slate-100">Plotting {train.name} for {requesterName}</span>
        <span className="text-amber-300">
          {otherMoved === 0 ? 'No other trains moved' : `${otherMoved} other train${otherMoved === 1 ? '' : 's'} moved`}
        </span>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">Crew</span>
          <select
            value={train.crew_id ?? ''}
            onChange={(e) => changeCrew(e.target.value)}
            disabled={busy}
            className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-200"
          >
            <option value="">Unassigned</option>
            {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {onEditStops && (
          <button
            onClick={onEditStops}
            disabled={busy}
            className="px-2 py-0.5 rounded border border-slate-600 text-slate-200 hover:bg-slate-700/50 disabled:opacity-40"
          >Edit stops</button>
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          maxLength={300}
          placeholder="Note to crew (optional)"
          aria-label="Note to crew"
          className="flex-1 min-w-[10rem] bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-slate-200 placeholder:text-slate-500"
        />
        <button
          onClick={onCancel}
          disabled={busy}
          title="Discard the plot and every move, and release the request"
          className="px-2 py-0.5 rounded border border-slate-600 text-slate-200 hover:bg-slate-700/50 disabled:opacity-40"
        >Cancel</button>
        <button
          onClick={() => onAccept(note)}
          disabled={busy || withdrawn}
          title="Save this train and the other moves (one undo step)"
          className="px-3 py-0.5 rounded bg-emerald-500/90 text-slate-950 font-semibold hover:bg-emerald-400 disabled:opacity-40"
        >{busy ? 'Accepting…' : 'Accept'}</button>
      </div>
      {withdrawn && <div className="text-red-400 font-medium">{requesterName} withdrew this request</div>}
      {warnings.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-amber-300">
          {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  );
}
