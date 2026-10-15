import { useEffect, useMemo, useRef, useState } from 'react';
import type { PathRequest, Timetable } from '../../types';
import { api } from '../../api';
import { describeSource, planRoute } from '../../lib/pathPlan';
import { AuditLogTab, RequestHistory } from './AuditLog';
import { ageLabel, hasOpenAsk, isOpenRequest, routeSummary, sortRequests } from '../../lib/requestQueue';

// Right-hand drawer for Control's path-request queue (docs/path-requests-spec.md §5.1).
// Request actions are not undoable: results go straight to onTimetable, never through the history stacks.

interface Props {
  timetable: Timetable;
  /** Request to scroll to and highlight (from a toast's Review button). */
  focusId?: string | null;
  onTimetable: (tt: Timetable) => void;
  /** Acknowledge (pending) or resume (in_review) and open the request on the graph. Throws on failure. */
  onStartPlot: (requestId: string, acknowledge: boolean) => Promise<void>;
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

export function RequestsDrawer({ timetable, focusId, onTimetable, onStartPlot, onHighlightTrain, onClose }: Props) {
  const requests = useMemo(() => sortRequests(timetable.path_requests ?? []), [timetable.path_requests]);
  const [now, setNow] = useState(() => Date.now());
  const [clearError, setClearError] = useState<string | null>(null);
  const [tab, setTab] = useState<'requests' | 'audit'>('requests');
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
      className={`fixed top-0 right-0 bottom-0 z-40 ${tab === 'audit' ? 'w-[min(40rem,100vw)]' : 'w-[min(26rem,100vw)]'} flex flex-col bg-slate-900 border-l border-slate-700 shadow-2xl`}
      aria-label="Path requests"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        <h2 className="text-sm font-semibold text-slate-100">Path requests</h2>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-200" title="Close" aria-label="Close">✕</button>
      </div>

      <div className="flex border-b border-slate-800 shrink-0 text-xs" role="tablist">
        {([['requests', 'Requests'], ['audit', 'Audit log']] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 border-b-2 ${tab === k ? 'border-blue-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'audit' && <AuditLogTab timetable={timetable} />}

      {tab === 'requests' && <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
            onStartPlot={onStartPlot}
            onHighlightTrain={onHighlightTrain}
          />
        ))}
      </div>}

      {tab === 'requests' && <div className="px-4 py-2.5 border-t border-slate-800 shrink-0 flex items-center gap-3">
        <button
          onClick={handleClearClosed}
          disabled={!hasClosed}
          className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Clear closed
        </button>
        {clearError && <span className="text-xs text-red-400">{clearError}</span>}
      </div>}
    </aside>
  );
}

type NoteMode = null | 'decline' | 'reject' | 'approve';

/** "Path Kiama–Bombo" etc. The planner may not be able to work a request out; never break the row. */
function timesFrom(r: PathRequest, timetable: Timetable): string {
  try {
    const { source, legs } = planRoute(r, timetable);
    const name = (id: string) => timetable.stations.find((s) => s.id === id)?.name ?? '?';
    return describeSource(source, legs, name);
  } catch {
    return 'Times: worked out when plotted';
  }
}

function RequestRow({ request: r, timetable, now, focused, onTimetable, onStartPlot, onHighlightTrain }: {
  request: PathRequest;
  timetable: Timetable;
  now: number;
  focused: boolean;
  onTimetable: (tt: Timetable) => void;
  onStartPlot: (requestId: string, acknowledge: boolean) => Promise<void>;
  onHighlightTrain?: (trainId: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState<NoteMode>(null);
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focused]);

  const crew = timetable.crews.find((c) => c.id === r.crew_id);
  const train = r.train_id_created ? timetable.trains.find((t) => t.id === r.train_id_created) : undefined;
  const open = isOpenRequest(r);
  const ask = hasOpenAsk(r) ? r.cancel_ask : undefined;

  // Only worked out while the request is open: closed rows don't need the route.
  const timesLine = useMemo(() => (open && r.status !== 'accepted' ? timesFrom(r, timetable) : null), [open, r, timetable]);

  async function run(call: () => Promise<Timetable | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      if (result) onTimetable(result);
      setNoteMode(null);
      setNote('');
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
        {timesLine && <span className="text-slate-500">{timesLine}</span>}
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
            <button className={primary} disabled={busy} onClick={() => run(() => onStartPlot(r.id, true))}>
              Acknowledge &amp; plot
            </button>
            <button className={danger} disabled={busy} onClick={() => setNoteMode(noteMode === 'decline' ? null : 'decline')}>Decline</button>
          </>
        )}
        {r.status === 'in_review' && (
          <>
            <button className={primary} disabled={busy} onClick={() => run(() => onStartPlot(r.id, false))}>
              Resume plotting
            </button>
            <button className={secondary} disabled={busy} onClick={() => run(() => api.releasePathRequest(timetable.id, r.id))}>
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
                <button className={primary} disabled={busy} onClick={() => setNoteMode(noteMode === 'approve' ? null : 'approve')}>Approve cancel</button>
                <button className={danger} disabled={busy} onClick={() => setNoteMode(noteMode === 'reject' ? null : 'reject')}>Reject</button>
              </>
            )}
          </>
        )}
        {(r.status === 'declined' || r.status === 'withdrawn' || r.status === 'cancelled') && (
          <span className="text-xs text-slate-400">{STATUS_LABEL[r.status]}</span>
        )}
      </div>

      {noteMode && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            maxLength={300}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteMode === 'decline' ? 'Reason for the crew (required)' : noteMode === 'reject' ? 'Why the train stays (required)' : 'Note for the crew (optional)'}
            className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-1.5">
            <button
              className={danger}
              disabled={busy || (noteMode !== 'approve' && !note.trim())}
              onClick={() => run(() => noteMode === 'decline'
                ? api.declinePathRequest(timetable.id, r.id, note.trim())
                : noteMode === 'reject'
                  ? api.rejectCancelPathRequest(timetable.id, r.id, note.trim())
                  // Deletes the train but is deliberately not an undo step: requests don't follow undo.
                  : api.approveCancelPathRequest(timetable.id, r.id, note.trim() || undefined))}
            >
              {noteMode === 'decline' ? 'Decline request' : noteMode === 'reject' ? 'Reject cancel' : 'Approve and delete train'}
            </button>
            <button className={secondary} onClick={() => { setNoteMode(null); setNote(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {r.control_note && (
        <div className="mt-2 text-xs text-slate-400">Note: {r.control_note}</div>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      <button className="mt-2 text-xs text-slate-500 hover:text-slate-300" onClick={() => setShowHistory(!showHistory)}>
        {showHistory ? 'Hide history' : 'History'}
      </button>
      {showHistory && <RequestHistory requestId={r.id} updatedAt={r.updated_at} timetable={timetable} />}
    </div>
  );
}
