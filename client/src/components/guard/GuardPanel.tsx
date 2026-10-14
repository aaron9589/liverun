import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveTimetable } from '../../hooks/useLiveTimetable';
import { api } from '../../api';
import { useFastClock } from '../../hooks/useFastClock';
import { requestWakeLock, unlockAudio } from '../../lib/audio';
import { playSound } from '../../lib/sound';
import { resolveProfile } from '../../lib/profiles';
import { switchMode } from '../../lib/mode';
import { autoSelectTrain, formsNext as findFormsNext, sequenceStops, sortByRun, type SeqStop } from '../../lib/stops';
import { describeJobChange, diffJobs } from '../../lib/jobDiff';
import type { Timetable, Train } from '../../types';
import { ChangeToasts, useToasts } from '../ChangeToasts';
import { useLayout, getPanelId } from '../../hooks/useLayout';
import { useJmriRoster } from '../../hooks/useJmriRoster';
import { useJmriThrottle } from '../../hooks/useJmriThrottle';
import { useProfileActions } from '../../hooks/useProfileActions';
import { CrewPicker } from './CrewPicker';
import { DoorsCard } from './DoorsCard';
import { StopTable } from './StopTable';

const CREW_KEY = 'guard:crew';
const trainKey = (ttId: string) => `guard:train:${ttId}`;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function formatClock(m: number | null): string {
  if (m === null) return '--:--';
  const t = ((m % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Pin identity that survives Control re-saving the train (stop ids are re-minted on save). */
function pinKeyOf(seq: SeqStop[], stopId: string): string | null {
  const counts = new Map<string, number>();
  for (const { stop } of seq) {
    const n = counts.get(stop.station_id) ?? 0;
    counts.set(stop.station_id, n + 1);
    if (stop.id === stopId) return `${stop.station_id}#${n}`;
  }
  return null;
}
function stopIdOfPin(seq: SeqStop[], key: string | null): string | null {
  if (!key) return null;
  const counts = new Map<string, number>();
  for (const { stop } of seq) {
    const n = counts.get(stop.station_id) ?? 0;
    counts.set(stop.station_id, n + 1);
    if (`${stop.station_id}#${n}` === key) return stop.id;
  }
  return null;
}

function Dot({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const color = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-500';
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400" title={label}>
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export function GuardPanel() {
  const [ttId, setTtId] = useState<string | null>(null);
  const live = useLiveTimetable(ttId);
  const { timetable, activeId, status: liveStatus } = live;

  const toasts = useToasts();

  const layout = useLayout();
  const alertSound = useRef(layout.guard.event_alert_sound);
  alertSound.current = layout.guard.event_alert_sound;
  const playAlert = useCallback(() => { void playSound(alertSound.current); }, []);

  // Follow the server's active timetable. The first one is adopted directly;
  // a later switch by Control waits for the guard's ACK (spec §6.5).
  const [pendingActive, setPendingActive] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (activeId === undefined) return;
    if (ttId === null) { if (activeId) setTtId(activeId); return; }
    setPendingActive(activeId !== ttId ? activeId : undefined);
  }, [activeId, ttId]);
  useEffect(() => {
    // Our timetable is gone: nothing left to hold on to, follow the active one now.
    if (!live.deleted) return;
    setPendingActive(undefined);
    setTtId(activeId ?? null);
  }, [live.deleted, activeId]);

  const settings = timetable?.settings;
  const { clockTime, status: clockStatus } = useFastClock(
    settings?.clock_broker_url ?? '',
    settings?.clock_topic ?? '',
    !!settings?.clock_enabled && !!settings?.clock_broker_url,
  );
  const clockConfigured = !!settings?.clock_enabled && !!settings?.clock_broker_url;
  const lastClock = useRef<number | null>(null);
  if (clockTime !== null) lastClock.current = clockTime;
  const clockShown = clockConfigured ? (clockTime ?? lastClock.current) : null;
  const clockLive = clockStatus === 'connected' && clockTime !== null;

  // Crew choice
  const [crewId, setCrewId] = useState<string | null>(() => readStore(CREW_KEY));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingCrew, setPickingCrew] = useState(false);
  const crew = timetable?.crews.find((c) => c.id === crewId) ?? null;
  const crewValid = crewId === '*' || crew !== null;
  const showPicker = !!timetable && (pickingCrew || !crewValid);

  const pickCrew = (id: string) => {
    writeStore(CREW_KEY, id);
    setCrewId(id);
    setPickingCrew(false);
    setSelectedId(null);
    setBackStack([]);
    isAuto.current = true;
    clockSeen.current = false;
  };

  // Train list (run order)
  const trains = useMemo(() => {
    if (!timetable || !crewValid) return [];
    const mine = crewId === '*' ? timetable.trains : timetable.trains.filter((t) => t.crew_id === crewId);
    return sortByRun(mine);
  }, [timetable, crewId, crewValid]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<string[]>([]);
  const isAuto = useRef(true);
  const clockSeen = useRef(false);

  // Selected train removed / reassigned away by Control: keep showing the old
  // copy (so the guard can still close doors) until they acknowledge.
  const [lost, setLost] = useState<{ train: Train; message: string } | null>(null);
  const lostRef = useRef<{ train: Train; message: string } | null>(null);


  const train = lost ? lost.train : trains.find((t) => t.id === selectedId) ?? null;
  const select = useCallback((id: string, push: boolean) => {
    if (!timetable) return;
    actionsRef.current.stopAll();
    isAuto.current = false;
    writeStore(trainKey(timetable.id), id);
    setBackStack((s) => (push && selectedId ? [...s, selectedId] : []));
    setSelectedId(id);
  }, [timetable, selectedId]);

  const goBack = () => {
    const prev = backStack[backStack.length - 1];
    if (!prev || !timetable) return;
    actionsRef.current.stopAll();
    writeStore(trainKey(timetable.id), prev);
    setBackStack((s) => s.slice(0, -1));
    setSelectedId(prev);
  };

  // JMRI: the displayed train drives the throttle, so a train held behind the
  // lost-train banner keeps its throttle (Door Close still reaches it) until ACK.
  const panelId = useMemo(getPanelId, []);
  const roster = useJmriRoster(layout.jmri.url);
  const trainIdName = train?.train_id || null;
  const rosterEntry = useMemo(
    () => (trainIdName ? roster.entries.find((e) => e.name === trainIdName) ?? null : null),
    [roster.entries, trainIdName],
  );
  const profile = useMemo(
    () => resolveProfile(layout.train_profiles, train?.train_id),
    [layout.train_profiles, train?.train_id],
  );
  const throttle = useJmriThrottle(layout.jmri.url, trainIdName, 'guard-' + panelId);
  const actions = useProfileActions(throttle, profile, rosterEntry);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // Turn off anything we left on before the throttle moves to another train.
  const shownTrainId = train?.id ?? null;
  useEffect(() => () => actionsRef.current.stopAll(), [shownTrainId]);
  const jmriConfigured = throttle.status !== 'unconfigured';

  // Placeholders for the boarding phase.
  const onBoardingStart = useCallback(() => { /* boarding UI: next phase */ }, []);
  const onDoorsClosed = useCallback(() => { /* boarding UI: next phase */ }, []);

  const seq = useMemo(() => (train ? sequenceStops(train) : []), [train]);

  // Pinned stop ("at platform"), reset per train. Held as station+visit so a
  // retime by Control keeps the pin.
  const [pinKey, setPinKey] = useState<string | null>(null);
  useEffect(() => { setPinKey(null); }, [selectedId]);
  const pinnedStopId = stopIdOfPin(seq, pinKey);

  // React to Control's changes: toasts, flash retimed stops, hold a lost train.
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const prevTt = useRef<Timetable | null>(null);
  useEffect(() => {
    const prev = prevTt.current;
    prevTt.current = timetable;
    if (!prev || !timetable || prev.id !== timetable.id || !crewValid || !crewId) return;
    const changes = diffJobs(prev, timetable, crewId === '*' ? null : [crewId]);
    if (changes.length === 0) return;
    if (changes.some((c) => c.type === 'added')) playAlert();
    if (changes.length > 5) toasts.push(`Control changed ${changes.length} of your jobs`, 'warning');
    else for (const c of changes) { const d = describeJobChange(c); toasts.push(d.message, d.tone); }

    const sel = selectedRef.current;
    for (const c of changes) {
      if (c.train.id !== sel) continue;
      const lostMsg =
        c.type === 'removed' ? `Control has removed ${c.train.name} from your jobs`
        : c.type === 'reassigned' ? `Control has reassigned ${c.train.name} to ${c.crew?.name ?? 'no crew'}`
        : null;
      if (lostMsg) { playAlert(); lostRef.current = { train: c.train, message: lostMsg }; setLost(lostRef.current); }
      if (c.type === 'retimed') {
        setFlash(new Set(c.stopIds));
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(new Set()), 10_000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable]);

  useEffect(() => {
    // Runs after the change detection above, so a train Control just took
    // away is already held in lostRef and isn't silently replaced.
    if (lost || lostRef.current || !timetable || trains.length === 0) return;
    if (selectedId && trains.some((t) => t.id === selectedId)) {
      // Re-run auto-select once when the first clock reading arrives.
      if (isAuto.current && !clockSeen.current && clockShown !== null) {
        clockSeen.current = true;
        const t = autoSelectTrain(trains, clockShown);
        if (t && t.id !== selectedId) setSelectedId(t.id);
      }
      return;
    }
    const stored = readStore(trainKey(timetable.id));
    if (stored && trains.some((t) => t.id === stored)) {
      isAuto.current = false;
      setSelectedId(stored);
      return;
    }
    isAuto.current = true;
    clockSeen.current = clockShown !== null;
    setSelectedId(autoSelectTrain(trains, clockShown)?.id ?? null);
  }, [lost, timetable, trains, selectedId, clockShown]);

  // Control banners get the alert sound too.
  const lostShown = lost !== null;
  useEffect(() => { if (lostShown) playAlert(); }, [lostShown, playAlert]);
  const activeBannerShown = pendingActive !== undefined;
  useEffect(() => { if (activeBannerShown) playAlert(); }, [activeBannerShown, playAlert]);

  const ackLost = () => {
    actions.stopAll();
    lostRef.current = null;
    setLost(null);
    setBackStack([]);
    isAuto.current = true;
    clockSeen.current = clockShown !== null;
    setSelectedId(autoSelectTrain(trains, clockShown)?.id ?? null);
  };
  const ackActive = () => {
    actions.stopAll();
    const next = pendingActive ?? null;
    setPendingActive(undefined);
    lostRef.current = null;
    setLost(null);
    setSelectedId(null);
    setBackStack([]);
    isAuto.current = true;
    clockSeen.current = false;
    setTtId(next);
  };
  const [pendingName, setPendingName] = useState<string | null>(null);
  useEffect(() => {
    setPendingName(null);
    if (!pendingActive) return;
    let cancelled = false;
    api.listTimetables()
      .then((list) => { if (!cancelled) setPendingName(list.find((t) => t.id === pendingActive)?.name ?? null); })
      .catch(() => { /* banner falls back to a generic label */ });
    return () => { cancelled = true; };
  }, [pendingActive]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const forms = train && timetable ? findFormsNext(train, timetable.trains) : null;

  // Tap to start
  const [started, setStarted] = useState(false);
  const start = () => {
    setStarted(true);
    void unlockAudio();
    requestWakeLock();
  };

  const header = (
    <header className="flex items-center gap-2 sm:gap-3 px-3 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
      {backStack.length > 0 && (
        <button onClick={goBack} className="min-h-[48px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">◀ Back</button>
      )}
      {timetable && trains.length > 0 && (
        <select
          value={selectedId ?? ''}
          onChange={(e) => select(e.target.value, false)}
          aria-label="Train"
          className="min-h-[48px] min-w-0 max-w-[40vw] rounded-lg bg-slate-800 border border-slate-700 px-3 text-base"
        >
          {lost && <option value={lost.train.id} disabled>{lost.train.name} (removed)</option>}
          {trains.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {crewValid && crewId && timetable && (
        <span className="text-sm text-slate-400 truncate hidden sm:inline">
          {crewId === '*' ? 'All trains' : crew?.name}
        </span>
      )}
      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <span
          className={`font-mono text-2xl sm:text-3xl tabular-nums ${clockLive ? 'text-white' : 'text-slate-500'}`}
          title={clockConfigured ? (clockLive ? 'Fast clock' : 'Fast clock disconnected') : 'Fast clock not configured'}
        >
          {formatClock(clockShown)}
        </span>
        <Dot ok={liveStatus === 'live'} warn={liveStatus === 'connecting'} label={liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Reconnecting'} />
        {jmriConfigured && (
          <Dot
            ok={throttle.status === 'connected' && (throttle.acquired || !trainIdName)}
            warn={throttle.status === 'connecting' || throttle.status === 'connected'}
            label={throttle.status !== 'connected' ? 'JMRI off' : trainIdName && !throttle.acquired ? 'JMRI…' : 'JMRI'}
          />
        )}
        <Dot ok={clockLive} warn={clockStatus === 'connecting'} label={clockConfigured ? (clockLive ? 'Clock' : 'Clock off') : 'No clock'} />
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
                <button className="w-full min-h-[48px] px-4 text-left hover:bg-slate-800" onClick={() => { setMenuOpen(false); setPickingCrew(true); }}>Change crew</button>
                <button className="w-full min-h-[48px] px-4 text-left hover:bg-slate-800" onClick={() => { setMenuOpen(false); setHistoryOpen(true); }}>Changes from Control</button>
                <button className="w-full min-h-[48px] px-4 text-left hover:bg-slate-800" onClick={switchMode}>Switch mode</button>
                <button className="w-full min-h-[48px] px-4 text-left hover:bg-slate-800" onClick={() => window.location.reload()}>Reload</button>
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
        No active timetable — set one in the planner.
      </div>
    );
  } else if (!timetable) {
    body = (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        {live.error ? `Could not load timetable: ${live.error}` : 'Loading…'}
      </div>
    );
  } else if (showPicker) {
    body = <CrewPicker crews={timetable.crews} onPick={pickCrew} />;
  } else if (!train) {
    body = <div className="flex-1 flex items-center justify-center text-slate-400 px-6 text-center">No trains for this crew.</div>;
  } else {
    body = (
      <main className="flex-1 overflow-auto p-3 sm:p-4 grid gap-4 lg:grid-cols-2 lg:items-start content-start">
        {/* Left column: train info; later phases add panels below it. */}
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold">{train.name}</h1>
              {forms && <span className="text-sm text-slate-400">→ forms {forms.name}</span>}
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Train ID</dt>
              <dd>{train.train_id || <span className="text-slate-500">no roster ID</span>}</dd>
              <dt className="text-slate-500">Direction</dt>
              <dd>{train.direction || <span className="text-slate-500">—</span>}</dd>
              <dt className="text-slate-500">Notes</dt>
              <dd className="whitespace-pre-wrap">{train.notes || <span className="text-slate-500">—</span>}</dd>
            </dl>
          </div>
          <DoorsCard
            key={train.id}
            profile={profile}
            throttle={throttle}
            actions={actions}
            boarding={layout.boarding}
            hasTrainId={!!train.train_id}
            onBoardingStart={onBoardingStart}
            onDoorsClosed={onDoorsClosed}
          />
        </section>
        <section>
          <StopTable
            seq={seq}
            stations={timetable.stations}
            clock={clockShown}
            pinnedStopId={pinnedStopId}
            onTogglePin={(id) => setPinKey((k) => { const key = pinKeyOf(seq, id); return k === key ? null : key; })}
            highlightStopIds={flash}
            formsNext={forms}
            onForms={(id) => select(id, true)}
          />
        </section>
      </main>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-950 text-slate-100">
      {header}
      {lost && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 bg-red-900/60 border-b border-red-700 text-red-100">
          <span className="flex-1 font-medium">{lost.message}. Close doors if open, then acknowledge.</span>
          <button onClick={ackLost} className="min-h-[48px] px-5 rounded-lg bg-red-600 hover:bg-red-500 font-bold">ACK</button>
        </div>
      )}
      {pendingActive !== undefined && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 bg-amber-900/50 border-b border-amber-700 text-amber-100">
          <span className="flex-1 font-medium">
            {pendingActive === null
              ? 'Control has cleared the active timetable.'
              : `Control has switched to ${pendingName ?? 'another timetable'}.`}
          </span>
          <button onClick={ackActive} className="min-h-[48px] px-5 rounded-lg bg-amber-600 hover:bg-amber-500 font-bold text-slate-950">ACK</button>
        </div>
      )}
      {body}
      <ChangeToasts toasts={toasts.toasts} onDismiss={toasts.dismiss} max={3} placement="bottom" />
      {historyOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/80 flex items-start justify-center p-4" onClick={() => setHistoryOpen(false)}>
          <div className="w-full max-w-md mt-16 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h2 className="font-semibold">Changes from Control</h2>
              <button onClick={() => setHistoryOpen(false)} className="min-w-[48px] min-h-[48px] text-slate-400 hover:text-white" aria-label="Close">✕</button>
            </div>
            {toasts.history.length === 0 ? (
              <p className="px-4 py-6 text-slate-500 text-sm">No changes yet this session.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {toasts.history.map((t) => (
                  <li key={t.id} className="px-4 py-3 text-sm flex gap-3">
                    <span className="text-slate-500 tabular-nums">{new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>{t.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {!started && (
        <button
          onClick={start}
          className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col items-center justify-center gap-2 text-center"
        >
          <span className="text-3xl font-bold text-blue-400">Tap to start</span>
          <span className="text-sm text-slate-400">Enables sound and keeps the screen awake</span>
        </button>
      )}
    </div>
  );
}
