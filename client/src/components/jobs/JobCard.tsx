import type { PathRequest, Station, Train } from '../../types';
import { currentStop, type SeqStop } from '../../lib/stops';
import { jobSummary } from '../../lib/crewJobs';
import { cancelAskText } from '../../lib/pathRequests';
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
}

/** One of the crew's jobs. Run status is shown, never changed here; a requested job can be asked to cancel. */
export function JobCard({ train, seq, stations, clock, expanded, onToggle, isNew, retimedStopIds, request, trains, onWithdraw, onAskCancel }: Props) {
  const askLine = request ? cancelAskText(request) : null;
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const done = train.status === 'completed';
  const running = train.status === 'running';
  const cur = expanded ? currentStop(seq, clock, null) : { index: -1, state: 'none' as const };
  const requested = !!train.request_id;
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
        {running && <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-emerald-900/60 text-emerald-300">Running</span>}
        {done && <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-slate-800 text-slate-400">Done</span>}
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
          {(train.notes?.trim() || requested) && (
            <div className="mt-3 flex items-start gap-3 text-sm">
              <p className="flex-1 whitespace-pre-wrap text-slate-300">{train.notes?.trim() ? `Notes: ${train.notes.trim()}` : ''}</p>
              {requested && <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-blue-900/60 text-blue-300">Requested</span>}
            </div>
          )}
          {request && askLine && (
            <p className={`mt-2 text-sm ${request.cancel_ask?.status === 'rejected' ? 'text-amber-300' : 'text-slate-400'}`}>
              {request.cancel_ask?.status === 'open' ? `Cancel asked: ${askLine}` : askLine}
            </p>
          )}
          {request && trains && onWithdraw && onAskCancel && (
            <div className="mt-3 empty:hidden">
              <RequestActions request={request} trains={trains} onWithdraw={onWithdraw} onAskCancel={onAskCancel} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
