import { useState } from 'react';
import type { PathRequest, Timetable } from '../../types';
import {
  apiErrorText, cancelAskText, controlNote, canAskCancel, canWithdraw, isFaded, isOpen, requestStatusText, routeLabel,
} from '../../lib/pathRequests';

interface Props {
  request: PathRequest;
  timetable: Timetable;
  /** The requesting crew (this device's crew). */
  crewId: string;
  /** Epoch ms, re-rendered by the parent every ~30 s so accepted cards can fade. */
  now: number;
  onWithdraw: (requestId: string) => Promise<void>;
  onAskCancel: (requestId: string, reason: string) => Promise<void>;
}

const CHIP: Record<PathRequest['status'], string> = {
  pending: 'bg-amber-900/60 text-amber-300',
  in_review: 'bg-blue-900/60 text-blue-300',
  accepted: 'bg-emerald-900/60 text-emerald-300',
  declined: 'bg-red-900/60 text-red-300',
  withdrawn: 'bg-slate-800 text-slate-400',
  cancelled: 'bg-slate-800 text-slate-400',
};
const CHIP_LABEL: Record<PathRequest['status'], string> = {
  pending: 'Waiting',
  in_review: 'Plotting',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

type Pending = null | 'withdraw' | 'ask';

const BTN = 'min-h-[48px] px-4 rounded-lg font-medium disabled:opacity-50';

/** One of this crew's path requests. Shows status and route; Withdraw / Ask to cancel are the only actions. */
export function RequestCard({ request, timetable, crewId, now, onWithdraw, onAskCancel }: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = isOpen(request);
  const faded = isFaded(request, now);
  const closed = !open && request.status !== 'accepted';
  const askLine = cancelAskText(request);
  const status = requestStatusText(request, timetable, crewId);
  const control = controlNote(request);
  const ready = request.ready_at ? `Ready at ${request.ready_at}` : 'Ready as soon as possible';

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
    <div className={`rounded-xl border border-slate-800 bg-slate-900 ${closed || faded ? 'opacity-50' : ''}`}>
      <div className="px-4 py-3 flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className="flex-1 min-w-0 font-medium break-words">{status}</p>
          <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${CHIP[request.status]}`}>
            {CHIP_LABEL[request.status]}
          </span>
        </div>
        {!faded && (
          <>
            <p className="text-sm text-slate-300 break-words">{routeLabel(request, timetable.stations)}</p>
            <p className="text-xs text-slate-500">
              {ready}{request.loco ? ` · ${request.loco}` : ''}
            </p>
            {control && request.status !== 'declined' && (
              <p className="text-sm text-amber-300 whitespace-pre-wrap">Control: {control}</p>
            )}
            {askLine && (
              <p className={`text-sm ${request.cancel_ask?.status === 'rejected' ? 'text-amber-300' : 'text-slate-400'}`}>
                {request.cancel_ask?.status === 'open' ? `Cancel asked: ${askLine}` : askLine}
              </p>
            )}
          </>
        )}
      </div>

      {!faded && (canWithdraw(request) || canAskCancel(request)) && (
        <div className="px-4 pb-3 flex flex-col gap-2">
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
              onClick={() => setPending(canWithdraw(request) ? 'withdraw' : 'ask')}
            >
              {canWithdraw(request) ? 'Withdraw' : 'Ask to cancel'}
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
      )}
    </div>
  );
}
