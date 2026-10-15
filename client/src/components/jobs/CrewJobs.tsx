// Crew jobs view at …/mobile (docs/path-requests-spec.md §3). Read-only: shows the
// picked crew's jobs and follows Control's changes live. Never changes run state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveTimetable } from '../../hooks/useLiveTimetable';
import { useFastClock } from '../../hooks/useFastClock';
import { api } from '../../api';
import { changeMobileView, switchMode } from '../../lib/mode';
import { helpUrl } from '../../lib/help';
import { autoSelectTrain, sequenceStops, sortByRun } from '../../lib/stops';
import { describeJobChange, diffJobs } from '../../lib/jobDiff';
import { fmtMins } from '../../lib/crewJobs';
import { setClockHint } from '../../lib/device';
import { defaultFrom, requestForTrain, requestItems, requestToasts } from '../../lib/pathRequests';
import type { PathRequestSubmit, Timetable } from '../../types';
import { ChangeToasts, useToasts } from '../ChangeToasts';
import { CrewPicker } from './CrewPicker';
import { JobCard } from './JobCard';
import { RequestCard } from './RequestCard';
import { RequestForm } from './RequestForm';

const crewKey = (ttId: string) => `jobs:crew:${ttId}`;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** A set of ids that each drop out durationMs after they were last flagged. */
function useTimedFlags(durationMs: number): [ReadonlySet<string>, (ids: string[]) => void] {
  const [flags, setFlags] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flag = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFlags((prev) => new Set([...prev, ...ids]));
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setFlags((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }, durationMs));
    }
  }, [durationMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  return [flags, flag];
}

export function CrewJobs() {
  const [ttId, setTtId] = useState<string | null>(null);
  const live = useLiveTimetable(ttId);
  const { timetable, activeId, status: liveStatus } = live;
  const toasts = useToasts();
  const [newIds, flagNew] = useTimedFlags(60_000);
  const [retimedIds, flagRetimed] = useTimedFlags(10_000);

  // Follow the server's active timetable; a later switch by Control is announced.
  useEffect(() => {
    if (activeId === undefined || activeId === ttId) return;
    if (ttId === null || activeId === null) { setTtId(activeId); return; }
    setTtId(activeId);
    api.listTimetables()
      .then((list) => {
        const name = list.find((t) => t.id === activeId)?.name;
        toasts.push(name ? `Control switched to ${name}` : 'Control switched timetable', 'warning');
      })
      .catch(() => toasts.push('Control switched timetable', 'warning'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, ttId]);
  useEffect(() => {
    // Our timetable was deleted: follow whatever is active now.
    if (live.deleted) setTtId(activeId ?? null);
  }, [live.deleted, activeId]);

  const settings = timetable?.settings;
  const clockConfigured = !!settings?.clock_enabled && !!settings?.clock_broker_url;
  const { clockTime, status: clockStatus } = useFastClock(
    settings?.clock_broker_url ?? '',
    settings?.clock_topic ?? '',
    clockConfigured,
  );
  const lastClock = useRef<number | null>(null);
  if (clockTime !== null) lastClock.current = clockTime;
  const clock = clockConfigured ? (clockTime ?? lastClock.current) : null;
  const clockLive = clockStatus === 'connected' && clockTime !== null;

  // The fast clock rides along on request calls so the audit log can carry it.
  useEffect(() => { setClockHint(clock); }, [clock]);

  // Crew choice, per timetable on this device. A stored crew that no longer exists reopens the picker.
  const [pickedCrew, setPickedCrew] = useState<{ ttId: string; crewId: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingCrew, setPickingCrew] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const crewId = timetable ? (pickedCrew?.ttId === timetable.id ? pickedCrew.crewId : readStore(crewKey(timetable.id))) : null;
  const crew = timetable?.crews.find((c) => c.id === crewId) ?? null;
  const showPicker = !!timetable && (pickingCrew || !crew);
  const pickCrew = (id: string) => {
    if (!timetable) return;
    writeStore(crewKey(timetable.id), id);
    setPickedCrew({ ttId: timetable.id, crewId: id });
    setPickingCrew(false);
    setOpen(new Map());
  };

  // My jobs: only this crew's trains, in run order.
  const trains = useMemo(
    () => (timetable && crew ? sortByRun(timetable.trains.filter((t) => t.crew_id === crew.id)) : []),
    [timetable, crew],
  );
  // The current or next job opens by itself; taps override per card.
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const autoId = autoSelectTrain(trains, clock)?.id ?? null;

  // This crew's requests that aren't a job yet. A 30 s tick lets a declined one drop out after ten minutes.
  const [now, setNow] = useState(() => Date.now());
  const requests = useMemo(() => requestItems(timetable?.path_requests, crew?.id ?? '', now), [timetable?.path_requests, crew?.id, now]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const canRequest = !!timetable && !!crew && timetable.settings.requests_enabled !== false;

  const submitRequest = async (body: PathRequestSubmit) => {
    if (!timetable) return;
    live.replace(await api.submitPathRequest(timetable.id, body));
    setRequesting(false);
  };
  const withdraw = async (requestId: string) => {
    if (!timetable || !crew) return;
    live.replace(await api.withdrawPathRequest(timetable.id, requestId, crew.id));
  };
  const askCancel = async (requestId: string, reason: string) => {
    if (!timetable || !crew) return;
    live.replace(await api.askCancelPathRequest(timetable.id, requestId, crew.id, reason || undefined));
  };

  // Control's changes: toasts, green ring for new jobs, flashed cells for retimed stops. No sounds.
  const prevTt = useRef<Timetable | null>(null);
  useEffect(() => {
    const prev = prevTt.current;
    prevTt.current = timetable;
    if (!prev || !timetable || prev.id !== timetable.id || !crew) return;
    for (const t of requestToasts(prev.path_requests, timetable.path_requests, crew.id, timetable)) toasts.push(t.message, t.tone);
    const changes = diffJobs(prev, timetable, [crew.id]);
    if (changes.length === 0) return;
    if (changes.length > 5) toasts.push(`Control changed ${changes.length} of your jobs`, 'warning');
    else for (const c of changes) { const d = describeJobChange(c); toasts.push(d.message, d.tone); }
    flagNew(changes.filter((c) => c.type === 'added').map((c) => c.train.id));
    flagRetimed(changes.flatMap((c) => (c.type === 'retimed' ? c.stopIds : [])));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable]);

  const menuItem = 'w-full min-h-[48px] px-4 text-left hover:bg-slate-800';
  const dotColor = liveStatus === 'live' ? 'bg-emerald-400' : liveStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-500';
  const dotLabel = liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Reconnecting';

  const header = (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
      <span className="flex items-center gap-2 min-w-0">
        {crew && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: crew.color }} />}
        <span className="text-lg font-semibold truncate">{crew && !showPicker ? crew.name : 'Crew jobs'}</span>
      </span>
      <div className="ml-auto flex items-center gap-3">
        {clockConfigured && (
          <span
            className={`font-mono text-2xl tabular-nums ${clockLive ? 'text-white' : 'text-slate-500'}`}
            title={clockLive ? 'Fast clock' : 'Fast clock disconnected'}
          >
            {clock === null ? '--:--' : fmtMins(clock)}
          </span>
        )}
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} title={dotLabel} role="img" aria-label={dotLabel} />
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
            className="min-w-[48px] min-h-[48px] rounded-lg bg-slate-800 hover:bg-slate-700 text-xl"
          >☰</button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-30 w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
                <button className={menuItem} onClick={() => { setMenuOpen(false); setPickingCrew(true); }}>Change crew</button>
                <button className={menuItem} onClick={changeMobileView}>Change view</button>
                <button className={menuItem} onClick={switchMode}>Switch mode</button>
                <a className={`${menuItem} flex items-center`} href={helpUrl('crew-jobs.md')} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Help</a>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );

  let body;
  if (activeId === null && !timetable) {
    body = (
      <div className="flex-1 flex items-center justify-center text-center px-6 text-slate-400">
        No session is running. Control hasn't set an active timetable.
      </div>
    );
  } else if (!timetable) {
    body = (
      <div className="flex-1 flex items-center justify-center text-slate-500 px-6 text-center">
        {live.error ? `Could not load timetable: ${live.error}` : 'Loading…'}
      </div>
    );
  } else if (showPicker) {
    body = <CrewPicker crews={timetable.crews} onPick={pickCrew} />;
  } else {
    body = (
      <main className="flex-1 overflow-auto p-3 flex flex-col gap-3 content-start">
        {canRequest && (
          <button
            onClick={() => setRequesting(true)}
            className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-500 text-lg font-semibold"
          >+ Request a path</button>
        )}
        <h1 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">My jobs</h1>
        {requests.length === 0 && trains.length === 0 && <p className="text-slate-400">No jobs for this crew yet.</p>}
        {/* Requests not yet a job come first, collapsed; accepted ones are their job below. */}
        {requests.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            timetable={timetable}
            crewId={crew!.id}
            expanded={open.get(r.id) ?? false}
            onToggle={() => setOpen((prev) => new Map(prev).set(r.id, !(prev.get(r.id) ?? false)))}
            onWithdraw={withdraw}
            onAskCancel={askCancel}
          />
        ))}
        {trains.map((t) => (
          <JobCard
            key={t.id}
            train={t}
            seq={sequenceStops(t)}
            stations={timetable.stations}
            clock={clock}
            expanded={open.get(t.id) ?? t.id === autoId}
            onToggle={() => setOpen((prev) => new Map(prev).set(t.id, !(prev.get(t.id) ?? t.id === autoId)))}
            isNew={newIds.has(t.id)}
            retimedStopIds={retimedIds}
            request={requestForTrain(timetable.path_requests, t.id)}
            trains={timetable.trains}
            onWithdraw={withdraw}
            onAskCancel={askCancel}
          />
        ))}
      </main>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-950 text-slate-100">
      {header}
      {body}
      {requesting && canRequest && (
        <RequestForm
          crew={crew!}
          stations={timetable!.stations}
          clock={clock}
          initialFrom={defaultFrom(timetable!.trains, crew!.id, clock)}
          initialLoco={trains.find((t) => t.id === autoId)?.train_id ?? ''}
          onSubmit={submitRequest}
          onClose={() => setRequesting(false)}
        />
      )}
      <ChangeToasts toasts={toasts.toasts} onDismiss={toasts.dismiss} placement="bottom" />
    </div>
  );
}
