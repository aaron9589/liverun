import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveTimetable } from '../../hooks/useLiveTimetable';
import { useFastClock } from '../../hooks/useFastClock';
import { requestWakeLock, unlockAudio } from '../../lib/audio';
import { switchMode } from '../../lib/mode';
import { autoSelectTrain, formsNext as findFormsNext, sequenceStops, sortByRun } from '../../lib/stops';
import { CrewPicker } from './CrewPicker';
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

  // Follow the server's active timetable.
  useEffect(() => {
    if (activeId) setTtId(activeId);
  }, [activeId]);
  useEffect(() => {
    if (live.deleted && activeId && activeId !== ttId) setTtId(activeId);
  }, [live.deleted, activeId, ttId]);

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

  useEffect(() => {
    if (!timetable || trains.length === 0) return;
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
  }, [timetable, trains, selectedId, clockShown]);

  const train = trains.find((t) => t.id === selectedId) ?? null;
  const select = useCallback((id: string, push: boolean) => {
    if (!timetable) return;
    isAuto.current = false;
    writeStore(trainKey(timetable.id), id);
    setBackStack((s) => (push && selectedId ? [...s, selectedId] : []));
    setSelectedId(id);
  }, [timetable, selectedId]);

  const goBack = () => {
    const prev = backStack[backStack.length - 1];
    if (!prev || !timetable) return;
    writeStore(trainKey(timetable.id), prev);
    setBackStack((s) => s.slice(0, -1));
    setSelectedId(prev);
  };

  // Pinned stop ("at platform"), reset per train
  const [pinnedStopId, setPinnedStopId] = useState<string | null>(null);
  useEffect(() => { setPinnedStopId(null); }, [selectedId]);

  const seq = useMemo(() => (train ? sequenceStops(train) : []), [train]);
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
        </section>
        <section>
          <StopTable
            seq={seq}
            stations={timetable.stations}
            clock={clockShown}
            pinnedStopId={pinnedStopId}
            onTogglePin={(id) => setPinnedStopId((p) => (p === id ? null : id))}
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
      {body}
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
