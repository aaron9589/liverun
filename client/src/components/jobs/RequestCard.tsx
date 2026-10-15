import { useState } from 'react';
import type { PathRequest, Timetable } from '../../types';
import {
  apiErrorText, canAskCancel, canWithdraw, controlNote, requestBadge, requestStatusText, routeLabel,
} from '../../lib/pathRequests';
import { Badge } from './Badge';

interface Props {
  request: PathRequest;
  timetable: Timetable;
  /** The requesting crew (this device's crew). */
  crewId: string;
  expanded: boolean;
  onToggle: () => void;
  onWithdraw: (requestId: string) => Promise<void>;
  onAskCancel: (requestId: string, reason: string) => Promise<void>;
}

type Pending = null | 'withdraw' | 'ask';

const BTN = 'min-h-[48px] px-4 rounded-lg font-medium disabled:opacity-50';

/**
 * Withdraw (open request) or Ask to cancel (accepted, train still there), each confirmed
 * inline. Shared by the request card and the job card of a train made from the request.
 * Renders nothing when neither applies.
 */
export function RequestActions({ request, trains, onWithdraw, onAskCancel }: {
  request: PathRequest;
  trains: Timetable['trains'];
  onWithdraw: (requestId: string) => Promise<void>;
  onAskCancel: (requestId: string, reason: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdrawable = canWithdraw(request);
  if (!withdrawable && !canAskCancel(request, trains)) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPending(null);
      setReason('');
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {pending === 'ask' && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Reason (optional)"
          aria-label="Reason for cancelling"
          className="min-h-[48px] w-full rounded-lg bg-slate-800 border border-slate-600 px-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
      )}
      {pending === null ? (
        <button
          className={`${BTN} bg-slate-800 hover:bg-slate-700 text-slate-100`}
          onClick={() => setPending(withdrawable ? 'withdraw' : 'ask')}
        >
          {withdrawable ? 'Withdraw' : 'Ask to cancel'}
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={busy}
            className={`${BTN} flex-1 bg-red-700 hover:bg-red-600 text-white`}
            onClick={() => run(() => (pending === 'withdraw' ? onWithdraw(request.id) : onAskCancel(request.id, reason.trim())))}
          >
            {busy ? 'Sending…' : pending === 'withdraw' ? 'Yes, withdraw' : 'Send request'}
          </button>
          <button
            disabled={busy}
            className={`${BTN} bg-slate-800 hover:bg-slate-700 text-slate-100`}
            onClick={() => { setPending(null); setError(null); }}
          >
            Keep
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

/**
 * One of this crew's requests in the jobs list (waiting, being plotted or just declined).
 * Collapsed by default like a job: the header has the route ends, status line and badge;
 * open it for the full route, notes and Withdraw.
 */
export function RequestCard({ request, timetable, crewId, expanded, onToggle, onWithdraw, onAskCancel }: Props) {
  const status = requestStatusText(request, timetable, crewId);
  const control = controlNote(request);
  const ready = request.ready_at ? `Ready at ${request.ready_at}` : 'Ready as soon as possible';
  const name = (id: string | undefined) => timetable.stations.find((s) => s.id === id)?.name ?? '?';
  const ends = `${name(request.stops[0]?.station_id)} → ${name(request.stops[request.stops.length - 1]?.station_id)}`;

  return (
    <div className={`rounded-xl border border-dashed bg-slate-900 ${request.status === 'declined' ? 'border-red-900/70 opacity-70' : 'border-slate-700'}`}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full min-h-[56px] px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="text-slate-500 w-4 shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold">{ends}</span>
            {request.loco && <span className="text-sm text-slate-400">{request.loco}</span>}
          </span>
          <span className="block text-sm text-slate-400 truncate">{status}</span>
        </span>
        <Badge badge={requestBadge(request)} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          <p className="text-sm text-slate-300 break-words">{routeLabel(request, timetable.stations)}</p>
          <p className="text-xs text-slate-500">{ready}</p>
          {request.notes?.trim() && <p className="text-sm text-slate-400 whitespace-pre-wrap">Your note: {request.notes.trim()}</p>}
          {control && request.status !== 'declined' && (
            <p className="text-sm text-amber-300 whitespace-pre-wrap">Control: {control}</p>
          )}
          <div className="empty:hidden">
            <RequestActions request={request} trains={timetable.trains} onWithdraw={onWithdraw} onAskCancel={onAskCancel} />
          </div>
        </div>
      )}
    </div>
  );
}
