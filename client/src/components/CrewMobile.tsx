import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Crew, Timetable, TimetableSummary, Train } from '../types';
import { api } from '../api';
import { useFastClock } from '../hooks/useFastClock';
import { useLiveTimetable } from '../hooks/useLiveTimetable';
import { describeJobChange, diffJobs } from '../lib/jobDiff';
import { switchMode } from '../lib/mode';
import { helpUrl } from '../lib/help';
import { timeToMinutes, useLocalStorage } from '../utils';
import { ChangeToasts, useToasts } from './ChangeToasts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexLuminance(hex: string): number {
  let c = hex.replace('#', '').trim();
  // Expand 3-digit (#fff) and 4-digit (#ffff) shorthand to 6 digits.
  if (c.length === 3 || c.length === 4) c = c.split('').map((ch) => ch + ch).join('');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0; // unknown → assume dark, use light text
  const toLinear = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function crewBadgeStyle(color: string, done: boolean): React.CSSProperties {
  if (done) return { background: '#1e293b', color: '#475569', border: '1px solid #334155' };
  const lum = hexLuminance(color);
  return {
    background: color,
    color: lum > 0.35 ? '#0f172a' : '#f8fafc',
    border: `1px solid ${color}`,
    fontWeight: 600,
  };
}

function trainFirstMinute(t: Train): number {
  return t.stops.reduce((min, s) => {
    const tm = s.departure ?? s.arrival;
    return tm ? Math.min(min, timeToMinutes(tm)) : min;
  }, Infinity);
}

function trainLastMinute(t: Train): number {
  return t.stops.reduce((max, s) => {
    const tm = s.arrival ?? s.departure;
    return tm ? Math.max(max, timeToMinutes(tm)) : max;
  }, -Infinity);
}

function formatMins(mins: number): string {
  if (!isFinite(mins)) return '—';
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Change highlights ────────────────────────────────────────────────────────

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

/** Toast text + tone for one job change. */
// ─── Train card ────────────────────────────────────────────────────────────────

function trainEndpoints(train: Train, stationMap: Map<string, { name: string }>): { from: string | null; to: string | null } {
  type Entry = { stationId: string; mins: number };
  const entries: Entry[] = [];
  for (const stop of train.stops) {
    const dep = stop.departure ?? stop.arrival;
    const arr = stop.arrival ?? stop.departure;
    if (dep) entries.push({ stationId: stop.station_id, mins: timeToMinutes(dep) });
    else if (arr) entries.push({ stationId: stop.station_id, mins: timeToMinutes(arr) });
  }
  if (entries.length === 0) return { from: null, to: null };
  entries.sort((a, b) => a.mins - b.mins);
  const fromStop = entries[0];
  const toStop   = entries[entries.length - 1];
  const fromName = stationMap.get(fromStop.stationId)?.name ?? null;
  const toName   = stationMap.get(toStop.stationId)?.name ?? null;
  return { from: fromName, to: fromName === toName ? null : toName };
}

function TrainCard({
  train,
  crew,
  stationMap,
  isNew,
  isRetimed,
  onToggle,
}: {
  train: Train;
  crew?: Crew;
  stationMap: Map<string, { name: string }>;
  /** Just added to my jobs by Control. */
  isNew: boolean;
  /** Times just changed by Control. */
  isRetimed: boolean;
  onToggle: () => void;
}) {
  const first = trainFirstMinute(train);
  const last = trainLastMinute(train);
  const status = train.status;
  const isRunning = status === 'running';
  const isDone = status === 'completed';
  const dotColor = isDone ? '#475569' : (crew?.color ?? train.color);
  const { from, to } = trainEndpoints(train, stationMap);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all ${
        isDone
          ? 'bg-slate-900/40 border-slate-800/50 opacity-60'
          : isRunning
          ? 'bg-slate-800/80 border-slate-600/80 shadow-lg'
          : 'bg-slate-800/60 border-slate-700/50'
      }${isNew ? ' ring-2 ring-green-400/80' : ''}`}
      style={isRunning ? { boxShadow: `0 0 12px 2px ${(crew?.color ?? train.color)}33` } : undefined}
    >
      {/* Crew / train colour dot */}
      <span
        className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/20 mt-1"
        style={{ background: dotColor }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium text-sm ${isDone ? 'line-through text-slate-500' : isRunning ? 'text-white' : 'text-slate-100'}`}>
            {train.name}
          </span>
          {isNew && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500 text-slate-950 shrink-0">
              New
            </span>
          )}
          {train.request_id && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 shrink-0">Requested</span>
          )}
          {crew && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full shrink-0"
              style={crewBadgeStyle(crew.color, isDone)}
            >
              {crew.name}
            </span>
          )}
        </div>
        {/* Origin → destination */}
        {(from || to) && (
          <div className={`mt-0.5 text-xs leading-snug ${isDone ? 'text-slate-600' : 'text-slate-400'}`}>
            {from}{from && to && <span className="text-slate-600"> → </span>}{to}
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {train.train_id && (
            <span className="text-xs text-slate-500 font-mono tabular-nums">{train.train_id}</span>
          )}
          <span
            className={`text-xs font-mono tabular-nums rounded px-1 -mx-1 transition-colors duration-700 ${
              isRetimed ? 'bg-amber-400/25 text-amber-200' : 'text-slate-500'
            }`}
            title={isRetimed ? 'Times changed by Control' : undefined}
          >
            {formatMins(first)}–{formatMins(last)}
          </span>
        </div>
        {train.notes && (
          <p className={`text-xs mt-1 leading-snug ${isDone ? 'text-slate-600' : 'text-slate-400'}`}>
            {train.notes}
          </p>
        )}
      </div>

      {/* Status cycle button */}
      <button
        onClick={onToggle}
        className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl shrink-0 border transition-all active:scale-95 gap-0.5 ${
          isRunning
            ? 'bg-green-600/20 border-green-500/60 text-green-400'
            : isDone
            ? 'bg-slate-700/40 border-slate-600/50 text-slate-500'
            : 'bg-slate-700/50 border-slate-600 text-slate-500 hover:border-green-500/60 hover:text-green-400'
        }`}
        title={isRunning ? 'Mark completed' : isDone ? 'Clear status' : 'Mark running'}
        aria-label={isRunning ? 'Mark completed' : isDone ? 'Clear status' : 'Mark running'}
      >
        {isRunning ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Done</span>
          </>
        ) : isDone ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.85" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Reset</span>
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Run</span>
          </>
        )}
      </button>
    </div>
  );
}

// ─── Timeline list ────────────────────────────────────────────────────────────

function TimelineList({
  trains,
  crewMap,
  stationMap,
  currentMinute,
  newIds,
  retimedIds,
  onToggle,
}: {
  trains: Train[];
  crewMap: Map<string, Crew>;
  stationMap: Map<string, { name: string }>;
  currentMinute: number | null;
  newIds: ReadonlySet<string>;
  retimedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  // Compute each train's first minute once (used for dot classification + now-line interpolation)
  const trainMeta = trains.map((t) => ({
    id: t.id,
    first: trainFirstMinute(t),
    last: trainLastMinute(t),
  }));

  // Measure card midpoints relative to the bar after each render.
  // We store positions in a ref (not state) so reading them never triggers a re-render.
  // A single state toggle forces one extra render after measurement so the dots paint.
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const barRef   = useRef<HTMLDivElement>(null);
  const posRef   = useRef<number[]>([]);
  const [, setTick] = useState(0);

  // Trim stale ref slots whenever the list shrinks
  cardRefs.current.length = trains.length;

  useEffect(() => {
    if (!barRef.current) return;
    const barTop = barRef.current.getBoundingClientRect().top;
    const next = cardRefs.current.map((el) => {
      if (!el) return -1;
      const r = el.getBoundingClientRect();
      return r.top - barTop + r.height / 2;
    });
    const changed = next.some((v, i) => v !== posRef.current[i]);
    posRef.current = next;
    if (changed) setTick((n) => n + 1);
  // Re-measure when the train list changes (adds/removes/reorders cards).
  // currentMinute is intentionally excluded — clock ticks must not re-measure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trains]);

  const dotPositions = posRef.current;

  // Interpolate the now-line pixel position from measured dot positions + train times.
  // Build a list of (time, px) anchor points from dots that have valid measurements,
  // then linearly interpolate currentMinute against that scale.
  const nowLinePx = (() => {
    if (currentMinute === null || dotPositions.length === 0) return null;
    const anchors = trainMeta
      .map((m, i) => ({ mins: m.first, px: dotPositions[i] ?? -1 }))
      .filter((a) => isFinite(a.mins) && a.px >= 0)
      .sort((a, b) => a.mins - b.mins);
    if (anchors.length === 0) return null;
    if (currentMinute <= anchors[0].mins) return anchors[0].px;
    if (currentMinute >= anchors[anchors.length - 1].mins) return anchors[anchors.length - 1].px;
    const after  = anchors.find((a) => a.mins >= currentMinute);
    const before = [...anchors].reverse().find((a) => a.mins <= currentMinute);
    if (!after || !before) return null;
    if (before.mins === after.mins) return before.px;
    const t = (currentMinute - before.mins) / (after.mins - before.mins);
    return before.px + t * (after.px - before.px);
  })();

  return (
    <div className="flex gap-3">
      {/* ── Timeline bar ── */}
      <div ref={barRef} className="relative w-4 shrink-0 self-stretch">
        <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-slate-800 rounded-full" />

        {nowLinePx !== null && (
          <div
            className="absolute left-0 right-0 h-0.5 bg-green-400/80 z-10"
            style={{ top: nowLinePx }}
          />
        )}

        {dotPositions.map((y, i) => {
          if (y < 0 || i >= trains.length) return null;
          const train = trains[i];
          const meta  = trainMeta[i];
          const crew  = train.crew_id ? crewMap.get(train.crew_id) : undefined;
          const color = train.status === 'completed' ? '#475569' : (crew?.color ?? train.color);
          const isPast = currentMinute !== null && isFinite(meta.last)  && meta.last  < currentMinute;
          const isCurr = currentMinute !== null && isFinite(meta.first) && isFinite(meta.last)
            && meta.first <= currentMinute && meta.last >= currentMinute;
          return (
            <div
              key={train.id}
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                top: y,
                width:  isCurr ? 10 : 6,
                height: isCurr ? 10 : 6,
                background: isPast && !isCurr ? '#334155' : color,
                boxShadow: isCurr ? `0 0 6px 2px ${color}88` : undefined,
              }}
            />
          );
        })}
      </div>

      {/* ── Cards ── */}
      <div className="flex-1 min-w-0 space-y-2">
        {trains.map((train, i) => (
          <div key={train.id} ref={(el) => { cardRefs.current[i] = el; }}>
            <TrainCard
              train={train}
              crew={train.crew_id ? crewMap.get(train.crew_id) : undefined}
              stationMap={stationMap}
              isNew={newIds.has(train.id)}
              isRetimed={retimedIds.has(train.id)}
              onToggle={() => onToggle(train.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Live clock ───────────────────────────────────────────────────────────────

function useWallClock(): string {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
    // Align to the next minute boundary then tick every 60 s
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
    const initial = setTimeout(() => { tick(); }, msToNextMinute);
    let interval: ReturnType<typeof setInterval>;
    const startInterval = setTimeout(() => {
      interval = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => { clearTimeout(initial); clearTimeout(startInterval); clearInterval(interval); };
  }, []);
  return time;
}

// ─── Main component ───────────────────────────────────────────────────────────

const MENU_ITEM = 'w-full min-h-[48px] px-4 text-left hover:bg-slate-800';

export function CrewMobile() {
  const [timetables, setTimetables] = useState<TimetableSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [crewFilter, setCrewFilter] = useLocalStorage<string[]>('mob:crewFilter', []);
  const [crewFilterOpen, setCrewFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wallClock = useWallClock();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [newIds, flagNew] = useTimedFlags(60_000);
  const [retimedIds, flagRetimed] = useTimedFlags(10_000);

  // Which timetable to show: an explicit choice (URL ?id= or the picker), else
  // follow Control's active timetable live (first timetable if none is active).
  const urlId = new URLSearchParams(window.location.search).get('id') ?? null;
  const [explicitId, setExplicitId] = useState<string | null>(urlId);
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  const following = explicitId === null;
  const { timetable, error, status, activeId, deleted, replace } = useLiveTimetable(selectedId);

  const clockSettings = timetable?.settings;
  const { clockTime } = useFastClock(
    clockSettings?.clock_broker_url ?? '',
    clockSettings?.clock_topic ?? '',
    !!(clockSettings?.clock_enabled && clockSettings?.clock_broker_url),
  );

  const displayClock = clockTime !== null
    ? `${String(Math.floor(clockTime / 60) % 24).padStart(2, '0')}:${String(clockTime % 60).padStart(2, '0')}`
    : wallClock;

  // Reset filters when switching timetables (stored crew IDs / types won't match).
  // We compare inside the effect body (not a ref) so we only reset when the effect
  // fires for a *new* selectedId — the cleanup of the previous effect runs before
  // this effect fires, so there is no race with the new timetable's data.
  const prevSelectedId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedId.current;
    prevSelectedId.current = selectedId;
    if (prev !== null && prev !== selectedId) {
      setCrewFilter([]);
    }
  }, [selectedId]);

  // Timetable list: on load, and again whenever Control switches or deletes one
  useEffect(() => {
    api.listTimetables()
      .then((list) => { setTimetables(list); setListError(null); })
      .catch(() => setListError('Could not load timetables'))
      .finally(() => setListLoaded(true));
  }, [activeId, deleted]);

  useEffect(() => {
    if (explicitId) { setSelectedId(explicitId); return; }
    if (activeId === undefined) return; // not known yet
    setSelectedId(activeId ?? timetables[0]?.id ?? null);
  }, [explicitId, activeId, timetables]);

  // Control switched the active timetable while we follow it: announce once it has loaded
  const prevActiveId = useRef<string | null | undefined>(undefined);
  const announceSwitch = useRef(false);
  useEffect(() => {
    const prev = prevActiveId.current;
    prevActiveId.current = activeId;
    if (prev !== undefined && activeId && activeId !== prev && following) announceSwitch.current = true;
  }, [activeId, following]);

  // The shown timetable was deleted: say so and fall back to following the active one
  useEffect(() => {
    if (!deleted) return;
    setNotice(`"${timetable?.name ?? 'The selected timetable'}" was deleted by Control.`);
    setExplicitId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted]);

  // Diff each new version against the last one and tell the crew what Control changed
  const prevTimetable = useRef<Timetable | null>(null);
  useEffect(() => {
    const prev = prevTimetable.current;
    prevTimetable.current = timetable;
    if (!timetable || prev === timetable) return;
    if (!prev || prev.id !== timetable.id) {
      // Initial load or a different timetable: no per-job toasts
      if (announceSwitch.current && timetable.id === activeId) pushToast(`Control switched to ${timetable.name}`, 'warning');
      announceSwitch.current = false;
      return;
    }
    // "My jobs" = the crews the filter showed before this change ('' = unassigned trains); no filter = all trains
    const prevCrewIds = new Set(prev.crews.map((c) => c.id));
    const filter = crewFilter.filter((f) => f === '' || prevCrewIds.has(f));
    const nextCrewIds = new Set(timetable.crews.map((c) => c.id));
    const goneCrews = prev.crews.filter((c) => filter.includes(c.id) && !nextCrewIds.has(c.id));
    if (goneCrews.length > 0) {
      // Its trains are now unassigned and the filter widens; one notice beats a toast per train
      pushToast(`Crew ${goneCrews.map((c) => c.name).join(', ')} removed by Control`, 'warning');
      return;
    }
    const changes = diffJobs(prev, timetable, filter.length > 0 ? filter : null);
    if (changes.length > 5) {
      pushToast(`Control changed ${changes.length} of your jobs`, 'warning');
    } else {
      for (const change of changes) {
        const { message, tone } = describeJobChange(change);
        pushToast(message, tone);
      }
    }
    flagNew(changes.filter((c) => c.type === 'added').map((c) => c.train.id));
    flagRetimed(changes.filter((c) => c.type === 'retimed').map((c) => c.train.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable]);

  async function cycleStatus(trainId: string) {
    if (!selectedId || !timetable) return;
    const train = timetable.trains.find((t) => t.id === trainId);
    if (!train) return;
    const next = train.status === 'running' ? 'completed' : train.status === 'completed' ? null : 'running';
    try {
      const updated = await api.setTrainStatus(selectedId, trainId, next);
      replace(updated);
    } catch { /* ignore */ }
  }

  async function resetAll() {
    if (!selectedId) return;
    try {
      const updated = await api.resetAllCompleted(selectedId);
      replace(updated);
    } catch { /* ignore */ }
  }

  const crewMap = new Map((timetable?.crews ?? []).map((c) => [c.id, c]));
  const stationMap = new Map((timetable?.stations ?? []).map((s) => [s.id, { name: s.name }]));

  // Drop any stored filter values that don't exist in the current timetable
  // (avoids blank screen when stale localStorage values don't match loaded data)
  const validCrewIds = new Set((timetable?.crews ?? []).map((c) => c.id));
  const validCrewFilter = crewFilter.filter((f) => f === '' || validCrewIds.has(f));

  // Filtered + sorted trains
  const visibleTrains = (timetable?.trains ?? []).filter((t) => {
    if (validCrewFilter.length > 0 && !validCrewFilter.includes(t.crew_id ?? '')) return false;
    return true;
  });

  const sortedTrains = [...visibleTrains].sort((a, b) => {
    const fa = trainFirstMinute(a);
    const fb = trainFirstMinute(b);
    if (!isFinite(fa) && !isFinite(fb)) return 0;
    if (!isFinite(fa)) return 1;   // no-time trains sort last
    if (!isFinite(fb)) return -1;
    return fa - fb;
  });

  const completedCount = visibleTrains.filter((t) => t.status === 'completed').length;
  const runningCount = visibleTrains.filter((t) => t.status === 'running').length;

  const waiting = selectedId ? !timetable && !error : !listLoaded;
  if (waiting) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  const loadError = timetable ? null : (selectedId && error ? 'Could not load timetable' : listError);
  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
        <div className="text-red-400 text-sm text-center">{loadError}</div>
      </div>
    );
  }

  if (!timetable && timetables.length > 0) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 pt-safe-top pb-safe-bottom">
        <div className="max-w-lg mx-auto pt-8">
          <h1 className="text-lg font-semibold text-white mb-4">Select Timetable</h1>
          <div className="space-y-2">
            {timetables.map((tt) => (
              <button
                key={tt.id}
                onClick={() => setExplicitId(tt.id)}
                className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                <div className="font-medium">{tt.name}</div>
                {tt.description && <div className="text-xs text-slate-500 mt-0.5">{tt.description}</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <ChangeToasts toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-lg mx-auto space-y-2">
          {/* ── Row 1: branding, clock, ☰ menu ── */}
          <div className="flex items-center justify-between gap-2">
            <a
              href={`${window.location.pathname.replace(/\/mobile\/?$/, '').replace(/\/+$/, '') || ''}/?desktop=1`}
              className="flex items-center gap-2 group min-w-0"
              title="Back to main app"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="#6366f1" viewBox="0 0 16 16" className="shrink-0">
                <path d="M10.621.515C8.647.02 7.353.02 5.38.515c-.924.23-1.982.766-2.78 1.22C1.566 2.322 1 3.432 1 4.582V13.5A2.5 2.5 0 0 0 3.5 16h9a2.5 2.5 0 0 0 2.5-2.5V4.583c0-1.15-.565-2.26-1.6-2.849-.797-.453-1.855-.988-2.779-1.22ZM6.5 2h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1m-2 2h7A1.5 1.5 0 0 1 13 5.5v2A1.5 1.5 0 0 1 11.5 9h-7A1.5 1.5 0 0 1 3 7.5v-2A1.5 1.5 0 0 1 4.5 4m.5 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0m8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3-1a1 1 0 1 1 0 2 1 1 0 0 1 0-2M4 5.5a.5.5 0 0 1 .5-.5h3v3h-3a.5.5 0 0 1-.5-.5zM8.5 8V5h3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5z"/>
              </svg>
              <span className="text-base font-semibold text-white whitespace-nowrap group-hover:text-slate-300 transition-colors">Crewing Manager</span>
            </a>
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span
                className="text-xl font-mono font-bold tabular-nums"
                style={{ color: clockTime !== null ? '#4ade80' : '#94a3b8' }}
                title={clockTime !== null ? 'Fast clock' : 'Wall clock'}
              >{displayClock}</span>
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
                      <button className={MENU_ITEM} onClick={switchMode}>Switch mode</button>
                      <a className={`${MENU_ITEM} flex items-center`} href={helpUrl('crew-view.md')} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Help</a>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Row 2: timetable name / selector ── */}
          <div className="flex items-center gap-2">
            {timetables.length > 1 ? (
              <select
                value={selectedId ?? ''}
                onChange={(e) => setExplicitId(e.target.value || null)}
                className="flex-1 min-w-0 text-sm bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                {timetables.map((tt) => (
                  <option key={tt.id} value={tt.id}>{tt.name}</option>
                ))}
              </select>
            ) : (
              <span className="flex-1 min-w-0 text-sm text-slate-400 truncate">{timetable?.name ?? '—'}</span>
            )}
            {/* Live link to Control: changes arrive without a refresh while green */}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${status === 'live' ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}
              title={status === 'live' ? 'Live — changes from Control appear automatically' : 'Reconnecting to Control…'}
            />
          </div>

          {notice && (
            <div className="flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/40 text-amber-200 rounded-lg px-3 py-2">
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} className="text-amber-300 hover:text-white" aria-label="Dismiss">✕</button>
            </div>
          )}

          {/* ── Row 3: filters + progress ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Crew filter */}
            {(timetable?.crews ?? []).length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setCrewFilterOpen((v) => !v); }}
                  className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    validCrewFilter.length > 0
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Crew {validCrewFilter.length > 0 ? `(${validCrewFilter.length})` : ''}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${crewFilterOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {crewFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setCrewFilterOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 min-w-[160px]">
                      {(timetable?.crews ?? []).map((crew) => (
                        <label key={crew.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-700 transition-colors">
                          <input
                            type="checkbox"
                            checked={validCrewFilter.includes(crew.id)}
                            onChange={(e) =>
                              setCrewFilter((prev) =>
                                e.target.checked ? [...prev, crew.id] : prev.filter((id) => id !== crew.id)
                              )
                            }
                            className="accent-blue-500 w-4 h-4"
                          />
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: crew.color }} />
                          <span className="text-sm text-slate-200">{crew.name}</span>
                        </label>
                      ))}
                      {validCrewFilter.length > 0 && (
                        <button
                          onClick={() => { setCrewFilter([]); setCrewFilterOpen(false); }}
                          className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:text-slate-300 border-t border-slate-700 transition-colors"
                        >
                          Clear filter
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex-1" />

            {/* Progress + reset */}
            <span className="text-xs text-slate-500 tabular-nums">
              {runningCount > 0 && <span className="text-green-500 mr-1">▶{runningCount}</span>}
              {completedCount}/{visibleTrains.length}
            </span>
            {(completedCount > 0 || runningCount > 0) && timetable && (
              <button
                onClick={resetAll}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-800 border border-transparent hover:border-slate-700"
                title="Reset all statuses"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Train list ── */}
      <main className="max-w-lg mx-auto px-4 py-4 pb-safe-bottom">
        {visibleTrains.length === 0 && (
          <p className="text-center text-slate-600 text-sm py-12">No trains match the current filter</p>
        )}

        {sortedTrains.length > 0 && (
          <TimelineList
            trains={sortedTrains}
            crewMap={crewMap}
            stationMap={stationMap}
            currentMinute={clockTime ?? null}
            newIds={newIds}
            retimedIds={retimedIds}
            onToggle={cycleStatus}
          />
        )}
      </main>
    </div>
  );
}
