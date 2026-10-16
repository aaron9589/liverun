import { useState } from 'react';
import type { PathRequest, Station, Train } from '../../types';
import { currentStop, type SeqStop } from '../../lib/stops';
import { jobSummary } from '../../lib/crewJobs';
import { apiErrorText, cancelAskText, jobBadges } from '../../lib/pathRequests';
import { Badge } from './Badge';
import { RequestActions } from './RequestCard';

interface Props {
  train: Train;
  seq: SeqStop[];
  stations: Station[];
  clock: number | null;
  expanded: boolean;
  onToggle: () => void;
  /** Job is new (green ring for a minute). */
  isNew: boolean;
  /** Stop ids whose times just changed. */
  retimedStopIds: ReadonlySet<string>;
  /** This crew's accepted request the train was made from, if any: offers Ask to cancel. */
  request?: PathRequest;
  trains?: Train[];
  onWithdraw?: (requestId: string) => Promise<void>;
  onAskCancel?: (requestId: string, reason: string) => Promise<void>;
  /** Sets the train's run status, as the Running board's button does. */
  onSetStatus: (trainId: string, status: Train['status'] | null) => Promise<void>;
}

const RUN_STEP = {
  none: { label: 'Run', aria: 'Mark running', next: 'running', cls: 'bg-slate-800 hover:bg-slate-700 text-slate-100' },
  running: { label: 'Done', aria: 'Mark completed', next: 'completed', cls: 'bg-green-700 hover:bg-green-600 text-white' },
  completed: { label: 'Reset', aria: 'Clear status', next: null, cls: 'bg-slate-800 hover:bg-slate-700 text-slate-300' },
} as const;

/** Run → Done → Reset, the same cycle as the Running board's status button. */
function RunButton({ train, onSetStatus }: { train: Train; onSetStatus: Props['onSetStatus'] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = RUN_STEP[train.status ?? 'none'];

  async function click() {
    setBusy(true);
    setError(null);
    try {
      await onSetStatus(train.id, step.next);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 flex flex-col gap-1">
      <button
        disabled={busy}
        onClick={click}
        aria-label={step.aria}
        title={step.aria}
        className={`min-h-[48px] w-28 px-4 rounded-lg font-medium disabled:opacity-50 ${step.cls}`}
      >
        {step.label}
      </button>
      {error && <p role="alert" className="w-28 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/** One of the crew's jobs: Run / Done / Reset sets its run status; a requested job can be asked to cancel. */
export function JobCard({ train, seq, stations, clock, expanded, onToggle, isNew, retimedStopIds, request, trains, onWithdraw, onAskCancel, onSetStatus }: Props) {
  const askLine = request ? cancelAskText(request) : null;
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const done = train.status === 'completed';
  const badges = jobBadges(train, request);
  const cur = expanded ? currentStop(seq, clock, null) : { index: -1, state: 'none' as const };
  const summary = jobSummary(seq, stations);
  const flashCell = (id: string) => (retimedStopIds.has(id) ? 'bg-amber-500/30 rounded' : '');

  return (
    <div className={`rounded-xl border bg-slate-900 ${isNew ? 'border-green-400 ring-2 ring-green-400/60' : 'border-slate-800'} ${done ? 'opacity-50' : ''}`}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full min-h-[56px] px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="text-slate-500 w-4 shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold">{train.name}</span>
            {train.train_id && <span className="text-sm text-slate-400">{train.train_id}</span>}
          </span>
          {summary && <span className="block text-sm text-slate-400 truncate">{summary}</span>}
        </span>
        {badges.length > 0 && (
          <span className="shrink-0 flex flex-col items-end gap-1">
            {badges.map((b) => <Badge key={b.label} badge={b} />)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {seq.length === 0 ? (
            <p className="text-sm text-slate-500">No times set for this job yet.</p>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="text-xs text-slate-500 text-left">
                  <th className="font-normal py-1">Stop</th>
                  <th className="font-normal py-1 text-right w-16">Arr</th>
                  <th className="font-normal py-1 text-right w-16">Dep</th>
                </tr>
              </thead>
              <tbody>
                {seq.map(({ stop }, i) => {
                  const here = i === cur.index;
                  const alias = stop.location_alias?.trim();
                  const instructions = stop.special_instructions?.trim();
                  return (
                    <tr key={stop.id} className={here ? (cur.state === 'at' ? 'bg-blue-900/50' : 'bg-blue-900/25') : ''}>
                      <td className="py-2 pl-1 pr-2 align-top">
                        <span className="font-medium">{stationName.get(stop.station_id) ?? '?'}</span>
                        {alias && <span className="text-slate-400"> {alias}</span>}
                        {here && <span className="ml-2 text-xs text-blue-300">{cur.state === 'at' ? 'now' : 'next'}</span>}
                        {instructions && <span className="block text-sm text-amber-300 whitespace-pre-wrap">⚑ {instructions}</span>}
                      </td>
                      <td className={`py-2 text-right tabular-nums align-top ${flashCell(stop.id)}`}>{stop.arrival ?? '—'}</td>
                      <td className={`py-2 pr-1 text-right tabular-nums align-top ${flashCell(stop.id)}`}>{stop.departure ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {train.notes?.trim() && (
            <p className="mt-3 text-sm whitespace-pre-wrap text-slate-300">Notes: {train.notes.trim()}</p>
          )}
          {request?.control_note?.trim() && (
            <p className="mt-2 text-sm text-amber-300 whitespace-pre-wrap">Control: {request.control_note.trim()}</p>
          )}
          {request && askLine && (
            <p className={`mt-2 text-sm ${request.cancel_ask?.status === 'rejected' ? 'text-amber-300' : 'text-slate-400'}`}>
              {request.cancel_ask?.status === 'open' ? `Cancel asked: ${askLine}` : askLine}
            </p>
          )}
          <div className="mt-3 flex items-start gap-2">
            <RunButton train={train} onSetStatus={onSetStatus} />
            {request && trains && onWithdraw && onAskCancel && (
              <div className="flex-1 min-w-0 empty:hidden">
                <RequestActions request={request} trains={trains} onWithdraw={onWithdraw} onAskCancel={onAskCancel} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
