import { useEffect, useRef, useState } from 'react';
import {
  alightingCount, createBoardingRun, demandAt, sampleCount,
  type BoardingPhase, type BoardingRun,
} from '../../lib/boarding';
import type { BoardingContext } from '../../lib/boardingContext';
import type { StatsRecord } from '../../lib/stats';
import type { BoardingConfig } from '../../types';

export type BoardingEvent =
  | { n: number; type: 'start'; ctx: BoardingContext | null }
  | { n: number; type: 'close' };

interface Props {
  config: BoardingConfig;
  /** Latest door event; each press carries a new `n` so repeats restart cleanly. */
  event: BoardingEvent | null;
  /** Called with the trigger and the record; the caller decides whether stats are enabled. */
  onStats: (trigger: 'boarding_start' | 'door_close', record: StatsRecord) => void;
  /** Set when stats are enabled but the broker connection is not up. */
  statsDown: boolean;
  /** The boarding count reached zero by itself (not when doors were closed early). */
  onBoardingDone?: () => void;
}

type View =
  | { k: 'idle' }
  | { k: 'nostop' }
  | { k: 'terminus'; station: string }
  | { k: 'run'; phase: 'alighting' | 'boarding'; total: number; remaining: number; hint: BoardingPhase; runner: boolean; station: string }
  | { k: 'summary'; boarded: number; leftBehind: number; runners: number; station: string };

const fmtClock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Passenger counter (spec §8). Rendered with a key that changes with the train, so unmount clears any run. */
export function BoardingCard({ config, event, onStats, statsDown, onBoardingDone }: Props) {
  const [view, setView] = useState<View>({ k: 'idle' });
  const cfgRef = useRef(config);
  cfgRef.current = config;
  const statsRef = useRef(onStats);
  statsRef.current = onStats;
  const doneRef = useRef(onBoardingDone);
  doneRef.current = onBoardingDone;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);
  /** The boarding run in progress (kept after it empties so Close can read the result). */
  const boardingRun = useRef<{ run: BoardingRun; ctx: BoardingContext; startedAt: number } | null>(null);

  const clearTimers = () => {
    gen.current++;
    if (timer.current) clearTimeout(timer.current);
    if (runnerTimer.current) clearTimeout(runnerTimer.current);
    timer.current = null;
    runnerTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  /** Drive a run to completion with setTimeout, updating the view each step. */
  const drive = (
    run: BoardingRun, phase: 'alighting' | 'boarding', total: number, ctx: BoardingContext, onDone: () => void,
  ) => {
    const g = gen.current;
    let tot = total;
    const apply = (remaining: number, hint: BoardingPhase, runner: boolean) =>
      setView({ k: 'run', phase, total: tot, remaining, hint, runner, station: ctx.stationName });
    const step = () => {
      if (g !== gen.current) return;
      const s = run.next();
      if (s.runnersArrived > 0) {
        tot += s.runnersArrived;
        if (runnerTimer.current) clearTimeout(runnerTimer.current);
        runnerTimer.current = setTimeout(() => apply(s.remaining, s.phase, false), 2500);
      }
      apply(s.remaining, s.phase, s.runnersArrived > 0);
      if (s.delayMs === null) onDone();
      else timer.current = setTimeout(step, s.delayMs);
    };
    apply(total, 'flow', false);
    if (total === 0) step();
    else timer.current = setTimeout(step, Math.max(1, cfgRef.current.tick_s * 1000));
  };

  const startBoarding = (ctx: BoardingContext) => {
    const cfg = cfgRef.current;
    if (ctx.position === 'terminus') { setView({ k: 'terminus', station: ctx.stationName }); return; }
    const count = sampleCount(cfg, ctx.count, Math.random);
    const demandNow = demandAt(cfg.demand_curve, ctx.clockMinutes);
    const run = createBoardingRun(cfg, count, Math.random, demandNow);
    boardingRun.current = { run, ctx, startedAt: Date.now() };
    statsRef.current('boarding_start', {
      train: ctx.trainName, trainId: ctx.trainId, station: ctx.stationName,
      boarded: count, leftBehind: 0, runners: 0, clock: fmtClock(ctx.clockMinutes),
      dwellSeconds: 0, at: new Date().toISOString(),
    });
    drive(run, 'boarding', count, ctx, () => { doneRef.current?.(); /* stays on screen until Close */ });
  };

  const eventN = event?.n;
  useEffect(() => {
    if (!event) return;
    clearTimers();
    if (event.type === 'start') {
      boardingRun.current = null;
      const ctx = event.ctx;
      if (!ctx) { setView({ k: 'nostop' }); return; }
      const cfg = cfgRef.current;
      if (cfg.show_alighting) {
        const n = alightingCount(cfg, ctx.count, Math.random);
        // Alighting passengers never "run" for the train: no runners in that phase.
        const run = createBoardingRun({ ...cfg, runner_chance: 0 }, n, Math.random, 0);
        drive(run, 'alighting', n, ctx, () => startBoarding(ctx));
      } else {
        startBoarding(ctx);
      }
      return;
    }
    // Doors closed
    const b = boardingRun.current;
    boardingRun.current = null;
    if (!b) { setView({ k: 'idle' }); return; }
    const r = b.run.close();
    setView({ k: 'summary', ...r, station: b.ctx.stationName });
    statsRef.current('door_close', {
      train: b.ctx.trainName, trainId: b.ctx.trainId, station: b.ctx.stationName,
      boarded: r.boarded, leftBehind: r.leftBehind, runners: r.runners,
      clock: fmtClock(b.ctx.clockMinutes),
      dwellSeconds: Math.round((Date.now() - b.startedAt) / 1000), at: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventN]);

  let body;
  switch (view.k) {
    case 'idle':
      body = <p className="text-slate-500 text-sm">Counts passengers once the doors are open.</p>;
      break;
    case 'nostop':
      body = <p className="text-amber-400 text-sm">Current stop unknown (no clock) — tap a stop in the list to set it.</p>;
      break;
    case 'terminus':
      body = (
        <div>
          <div className="text-2xl font-bold text-slate-200">Terminates — all alight</div>
          <div className="text-sm text-slate-500">{view.station}</div>
        </div>
      );
      break;
    case 'run': {
      const pct = view.total > 0 ? Math.round(((view.total - view.remaining) / view.total) * 100) : 100;
      const alighting = view.phase === 'alighting';
      body = (
        <div>
          <div className="flex items-baseline gap-3">
            <span data-testid="boarding-remaining" className="text-6xl font-bold tabular-nums">{view.remaining}</span>
            <span className="text-sm text-slate-400">{alighting ? 'alighting' : 'to board'} · {view.station}</span>
            {view.runner && <span data-testid="runner" className="ml-auto px-2 py-1 rounded bg-amber-500 text-slate-950 font-bold animate-pulse">RUNNER</span>}
          </div>
          <div className="mt-2 h-3 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full transition-all duration-500 ${alighting ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-500 h-4">
            {view.hint === 'stragglers' ? 'Stragglers…'
              : view.hint === 'waiting-runners' ? 'Someone is running for it…'
              : view.hint === 'done' ? (alighting ? 'All off' : 'All aboard') : ''}
          </div>
        </div>
      );
      break;
    }
    case 'summary':
      body = (
        <div data-testid="boarding-summary">
          <div className="text-2xl font-bold">
            Boarded {view.boarded}
            {view.leftBehind > 0 && <span className="text-amber-400"> · {view.leftBehind} left behind</span>}
          </div>
          <div className="text-sm text-slate-500">
            {view.station}{view.runners > 0 ? ` · ${view.runners} runner${view.runners === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 min-h-[112px]">
      <div className="flex items-center gap-2 mb-1 text-xs uppercase tracking-wide text-slate-500">
        <span>{view.k === 'run' && view.phase === 'alighting' ? 'Alighting' : 'Boarding'}</span>
        {statsDown && <span className="w-2 h-2 rounded-full bg-red-500" title="Stats broker not connected — messages are queued" />}
      </div>
      {body}
    </div>
  );
}
