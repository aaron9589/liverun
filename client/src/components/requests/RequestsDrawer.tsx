import { useEffect, useMemo, useRef, useState } from 'react';
import type { PathRequest, Timetable } from '../../types';
import { api } from '../../api';
import { ageLabel, hasOpenAsk, isOpenRequest, routeSummary, sortRequests } from '../../lib/requestQueue';

// Right-hand drawer for Control's path-request queue (docs/path-requests-spec.md §5.1).
// Request actions are not undoable: results go straight to onTimetable, never through the history stacks.

interface Props {
  timetable: Timetable;
  /** Request to scroll to and highlight (from a toast's Review button). */
  focusId?: string | null;
  onTimetable: (tt: Timetable) => void;
  /** Highlights a train on the graph while the pointer is over its link; null clears. */
  onHighlightTrain?: (trainId: string | null) => void;
  onClose: () => void;
}

/** Server errors arrive as Error(body) with body JSON `{ error }`; fall back to the raw text. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { error?: string }).error ?? raw; } catch { return raw; }
}

const STATUS_LABEL: Record<PathRequest['status'], string> = {
  pending: 'Pending',
  in_review: 'Plotting',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn by crew',
  cancelled: 'Cancelled',
};

export function RequestsDrawer({ timetable, focusId, onTimetable, onHighlightTrain, onClose }: Props) {
  const requests = useMemo(() => sortRequests(timetable.path_requests ?? []), [timetable.path_requests]);
  const [now, setNow] = useState(() => Date.now());
  const [clearError, setClearError] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hasClosed = requests.some((r) => !isOpenRequest(r));

  async function handleClearClosed() {
    if (!window.confirm('Clear all closed requests (accepted, declined, withdrawn, cancelled)?')) return;
    try {
      onTimetable(await api.clearClosedPathRequests(timetable.id));
      setClearError(null);
    } catch (e) {
      setClearError(errorMessage(e));
    }
  }

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 z-40 w-[min(26rem,100vw)] flex flex-col bg-slate-900 border-l border-slate-700 shadow-2xl"
      aria-label="Path requests"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        <h2 className="text-sm font-semibold text-slate-100">Path requests</h2>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-200" title="Close" aria-label="Close">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {requests.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-8">No requests yet.</p>
        )}
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            timetable={timetable}
            now={now}
            focused={r.id === focusId}
            onTimetable={onTimetable}
            onHighlightTrain={onHighlightTrain}
          />
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-800 shrink-0 flex items-center gap-3">
        <button
          onClick={handleClearClosed}
          disabled={!hasClosed}
          className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Clear closed
        </button>
        {clearError && <span className="text-xs text-red-400">{clearError}</span>}
      </div>
    </aside>
  );
}

type NoteMode = null | 'decline' | 'reject';

function RequestRow({ request: r, timetable, now, focused, onTimetable, onHighlightTrain }: {
  request: PathRequest;
  timetable: Timetable;
  now: number;
  focused: boolean;
  onTimetable: (tt: Timetable) => void;
  onHighlightTrain?: (trainId: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>(null);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focused]);

  const crew = timetable.crews.find((c) => c.id === r.crew_id);
  const train = r.train_id_created ? timetable.trains.find((t) => t.id === r.train_id_created) : undefined;
  const open = isOpenRequest(r);
  const ask = hasOpenAsk(r) ? r.cancel_ask : undefined;

  async function run(call: () => Promise<Timetable>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onTimetable(await call());
      setNoteMode(null);
      setNote('');
      after?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = 'text-xs px-2.5 py-1.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed';
  const primary = `${btn} bg-blue-600 border-blue-500 text-white hover:bg-blue-500`;
  const secondary = `${btn} border-slate-700 text-slate-300 hover:bg-slate-800`;
  const danger = `${btn} border-red-800 text-red-300 hover:bg-red-950`;

  return (
    <div
      ref={ref}
      className={`rounded-lg border p-3 text-sm ${
        ask ? 'border-amber-600 bg-amber-950/20' : focused ? 'border-blue-500 bg-slate-800' : open ? 'border-slate-700 bg-slate-800/60' : 'border-slate-800 bg-slate-900/60 opacity-80'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: crew?.color ?? '#64748b' }} />
        <span className="font-medium text-slate-100 truncate">{crew?.name ?? 'Unknown crew'}</span>
        {r.loco && <span className="text-xs text-slate-400 truncate">{r.loco}</span>}
        <span className="ml-auto text-xs text-slate-500 shrink-0">{ageLabel(r.created_at, now)}</span>
      </div>

      <div className="mt-1.5 text-slate-200">{routeSummary(r, timetable.stations)}</div>
      <div className="mt-1 text-xs text-slate-400">
        Ready: {r.ready_at ? r.ready_at : 'ASAP'}
        <span className="mx-1.5 text-slate-600">·</span>
        <span className="text-slate-500">Times: worked out when plotted</span>
      </div>
      {r.notes && <div className="mt-1 text-xs text-slate-300 whitespace-pre-wrap">{r.notes}</div>}

      {ask && (
        <div className="mt-2 text-xs text-amber-300">
          Asks to cancel{ask.reason ? `: ${ask.reason}` : ''}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {r.status === 'pending' && (
          <>
            <button className={primary} disabled={busy} onClick={() => run(() => api.acknowledgePathRequest(timetable.id, r.id), () => setAcked(true))}>
              Acknowledge &amp; plot
            </button>
            <button className={danger} disabled={busy} onClick={() => setNoteMode(noteMode === 'decline' ? null : 'decline')}>Decline</button>
          </>
        )}
        {r.status === 'in_review' && (
          <>
            <button className={secondary} disabled={busy} onClick={() => run(() => api.releasePathRequest(timetable.id, r.id), () => setAcked(false))}>
              Return to queue
            </button>
            <button className={danger} disabled={busy} onClick={() => setNoteMode(noteMode === 'decline' ? null : 'decline')}>Decline</button>
          </>
        )}
        {r.status === 'accepted' && (
          <>
            {train ? (
              <span
                className="text-xs text-blue-300"
                onMouseEnter={() => onHighlightTrain?.(train.id)}
                onMouseLeave={() => onHighlightTrain?.(null)}
              >
                → {train.name}
              </span>
            ) : (
              <>
                <span className="text-xs text-slate-400">Accepted — train no longer exists</span>
                <button className={secondary} disabled={busy} onClick={() => run(() => api.releasePathRequest(timetable.id, r.id))}>Reopen</button>
              </>
            )}
            {ask && (
              <>
                <button className={`${btn} border-slate-700 text-slate-500`} disabled title="Coming in the next update">Approve cancel</button>
                <button className={danger} disabled={busy} onClick={() => setNoteMode(noteMode === 'reject' ? null : 'reject')}>Reject</button>
              </>
            )}
          </>
        )}
        {(r.status === 'declined' || r.status === 'withdrawn' || r.status === 'cancelled') && (
          <span className="text-xs text-slate-400">{STATUS_LABEL[r.status]}</span>
        )}
      </div>

      {acked && r.status === 'in_review' && (
        <div className="mt-2 text-xs text-slate-400">Acknowledged — plotting arrives in the next update.</div>
      )}

      {noteMode && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            maxLength={300}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteMode === 'decline' ? 'Reason for the crew (required)' : 'Why the train stays (required)'}
            className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-1.5">
            <button
              className={danger}
              disabled={busy || !note.trim()}
              onClick={() => run(() => noteMode === 'decline'
                ? api.declinePathRequest(timetable.id, r.id, note.trim())
                : api.rejectCancelPathRequest(timetable.id, r.id, note.trim()))}
            >
              {noteMode === 'decline' ? 'Decline request' : 'Reject cancel'}
            </button>
            <button className={secondary} onClick={() => { setNoteMode(null); setNote(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {r.control_note && (
        <div className="mt-2 text-xs text-slate-400">Note: {r.control_note}</div>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}
