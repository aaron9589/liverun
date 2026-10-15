import { useCallback, useEffect, useRef, useState } from 'react';
import type { Timetable, Train, TrainStop } from '../types';
import { timeToMinutes, minutesToTime, stationNameStyle } from '../utils';
import { changeDwell, dwellOf, sameTimes, shiftStops, type TimeKind } from '../lib/trainDrag';

// ─── Layout constants ─────────────────────────────────────────────────────────
const PAD = { top: 24, right: 24, bottom: 48, left: 140 };
const MINOR_TICK = 30; // minutes
const MAJOR_TICK = 60; // minutes
// Minimum pixels between adjacent station lines. The graph only grows taller
// than the container (and scrolls) when the tightest gap would otherwise render
// below this threshold — so simple/sparse timetables always fill the viewport.
// Labels are always shown regardless of proximity (server ensures ≥1.0 unit gaps).
const MIN_STATION_GAP_PX = 18;
// Maximum vertical zoom expressed as a multiple of the fit-to-window scale
const MAX_V_ZOOM_FACTOR = 20;

// Colour palette for branch groups (cycles if more than 8 branches)
const BRANCH_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split a station label into at most two lines at a word boundary. */
function wrapLabel(text: string, maxChars = 14): [string, string | null] {
  if (text.length <= maxChars) return [text, null];
  // Prefer a split at a space near the centre of the string
  const mid = Math.floor(text.length / 2);
  let splitAt = text.lastIndexOf(' ', mid + 3);
  if (splitAt < 1) splitAt = text.indexOf(' ');
  if (splitAt < 1) return [text.slice(0, maxChars), text.slice(maxChars)];
  return [text.slice(0, splitAt), text.slice(splitAt + 1)];
}

interface PlotPoint {
  x: number;
  y: number;
  minutes: number;
  stationName: string;
  /** The stop and which of its times this point is (graph editing handles). */
  stopId: string;
  kind: TimeKind;
  /** Pass-through / zero-dwell stop: one point stands for both arrival and departure. */
  pass: boolean;
}

function buildTrainPoints(
  train: Train,
  stationMap: Map<string, { graph_pos: number; name: string }>,
  viewStart: number,
  viewEnd: number,
  posToY: (pos: number) => number,
  gw: number,
): PlotPoint[] {
  type StopEntry = { stop: TrainStop; timeMin: number; isArrival: boolean; graphPos: number; stationName: string; pass: boolean };
  const entries: StopEntry[] = [];

  for (const stop of train.stops) {
    const st = stationMap.get(stop.station_id);
    if (!st) continue;
    const pass = !!stop.arrival && stop.departure === stop.arrival;
    if (stop.arrival)
      entries.push({ stop, timeMin: timeToMinutes(stop.arrival), isArrival: true, graphPos: st.graph_pos, stationName: stop.location_alias || st.name, pass });
    if (stop.departure && stop.departure !== stop.arrival)
      entries.push({ stop, timeMin: timeToMinutes(stop.departure), isArrival: false, graphPos: st.graph_pos, stationName: stop.location_alias || st.name, pass: false });
  }

  entries.sort((a, b) => a.timeMin !== b.timeMin ? a.timeMin - b.timeMin : (a.isArrival ? -1 : 1));

  const range = viewEnd - viewStart;
  // Include all points (SVG clipPath handles boundary clipping)
  return entries.map((e) => ({
    x: PAD.left + ((e.timeMin - viewStart) / range) * gw,
    y: posToY(e.graphPos),
    minutes: e.timeMin,
    stationName: e.stationName,
    stopId: e.stop.id,
    kind: e.isArrival ? 'arr' : 'dep',
    pass: e.pass,
  }));
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipData {
  train: Train;
  firstStation: string;
  lastStation: string;
  firstTime: string;
  lastTime: string;
  screenX: number;
  screenY: number;
  crewName?: string;
  hasSpecialInstructions: boolean;
  trainId?: string;
  direction?: string;
  nextService?: { name: string; time: string };
}

function findNextService(train: Train, allTrains: Train[]): { name: string; time: string } | undefined {
  if (!train.train_id) return undefined;
  const lastMin = train.stops.reduce((max, s) => {
    const t = s.arrival ?? s.departure;
    return t ? Math.max(max, timeToMinutes(t)) : max;
  }, -Infinity);
  if (!isFinite(lastMin)) return undefined;
  let best: { name: string; time: string } | undefined;
  let bestMin = Infinity;
  for (const other of allTrains) {
    if (other.id === train.id || other.train_id !== train.train_id) continue;
    const firstMin = other.stops.reduce((min, s) => {
      const t = s.departure ?? s.arrival;
      return t ? Math.min(min, timeToMinutes(t)) : min;
    }, Infinity);
    if (firstMin > lastMin && firstMin < bestMin) {
      bestMin = firstMin;
      best = { name: other.name, time: minutesToTime(firstMin) };
    }
  }
  return best;
}

function GraphTooltip({ data }: { data: TooltipData }) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-sm shadow-2xl px-4 py-3 text-sm min-w-[180px]"
      style={{
        left: data.screenX > window.innerWidth - 220 ? undefined : data.screenX + 14,
        right: data.screenX > window.innerWidth - 220 ? window.innerWidth - data.screenX + 14 : undefined,
        top: data.screenY - 20,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: data.train.color }}
        />
        <span className="font-semibold text-white">{data.train.name}</span>
      </div>
      <div className="text-slate-400 space-y-0.5">
        <div className="flex gap-2">
          <span className="text-slate-500 w-5">↑</span>
          <span>{data.firstStation}</span>
          <span className="ml-auto text-slate-300 font-mono text-xs">{data.firstTime}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-500 w-5">↓</span>
          <span>{data.lastStation}</span>
          <span className="ml-auto text-slate-300 font-mono text-xs">{data.lastTime}</span>
        </div>
      </div>
      {(data.trainId || data.direction) && (
        <div className="mt-2 pt-2 border-t border-slate-700 space-y-0.5">
          {data.trainId && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 text-xs">Train ID</span>
              <span className="text-slate-300 text-xs font-mono">{data.trainId}</span>
            </div>
          )}
          {data.direction && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 text-xs">Direction</span>
              <span className="text-slate-300 text-xs">{data.direction}</span>
            </div>
          )}
        </div>
      )}
      {data.train.notes && (
        <div className="mt-2 pt-2 border-t border-slate-700 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
          <span className="text-slate-400 text-xs">{data.train.notes}</span>
        </div>
      )}
      {data.hasSpecialInstructions && (
        <div className="mt-2 pt-2 border-t border-slate-700 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <span className="text-slate-400 text-xs">Has special instructions</span>
        </div>
      )}
      {data.crewName && (
        <div className="mt-2 pt-2 border-t border-slate-700 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-slate-400 text-xs">{data.crewName}</span>
        </div>
      )}
      {data.nextService && (
        <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between gap-3">
          <span className="text-slate-500 text-xs">Next working</span>
          <span className="text-slate-300 text-xs text-right">{data.nextService.name} <span className="font-mono">{data.nextService.time}</span></span>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  timetable: Timetable;
  onTrainClick?: (train: Train) => void;
  labelMode?: 'code' | 'name';
  distanceUnit?: 'km' | 'mi';
  viewStart?: number;
  viewEnd?: number;
  clockTime?: number | null;
  onPan?: (newViewStart: number) => void;
  externalHoveredId?: string | null;
  onScaleChange?: (scale: number | null) => void;
  /**
   * Enables graph editing (✎ Edit). Moves are held on the graph until Done,
   * then handed over together (every draft, shown or hidden); resolves false if
   * nothing was saved, and the drafts stay. Cancel discards everything.
   */
  onTrainTimesCommit?: (changes: { trainId: string; stops: TrainStop[] }[]) => Promise<boolean>;
}

/** A drag in progress (edit mode): the whole train, or one stop's dwell. */
interface GraphDrag {
  trainId: string;
  /** null = whole train; else the stop whose dwell is being changed. */
  dwellStopId: string | null;
  startX: number;
  /** The train's stops when the drag began (any earlier draft included). */
  base: TrainStop[];
  /** Preview: the stops with this drag applied, and the minutes moved. */
  stops: TrainStop[];
  delta: number;
  moved: boolean;
}

export function TrainGraph({
  timetable, onTrainClick, labelMode = 'code', distanceUnit = 'km',
  viewStart: viewStartProp, viewEnd: viewEndProp,
  clockTime, onPan, externalHoveredId, onScaleChange, onTrainTimesCommit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startViewStart: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [userScale, setUserScale] = useState<number | null>(timetable.settings.graph_scale ?? null);
  // Graph editing: off on every load, so a stray drag during a live session can't move a train.
  // Moves are drafts (trainId → stops) until Done saves them all; Cancel throws them away.
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, TrainStop[]>>({});
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<GraphDrag | null>(null);
  const dragState = useRef<GraphDrag | null>(null);
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const draftCount = Object.keys(drafts).length;

  // Unsaved moves: warn before the page is closed or reloaded.
  useEffect(() => {
    if (draftCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftCount]);

  async function finishEditing(save: boolean) {
    // Every draft, including trains hidden or filtered out since they were moved.
    const list = save ? Object.entries(drafts).map(([trainId, stops]) => ({ trainId, stops })) : [];
    if (list.length > 0 && onTrainTimesCommit) {
      setSaving(true);
      const ok = await onTrainTimesCommit(list).catch(() => false);
      setSaving(false);
      if (!ok) return; // nothing saved: keep every draft and stay in edit mode
    }
    setDrafts({});
    setEditMode(false);
  }
  // Ref to stable layout values used in external-hover effect (avoids stale closures)
  const layoutRef = useRef({ stationMap: new Map<string, { graph_pos: number; name: string }>(), viewStart: 0, viewEnd: 0, posToY: (_: number) => PAD.top, gw: 0, timetable });
  const needsVScrollRef = useRef(false);
  // Refs for stable values accessible inside non-reactive wheel handler
  const scaleRef = useRef<{ pxPerUnit: number; minPxPerUnit: number; fitPxPerUnit: number }>({ pxPerUnit: 1, minPxPerUnit: 1, fitPxPerUnit: 1 });
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;
  const scaleDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0].contentRect;
      setSize({ w: Math.max(e.width, 200), h: Math.max(e.height, 200) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset stored scale when switching timetables
  useEffect(() => {
    clearTimeout(scaleDebounceRef.current);
    setUserScale(timetable.settings.graph_scale ?? null);
  }, [timetable.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ttStart = timeToMinutes(timetable.start_time);
  const ttEnd = timeToMinutes(timetable.end_time);
  const viewStart = viewStartProp ?? ttStart;
  const viewEnd = viewEndProp ?? ttEnd;
  const viewWidth = viewEnd - viewStart;
  const ttRange = ttEnd - ttStart;
  const isZoomed = viewWidth < ttRange;

  // Non-passive wheel for pan + Ctrl+scroll vertical scale
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const gw = size.w - PAD.left - PAD.right;
    const handler = (e: WheelEvent) => {
      // Ctrl+scroll → adjust vertical scale (only when onScaleChange is wired up)
      if (e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        if (!onScaleChangeRef.current) return;
        e.preventDefault();
        const { pxPerUnit: cur, minPxPerUnit: minPx, fitPxPerUnit: fitPx } = scaleRef.current;
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        const next = Math.min(fitPx * MAX_V_ZOOM_FACTOR, Math.max(minPx, Math.round(cur * factor * 100) / 100));
        setUserScale(next);
        clearTimeout(scaleDebounceRef.current);
        scaleDebounceRef.current = setTimeout(() => onScaleChangeRef.current?.(next), 600);
        return;
      }
      if (!onPan) return;
      // When the graph is taller than the viewport, let the browser handle vertical scroll natively
      if (needsVScrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const panMinutes = delta * (viewWidth / gw);
      onPan(Math.max(ttStart, Math.min(ttEnd - viewWidth, viewStart + panMinutes)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [onPan, viewStart, viewWidth, ttStart, ttEnd, size.w]);

  const scrollbarH = isZoomed ? 20 : 0;
  const gw = size.w - PAD.left - PAD.right;
  const gh_container = size.h - PAD.top - PAD.bottom - scrollbarH;

  const stations = [...timetable.stations].sort((a, b) => (a.graph_pos ?? 0) - (b.graph_pos ?? 0));
  const maxPos = stations.length > 0 ? Math.max(...stations.map((s) => s.graph_pos ?? 0)) : 1;

  // ─── Branch group helpers ────────────────────────────────────────────────────
  // Assign a stable colour to each unique branch_name in order of first appearance
  const branchColorMap = new Map<string, string>();
  let _branchColorIdx = 0;
  for (const s of stations) {
    if (s.branch_name && !branchColorMap.has(s.branch_name)) {
      branchColorMap.set(s.branch_name, BRANCH_COLORS[_branchColorIdx++ % BRANCH_COLORS.length]);
    }
  }
  // Flat station map used by train-line renderer
  const stationMap = new Map(stations.map((s) => [s.id, { graph_pos: s.graph_pos ?? 0, name: s.name }]));

  // Exclude cross-branch-boundary gaps (e.g. main→branch junction) from the
  // minimum-gap calculation — those are intentionally close.
  const stationGaps = stations.length > 1
    ? stations.slice(1).map((s, i) => {
        const prev = stations[i];
        if ((prev.branch_name ?? null) !== (s.branch_name ?? null)) return null;
        return (s.graph_pos ?? 0) - (prev.graph_pos ?? 0);
      }).filter((g): g is number => g !== null && g > 0)
    : [];
  const minGap = stationGaps.length > 0 ? Math.min(...stationGaps) : (maxPos || 1);
  // Floor: never let any same-branch station pair render closer than MIN_STATION_GAP_PX.
  const minPxPerUnit = minGap > 0 ? MIN_STATION_GAP_PX / minGap : 1;
  // Fit scale fills the container exactly (clamped to the station-gap floor).
  const fitPxPerUnit = maxPos > 0 ? Math.max(gh_container / maxPos, minPxPerUnit) : gh_container;
  // User-stored scale wins if set; otherwise auto-fit.
  const pxPerUnit = userScale !== null ? Math.max(userScale, minPxPerUnit) : fitPxPerUnit;
  const gh = pxPerUnit * maxPos;
  const needsVScroll = gh > gh_container + 1;
  // Keep ref current for wheel handler
  scaleRef.current = { pxPerUnit, minPxPerUnit, fitPxPerUnit };
  const svgTotalH = needsVScroll ? Math.ceil(gh + PAD.top + PAD.bottom) : size.h - scrollbarH;
  needsVScrollRef.current = needsVScroll;

  // Keep layoutRef current for use in the external-hover effect
  layoutRef.current = { stationMap, viewStart, viewEnd, posToY: (pos) => PAD.top + (maxPos > 0 ? (pos / maxPos) * gh : 0), gw, timetable };

  // Ticks within view window
  const minorTicks: number[] = [];
  const majorTicks: number[] = [];
  for (let t = Math.ceil(viewStart / MINOR_TICK) * MINOR_TICK; t <= viewEnd; t += MINOR_TICK) minorTicks.push(t);
  for (let t = Math.ceil(viewStart / MAJOR_TICK) * MAJOR_TICK; t <= viewEnd; t += MAJOR_TICK) majorTicks.push(t);

  const timeToX = useCallback(
    (min: number) => PAD.left + ((min - viewStart) / viewWidth) * gw,
    [viewStart, viewWidth, gw]
  );
  const distToY = (pos: number) => PAD.top + (maxPos > 0 ? (pos / maxPos) * gh : 0);

  const handleMouseLeave = () => { setTooltip(null); setHoveredId(null); };

  /**
   * Edit mode: drags a whole train (dwellStopId null) or one stop's dwell
   * left/right in whole minutes. Running times never change, so a line's angle
   * never does. The result becomes a draft (saved on Done); Escape cancels the drag.
   */
  function startDrag(e: React.MouseEvent, train: Train, dwellStopId: string | null) {
    if (!editMode || saving || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pxPerMin = gw / viewWidth;
    const base = drafts[train.id] ?? train.stops;
    const begin: GraphDrag = { trainId: train.id, dwellStopId, startX: e.clientX, base, stops: base, delta: 0, moved: false };
    dragState.current = begin;
    setDrag(begin);
    setTooltip(null);
    setDragAt({ x: e.clientX, y: e.clientY });

    const onMove = (ev: MouseEvent) => {
      const d = dragState.current;
      if (!d) return;
      setDragAt({ x: ev.clientX, y: ev.clientY });
      const dx = ev.clientX - d.startX;
      const moved = d.moved || Math.abs(dx) > 3;
      const want = moved ? Math.round(dx / pxPerMin) : 0;
      const r = want === 0 ? { stops: d.base, delta: 0 }
        : d.dwellStopId ? changeDwell(d.base, d.dwellStopId, want)
        : { stops: shiftStops(d.base, want), delta: want };
      const next = { ...d, moved, stops: r.stops, delta: r.delta };
      dragState.current = next;
      setDrag(next);
    };
    const finish = (keep: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      const d = dragState.current;
      dragState.current = null;
      setDrag(null);
      if (!keep || !d || d.delta === 0) return;
      setDrafts((all) => {
        const next = { ...all };
        // Dragged back to where it started: no longer a change.
        if (sameTimes(d.stops, train.stops)) delete next[train.id];
        else next[train.id] = d.stops;
        return next;
      });
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  }

  const handleVZoomIn = () => {
    const next = Math.min(fitPxPerUnit * MAX_V_ZOOM_FACTOR, Math.round(pxPerUnit * 1.25 * 100) / 100);
    setUserScale(next);
    clearTimeout(scaleDebounceRef.current);
    scaleDebounceRef.current = setTimeout(() => onScaleChangeRef.current?.(next), 600);
  };
  const handleVZoomOut = () => {
    const next = Math.max(minPxPerUnit, Math.round(pxPerUnit * 0.8 * 100) / 100);
    setUserScale(next);
    clearTimeout(scaleDebounceRef.current);
    scaleDebounceRef.current = setTimeout(() => onScaleChangeRef.current?.(next), 600);
  };
  const handleVZoomFit = () => {
    clearTimeout(scaleDebounceRef.current);
    setUserScale(null);
    scaleDebounceRef.current = setTimeout(() => onScaleChangeRef.current?.(null), 600);
  };

  // Highlight from external source (e.g. Sidebar crew panel hover)
  useEffect(() => {
    if (hoveredId || !externalHoveredId) {
      if (!hoveredId) setTooltip(null);
      return;
    }
    const { stationMap, viewStart, viewEnd, posToY, gw, timetable } = layoutRef.current;
    const train = timetable.trains.find((t) => t.id === externalHoveredId);
    if (!train || !svgRef.current) return;
    const points = buildTrainPoints(train, stationMap, viewStart, viewEnd, posToY, gw);
    const inView = points.filter((p) => p.minutes >= viewStart && p.minutes <= viewEnd);
    if (inView.length === 0) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const mid = inView[Math.floor(inView.length / 2)];
    setTooltip({
      train,
      firstStation: inView[0].stationName,
      lastStation: inView[inView.length - 1].stationName,
      firstTime: minutesToTime(inView[0].minutes),
      lastTime: minutesToTime(inView[inView.length - 1].minutes),
      screenX: svgRect.left + mid.x,
      screenY: svgRect.top + mid.y,
      crewName: train.crew_id ? timetable.crews.find((c) => c.id === train.crew_id)?.name : undefined,
      hasSpecialInstructions: train.stops.some((s) => !!s.special_instructions),
      trainId: train.train_id || undefined,
      direction: train.direction || undefined,
      nextService: findNextService(train, timetable.trains),
    });
  }, [externalHoveredId, hoveredId]);

  const effectiveHoveredId = hoveredId ?? externalHoveredId ?? null;

  const handleTrainHover = useCallback(
    (train: Train, points: PlotPoint[], e: React.MouseEvent) => {
      const inView = points.filter((p) => p.minutes >= viewStart && p.minutes <= viewEnd);
      if (inView.length === 0) return;
      setHoveredId(train.id);
      setTooltip({
        train,
        firstStation: inView[0].stationName,
        lastStation: inView[inView.length - 1].stationName,
        firstTime: minutesToTime(inView[0].minutes),
        lastTime: minutesToTime(inView[inView.length - 1].minutes),
        screenX: e.clientX,
        screenY: e.clientY,
        crewName: train.crew_id
          ? (timetable.crews.find((c) => c.id === train.crew_id)?.name)
          : undefined,
        hasSpecialInstructions: train.stops.some((s) => !!s.special_instructions),
        trainId: train.train_id || undefined,
        direction: train.direction || undefined,
        nextService: findNextService(train, timetable.trains),
      });
    },
    [viewStart, viewEnd, timetable]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setTooltip((prev) => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : prev);
    },
    []
  );

  // Scrollbar thumb geometry
  const thumbFrac = ttRange > 0 ? viewWidth / ttRange : 1;
  const thumbOffset = ttRange > viewWidth ? (viewStart - ttStart) / (ttRange - viewWidth) : 0;

  function handleScrollbarMouseDown(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { startX: e.clientX, startViewStart: viewStart };
    function onMove(ev: MouseEvent) {
      if (!dragRef.current || !scrollbarRef.current) return;
      const trackW = scrollbarRef.current.clientWidth;
      const thumbW = trackW * thumbFrac;
      const delta = ev.clientX - dragRef.current.startX;
      const deltaMin = (delta / (trackW - thumbW)) * (ttRange - viewWidth);
      onPan?.(Math.max(ttStart, Math.min(ttEnd - viewWidth, dragRef.current.startViewStart + deltaMin)));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleScrollbarTrackClick(e: React.MouseEvent) {
    if (!scrollbarRef.current) return;
    const rect = scrollbarRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onPan?.(Math.max(ttStart, Math.min(ttEnd - viewWidth, ttStart + frac * (ttRange - viewWidth) - viewWidth / 2)));
  }

  const isEmpty = stations.length === 0;
  const noTrains = timetable.trains.length === 0;
  const clockInView = clockTime != null && clockTime >= viewStart && clockTime <= viewEnd;

  return (
    <div ref={containerRef} className="w-full h-full relative flex flex-col select-none overflow-hidden">
      {/* Vertical scale controls */}
      <div className="absolute z-10 flex items-center gap-0.5 bg-slate-900/80 backdrop-blur-sm rounded border border-slate-700/50 overflow-hidden" style={{ top: PAD.top + 4, right: PAD.right + 4 }}>
        {onTrainTimesCommit && !editMode && (
          <button
            onClick={() => { setEditMode(true); setTooltip(null); }}
            title="Edit the graph: drag a train to move it, drag a stop's ◯ handle to change its dwell (later stops follow). Nothing is saved until Done."
            className="h-5 px-1.5 flex items-center gap-1 text-[11px] font-medium transition-colors border-r border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
          >✎ Edit</button>
        )}
        {onTrainTimesCommit && editMode && (
          <>
            <span className="h-5 px-1.5 flex items-center text-[11px] text-amber-300 border-r border-slate-700/50 whitespace-nowrap">
              {draftCount === 0 ? 'Drag a train or a ◯ dwell' : `${draftCount} train${draftCount === 1 ? '' : 's'} moved — not saved`}
            </span>
            <button
              onClick={() => finishEditing(false)}
              disabled={saving}
              title="Discard every move and stop editing"
              className="h-5 px-1.5 flex items-center text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700/50 border-r border-slate-700/50 disabled:opacity-40"
            >Cancel</button>
            <button
              onClick={() => finishEditing(true)}
              disabled={saving}
              title={draftCount ? 'Save all moved trains (one undo step) and stop editing' : 'Stop editing'}
              className="h-5 px-2 flex items-center text-[11px] font-semibold bg-emerald-500/90 text-slate-950 hover:bg-emerald-400 border-r border-slate-700/50 disabled:opacity-60"
            >{saving ? 'Saving…' : 'Done'}</button>
          </>
        )}
        <button
          onClick={handleVZoomOut}
          disabled={pxPerUnit <= minPxPerUnit + 0.01}
          title="Zoom out (vertical) — Ctrl+scroll"
          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none transition-colors"
        >−</button>
        <button
          onClick={handleVZoomFit}
          title={userScale === null ? 'Fit to window (already active)' : 'Fit to window'}
          className={`w-5 h-5 flex items-center justify-center text-xs transition-colors ${userScale === null ? 'text-slate-600 cursor-default' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
        >⊡</button>
        <button
          onClick={handleVZoomIn}
          title="Zoom in (vertical) — Ctrl+scroll"
          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 text-base leading-none transition-colors"
        >+</button>
      </div>
      <div
        className="flex-1 relative overflow-x-hidden"
        style={{ overflowY: needsVScroll ? 'auto' : 'hidden' }}
      >
        <svg
          ref={svgRef}
          id="train-graph-svg"
          width={size.w}
          height={svgTotalH}
          style={{ display: 'block' }}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <clipPath id="graphClip">
              <rect x={PAD.left} y={PAD.top} width={gw} height={gh} />
            </clipPath>
          </defs>

          {/* Background */}
          <rect x={PAD.left} y={PAD.top} width={gw} height={gh} fill="#0a0f1e" rx="2" />

          {/* Minor grid lines */}
          {minorTicks.map((min) => (
            <line key={`minor-${min}`} x1={timeToX(min)} y1={PAD.top} x2={timeToX(min)} y2={PAD.top + gh} stroke="#1e293b" strokeWidth="1" />
          ))}

          {/* Major grid lines + labels (top + bottom so time is readable when scrolled) */}
          {majorTicks.map((min) => {
            const x = timeToX(min);
            return (
              <g key={`major-${min}`}>
                <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + gh} stroke="#334155" strokeWidth="1" />
                <text x={x} y={PAD.top - 6} textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="monospace">
                  {minutesToTime(min)}
                </text>
                <text x={x} y={PAD.top + gh + 18} textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="monospace">
                  {minutesToTime(min)}
                </text>
              </g>
            );
          })}

          {/* Branch shading bands — full-width tinted rects drawn under station lines */}
          {Array.from(branchColorMap.entries()).map(([bn, color]) => {
            const members = stations.filter((s) => s.branch_name === bn);
            if (members.length === 0) return null;
            const yTop = distToY(Math.min(...members.map((s) => s.graph_pos ?? 0)));
            const yBot = distToY(Math.max(...members.map((s) => s.graph_pos ?? 0)));
            const vPad = 10;
            return (
              <g key={`shade-${bn}`}>
                <rect x={PAD.left} y={yTop - vPad} width={gw} height={yBot - yTop + vPad * 2} fill={color + '1a'} />
                <line x1={PAD.left} y1={yTop - vPad} x2={PAD.left + gw} y2={yTop - vPad} stroke={color} strokeWidth="0.75" strokeOpacity="0.35" />
                <line x1={PAD.left} y1={yBot + vPad} x2={PAD.left + gw} y2={yBot + vPad} stroke={color} strokeWidth="0.75" strokeOpacity="0.35" />
                <text x={PAD.left + 5} y={yTop - vPad + 10} fill={color} fontSize="9" fontFamily="system-ui, sans-serif" fontWeight="600" opacity="0.65">{bn}</text>
              </g>
            );
          })}

          {/* Station lines & labels */}
          {(() => {
            let lastLabelY = -Infinity;
            const firstBranchStationShown = new Set<string>();
            const elements: React.ReactNode[] = [];

            for (const station of stations) {
              const y = distToY(station.graph_pos ?? 0);
              const branchName = station.branch_name ?? null;
              const branchColor = branchName ? (branchColorMap.get(branchName) ?? '#64748b') : null;

              const isFirstBranchStation = branchName !== null && !firstBranchStationShown.has(branchName);
              if (isFirstBranchStation) firstBranchStationShown.add(branchName);

              const kmLabel = station.distance != null ? `${station.distance}${distanceUnit}` : null;
              const rowH = kmLabel ? 20 : 16;
              // Show label only when it physically fits — suppress only when the previous
              // label's bottom would overlap this station line (threshold = 0, not +14).
              // This fixes the original KJN bug (old threshold was rowH+14 = 30px, too tight)
              // while still preventing genuine overlap on dense timetables like LIRR.
              const showLabel = isFirstBranchStation || (y - lastLabelY >= 0);
              if (showLabel) lastLabelY = y + rowH;

              elements.push(
                <g key={station.id}>
                  {branchColor && (
                    <line x1={PAD.left - 3} y1={y - 5} x2={PAD.left - 3} y2={y + 5} stroke={branchColor} strokeWidth="2" strokeLinecap="round" />
                  )}
                  <line
                    x1={PAD.left} y1={y} x2={PAD.left + gw} y2={y}
                    stroke={branchColor ? branchColor + '55' : '#1e293b'} strokeWidth="1"
                    strokeDasharray={(station.graph_pos ?? 0) === 0 ? 'none' : '4 4'}
                  />
                  {showLabel && (() => {
                    const rawLabel = labelMode === 'code' ? (station.short_code || station.name) : station.name;
                    const [line1, line2] = wrapLabel(rawLabel);
                    const nameY1 = line2 ? y - 1  : (kmLabel ? y + 4 : y + 5);
                    const nameY2 = line2 ? y + 11 : null;
                    const distY  = line2 ? y + 23 : y + 16;
                    const lx = PAD.left - 8;
                    const labelFill = branchColor ? '#788494' : '#94a3b8';
                    return (
                      <>
                        <text x={lx} textAnchor="end" fill={labelFill} fontSize="12" fontFamily="system-ui, sans-serif" fontWeight={stationNameStyle(station).bold ? 'bold' : 'normal'} fontStyle={station.italic_name ? 'italic' : 'normal'} textDecoration={station.underline_name ? 'underline' : 'none'}>
                          <tspan x={lx} y={nameY1}>{line1}</tspan>
                          {nameY2 && <tspan x={lx} y={nameY2}>{line2}</tspan>}
                        </text>
                        {kmLabel && (
                          <text x={lx} y={distY} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{kmLabel}</text>
                        )}
                      </>
                    );
                  })()}
                </g>
              );
            }

            return elements;
          })()}

          {/* Graph border */}
          <rect x={PAD.left} y={PAD.top} width={gw} height={gh} fill="none" stroke="#334155" strokeWidth="1" />

          {/* Train paths — clipped */}
          <g clipPath="url(#graphClip)">
            {/* The hovered / dragged train is drawn last, on top, so its line and handles get the mouse first. */}
            {[...timetable.trains].sort((a, b) => {
              const top = drag?.trainId ?? effectiveHoveredId;
              return (a.id === top ? 1 : 0) - (b.id === top ? 1 : 0);
            }).map((train) => {
              const dragging = drag?.trainId === train.id;
              const draft = dragging ? drag!.stops : drafts[train.id];
              const shown = draft ? { ...train, stops: draft } : train;
              const points = buildTrainPoints(shown, stationMap, viewStart, viewEnd, distToY, gw);
              // A moved (unsaved) train keeps a faint dashed ghost of where it was.
              const ghost = draft && !sameTimes(draft, train.stops)
                ? buildTrainPoints(train, stationMap, viewStart, viewEnd, distToY, gw).map((p) => `${p.x},${p.y}`).join(' ')
                : null;
              // Dwell handles: intermediate stops only (they have both times; a pass is one point).
              const dwellStops = new Set(shown.stops.filter((st) => st.arrival && st.departure).map((st) => st.id));
              if (points.length < 2) return null;
              const ptStr = points.map((p) => `${p.x},${p.y}`).join(' ');
              const isHovered = effectiveHoveredId === train.id;
              const isRunning = train.status === 'running';
              const isDone = train.status === 'completed';
              const lineColor = isDone ? '#475569' : train.color;
              const lineOpacity = 1;
              return (
                <g
                  key={train.id}
                  data-train-id={train.id}
                  style={{ cursor: editMode ? (dragging ? 'grabbing' : 'grab') : 'pointer' }}
                  onMouseEnter={(e) => { if (!dragState.current) handleTrainHover(train, points, e); }}
                  onMouseMove={(e) => { if (!dragState.current) handleMouseMove(e); }}
                  onMouseLeave={() => { if (!dragState.current) { setHoveredId(null); setTooltip(null); } }}
                  onMouseDown={(e) => startDrag(e, train, null)}
                  onClick={() => { if (!editMode) onTrainClick?.(train); }}
                >
                  {ghost && <polyline points={ghost} fill="none" stroke={train.color} strokeWidth="1.5" strokeOpacity={0.4} strokeDasharray="4 3" pointerEvents="none" />}
                  <polyline points={ptStr} fill="none" stroke="transparent" strokeWidth="12" />
                  {/* Glow layers for running trains */}
                  {isRunning && <polyline points={ptStr} fill="none" stroke={train.color} strokeWidth="10" strokeOpacity={0.15} strokeLinejoin="round" strokeLinecap="round" />}
                  {isRunning && <polyline points={ptStr} fill="none" stroke={train.color} strokeWidth="5" strokeOpacity={0.35} strokeLinejoin="round" strokeLinecap="round" />}
                  {isHovered && <polyline points={ptStr} fill="none" stroke={lineColor} strokeWidth="6" strokeOpacity={0.25 * lineOpacity} />}
                  <polyline points={ptStr} fill="none" stroke={lineColor} strokeOpacity={lineOpacity} strokeWidth={isHovered || isRunning ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={undefined} />
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={lineColor} opacity={lineOpacity} />
                  ))}
                  {/* Edit mode: a dwell handle on each intermediate stop's departure (a pass is a single point) */}
                  {editMode && (isHovered || dragging) && points
                    .filter((p) => dwellStops.has(p.stopId) && (p.pass || p.kind === 'dep'))
                    .map((p) => (
                      <circle
                        key={`h${p.stopId}`}
                        data-dwell={p.stopId}
                        cx={p.x} cy={p.y} r="5"
                        fill="#0f172a" stroke={lineColor} strokeWidth="2"
                        style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => startDrag(e, train, p.stopId)}
                      >
                        <title>{`${p.stationName}: drag to change the dwell${p.pass ? ' (passes now)' : ''}`}</title>
                      </circle>
                    ))}
                </g>
              );
            })}
          </g>

          {/* Fast clock hairline */}
          {clockInView && (
            <g clipPath="url(#graphClip)">
              <line x1={timeToX(clockTime!)} y1={PAD.top} x2={timeToX(clockTime!)} y2={PAD.top + gh} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
              <circle cx={timeToX(clockTime!)} cy={PAD.top} r="3" fill="#f59e0b" />
              <text x={timeToX(clockTime!) + 5} y={PAD.top + 12} fill="#f59e0b" fontSize="10" fontFamily="monospace">{minutesToTime(clockTime!)}</text>
            </g>
          )}

          {/* Y-axis label */}
          <text x={16} y={PAD.top + gh / 2} textAnchor="middle" fill="#475569" fontSize="11" fontFamily="system-ui, sans-serif" transform={`rotate(-90, 16, ${PAD.top + gh / 2})`}>Stations</text>

          {/* X-axis label */}
          <text x={PAD.left + gw / 2} y={svgTotalH - 4} textAnchor="middle" fill="#475569" fontSize="11" fontFamily="system-ui, sans-serif">Time</text>
        </svg>

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">Add stations to get started</p>
          </div>
        )}
        {!isEmpty && noTrains && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">Add trains to see the graph</p>
          </div>
        )}
      </div>

      {/* Scrollbar */}
      {isZoomed && onPan && (
        <div className="shrink-0 h-5 flex items-center bg-slate-950 px-1">
          <div className="w-[140px] shrink-0" />
          <div
            ref={scrollbarRef}
            className="flex-1 mr-6 h-full relative cursor-pointer py-1"
            onClick={handleScrollbarTrackClick}
          >
            <div className="absolute inset-y-[8px] inset-x-0 bg-slate-800 rounded-full" />
            <div
              className="absolute inset-y-[7px] rounded-full bg-slate-500 hover:bg-slate-400 transition-colors cursor-grab active:cursor-grabbing"
              style={{ left: `${thumbOffset * 100}%`, width: `${thumbFrac * 100}%` }}
              onMouseDown={handleScrollbarMouseDown}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {tooltip && <GraphTooltip data={tooltip} />}
      {drag?.moved && dragAt && (() => {
        const train = timetable.trains.find((t) => t.id === drag.trainId);
        if (!train) return null;
        const sign = drag.delta > 0 ? '+' : '';
        let text = `${train.name} ${sign}${drag.delta} min`;
        if (drag.dwellStopId) {
          const before = drag.base.find((st) => st.id === drag.dwellStopId);
          const after = drag.stops.find((st) => st.id === drag.dwellStopId);
          const name = after ? (after.location_alias || stationMap.get(after.station_id)?.name || '') : '';
          const was = before ? dwellOf(before) : null;
          const now = after ? dwellOf(after) : null;
          text = `${name} dwell ${was ?? '?'} → ${now ?? '?'} min${now === 0 ? ' (pass)' : ''} · later stops ${sign}${drag.delta}`;
        }
        return (
          <div
            className="fixed z-50 pointer-events-none px-2 py-1 rounded bg-slate-800/95 border border-amber-500/60 text-xs text-amber-100 font-mono whitespace-nowrap shadow-lg"
            style={{ left: dragAt.x + 14, top: dragAt.y + 14 }}
          >{text}</div>
        );
      })()}
    </div>
  );
}
