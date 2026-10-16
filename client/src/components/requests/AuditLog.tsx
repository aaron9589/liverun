import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditAction, AuditEntry, AuditQuery, Timetable } from '../../types';
import { api } from '../../api';
import {
  ACTION_LABEL, AUDIT_ACTIONS, actorLabel, describeDetail, entryRoute, filterOutcome,
  formatAuditDateTime, formatAuditTime, shortDevice,
} from '../../lib/auditView';
import { routeSummary } from '../../lib/requestQueue';

// Control-only audit views for the Requests drawer (docs/path-requests-spec.md §4.4).
// Nothing here is reachable from the crew jobs view.

const PAGE = 200;

function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { error?: string }).error ?? raw; } catch { return raw; }
}

/** Loads entries for a query; `reload` refetches from the newest, `more` appends the next older page. */
function useAudit(query: AuditQuery, deps: unknown[]) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const key = JSON.stringify(query);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getAudit(JSON.parse(key) as AuditQuery);
      setEntries(rows);
      setExhausted(rows.length < (JSON.parse(key) as AuditQuery).limit!);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

  const more = useCallback(async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const q = JSON.parse(key) as AuditQuery;
      const rows = await api.getAudit({ ...q, before: last.at });
      setEntries((prev) => [...prev, ...rows]);
      setExhausted(rows.length < q.limit!);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [key, entries]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload, ...deps]);
  return { entries, loading, error, exhausted, reload, more };
}

/** One entry, collapsed to a line with an expandable detail. `compact` drops the request route and crew columns. */
function EntryRow({ entry: e, timetable, compact }: { entry: AuditEntry; timetable: Timetable; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => describeDetail(e, timetable), [e, timetable]);
  const rejected = e.outcome === 'rejected';
  const route = compact ? '' : entryRoute(e, timetable);
  const raw = e.detail && Object.keys(e.detail).length > 0 ? JSON.stringify(e.detail, null, 1) : '';
  const expandable = lines.length > 0 || !!raw;

  return (
    <div className={`rounded border px-2 py-1.5 text-xs ${rejected ? 'border-red-900 bg-red-950/20' : 'border-slate-800 bg-slate-900/60'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-slate-400 tabular-nums" title={e.at}>{compact ? formatAuditTime(e.at) : formatAuditDateTime(e.at)}</span>
        {e.clock && <span className="text-slate-500" title="Fast-clock time">({e.clock})</span>}
        <span className="text-slate-200">{ACTION_LABEL[e.action] ?? e.action}</span>
        <span className="text-slate-400">{actorLabel(e)}</span>
        {rejected && <span className="text-red-400">rejected{e.error ? `: ${e.error}` : ''}</span>}
        {expandable && (
          <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Detail'}
          </button>
        )}
      </div>
      {route && <div className="mt-0.5 text-slate-300">{route}</div>}
      <div className="mt-0.5 text-slate-500 break-all">
        {e.ip}
        {e.device && <> · <span title={e.device}>{shortDevice(e.device)}</span></>}
        {e.ua && <> · {e.ua}</>}
      </div>
      {open && (
        <div className="mt-1 pl-2 border-l border-slate-700 text-slate-300 space-y-0.5">
          {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
          {lines.length === 0 && <pre className="whitespace-pre-wrap text-slate-400">{raw}</pre>}
        </div>
      )}
    </div>
  );
}

/** Inline history for one request; refetches when `updatedAt` changes. */
export function RequestHistory({ requestId, updatedAt, timetable }: { requestId: string; updatedAt: string; timetable: Timetable }) {
  const query = useMemo<AuditQuery>(() => ({ requestId, limit: PAGE }), [requestId]);
  const { entries, loading, error } = useAudit(query, [updatedAt]);
  return (
    <div className="mt-2 space-y-1">
      {entries.length === 0 && !loading && !error && <div className="text-xs text-slate-500">No history recorded.</div>}
      {entries.map((e, i) => <EntryRow key={`${e.at}-${i}`} entry={e} timetable={timetable} compact />)}
      {loading && <div className="text-xs text-slate-500">Loading…</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

/** The drawer's Audit log tab. */
export function AuditLogTab({ timetable }: { timetable: Timetable }) {
  const [crewId, setCrewId] = useState('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [outcome, setOutcome] = useState<'' | 'ok' | 'rejected'>('');
  const [ip, setIp] = useState('');
  const [device, setDevice] = useState('');
  const [requestId, setRequestId] = useState('');

  // Text filters wait for the pause in typing before hitting the server.
  const [ipQ, setIpQ] = useState('');
  const [deviceQ, setDeviceQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setIpQ(ip.trim()); setDeviceQ(device.trim()); }, 400);
    return () => clearTimeout(t);
  }, [ip, device]);

  // Server-side filters; outcome is applied client-side.
  const query = useMemo<AuditQuery>(() => ({
    timetableId: timetable.id,
    crewId: crewId || undefined,
    action: action || undefined,
    ip: ipQ || undefined,
    device: deviceQ || undefined,
    requestId: requestId || undefined,
    limit: PAGE,
  }), [timetable.id, crewId, action, ipQ, deviceQ, requestId]);

  const { entries, loading, error, exhausted, reload, more } = useAudit(query, []);
  const shown = useMemo(() => filterOutcome(entries, outcome), [entries, outcome]);
  const requests = timetable.path_requests ?? [];

  const field = 'rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500 min-w-0';
  const btn = 'text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="grid grid-cols-2 gap-1.5 p-3 border-b border-slate-800 shrink-0">
        <select className={field} value={crewId} onChange={(e) => setCrewId(e.target.value)} aria-label="Crew">
          <option value="">All crews</option>
          {timetable.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={field} value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')} aria-label="Action">
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </select>
        <select className={field} value={outcome} onChange={(e) => setOutcome(e.target.value as '' | 'ok' | 'rejected')} aria-label="Outcome">
          <option value="">Any outcome</option>
          <option value="ok">OK</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className={field} value={requestId} onChange={(e) => setRequestId(e.target.value)} aria-label="Request">
          <option value="">All requests</option>
          {requests.map((r) => <option key={r.id} value={r.id}>{routeSummary(r, timetable.stations)}</option>)}
        </select>
        <input className={field} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP (exact)" aria-label="IP" />
        <input className={field} value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Device (exact)" aria-label="Device" />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {shown.length === 0 && !loading && !error && <p className="text-sm text-slate-500 text-center py-8">No entries.</p>}
        {shown.map((e, i) => <EntryRow key={`${e.at}-${i}`} entry={e} timetable={timetable} />)}
        {error && <div className="text-xs text-red-400">{error}</div>}
        {loading && <div className="text-xs text-slate-500 text-center">Loading…</div>}
        {!exhausted && entries.length > 0 && (
          <button className={`${btn} w-full`} disabled={loading} onClick={() => void more()}>Load older</button>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-800 shrink-0 flex items-center gap-2">
        <button className={btn} disabled={loading} onClick={() => void reload()}>Refresh</button>
        <a className={btn} href={api.auditCsvUrl({ ...query, limit: 1000 })} download="path-request-audit.csv">Export CSV</a>
        <span className="ml-auto text-xs text-slate-500">{shown.length} shown</span>
      </div>
    </div>
  );
}
