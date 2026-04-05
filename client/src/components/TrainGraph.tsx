import { useCallback, useEffect, useRef, useState } from 'react';
import type { Timetable, Train, TrainStop } from '../types';
import { timeToMinutes, minutesToTime } from '../utils';

// ─── Layout constants ─────────────────────────────────────────────────────────
const PAD = { top: 24, right: 24, bottom: 48, left: 140 };
const MINOR_TICK = 30; // minutes
const MAJOR_TICK = 60; // minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface PlotPoint {
  x: number;
  y: number;
  minutes: number;
  stationName: string;
}

function buildTrainPoints(
  train: Train,
  stationMap: Map<string, { graph_pos: number; name: string }>,
  viewStart: number,
  viewEnd: number,
  maxPos: number,
  gw: number,
  gh: number
): PlotPoint[] {
  type StopEntry = { stop: TrainStop; timeMin: number; isArrival: boolean; graphPos: number; stationName: string };
  const entries: StopEntry[] = [];

  for (const stop of train.stops) {
    const st = stationMap.get(stop.station_id);
    if (!st) continue;
    if (stop.arrival)
      entries.push({ stop, timeMin: timeToMinutes(stop.arrival), isArrival: true, graphPos: st.graph_pos, stationName: st.name });
    if (stop.departure && stop.departure !== stop.arrival)
      entries.push({ stop, timeMin: timeToMinutes(stop.departure), isArrival: false, graphPos: st.graph_pos, stationName: st.name });
    if (stop.departure && !stop.arrival)
      entries.push({ stop, timeMin: timeToMinutes(stop.departure), isArrival: false, graphPos: st.graph_pos, stationName: st.name });
  }

  entries.sort((a, b) => a.timeMin !== b.timeMin ? a.timeMin - b.timeMin : (a.isArrival ? -1 : 1));

  const range = viewEnd - viewStart;
  // Include all points (SVG clipPath handles boundary clipping)
  return entries.map((e) => ({
    x: PAD.left + ((e.timeMin - viewStart) / range) * gw,
    y: PAD.top + (maxPos > 0 ? (e.graphPos / maxPos) * gh : 0),
    minutes: e.timeMin,
    stationName: e.stationName,
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
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  timetable: Timetable;
  onTrainClick?: (train: Train) => void;
  labelMode?: 'code' | 'name';
  viewStart?: number;
  viewEnd?: number;
  clockTime?: number | null;
  onPan?: (newViewStart: number) => void;
  externalHoveredId?: string | null;
}

export function TrainGraph({
  timetable, onTrainClick, labelMode = 'code',
  viewStart: viewStartProp, viewEnd: viewEndProp,
  clockTime, onPan, externalHoveredId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startViewStart: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Ref to stable layout values used in external-hover effect (avoids stale closures)
  const layoutRef = useRef({ stationMap: new Map<string, { graph_pos: number; name: string }>(), viewStart: 0, viewEnd: 0, maxPos: 1, gw: 0, gh: 0, timetable });

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

  const ttStart = timeToMinutes(timetable.start_time);
  const ttEnd = timeToMinutes(timetable.end_time);
  const viewStart = viewStartProp ?? ttStart;
  const viewEnd = viewEndProp ?? ttEnd;
  const viewWidth = viewEnd - viewStart;
  const ttRange = ttEnd - ttStart;
  const isZoomed = viewWidth < ttRange;

  // Non-passive wheel for pan
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !onPan) return;
    const gw = size.w - PAD.left - PAD.right;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const panMinutes = delta * (viewWidth / gw);
      onPan(Math.max(ttStart, Math.min(ttEnd - viewWidth, viewStart + panMinutes)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [onPan, viewStart, viewWidth, ttStart, ttEnd, size.w]);

  const gw = size.w - PAD.left - PAD.right;
  const gh = size.h - PAD.top - PAD.bottom - (isZoomed ? 20 : 0);

  const stations = [...timetable.stations].sort((a, b) => (a.graph_pos ?? 0) - (b.graph_pos ?? 0));
  const maxPos = stations.length > 0 ? Math.max(...stations.map((s) => s.graph_pos ?? 0)) : 1;
  const stationMap = new Map(stations.map((s) => [s.id, { graph_pos: s.graph_pos ?? 0, name: s.name }]));
  // Keep layoutRef current for use in the external-hover effect
  layoutRef.current = { stationMap, viewStart, viewEnd, maxPos, gw, gh, timetable };

  // Ticks within view window
  const minorTicks: number[] = [];
  const majorTicks: number[] = [];
  for (let t = Math.ceil(viewStart / MINOR_TICK) * MINOR_TICK; t <= viewEnd; t += MINOR_TICK) minorTicks.push(t);
  for (let t = Math.ceil(viewStart / MAJOR_TICK) * MAJOR_TICK; t <= viewEnd; t += MAJOR_TICK) majorTicks.push(t);

  const timeToX = useCallback(
    (min: number) => PAD.left + ((min - viewStart) / viewWidth) * gw,
    [viewStart, viewWidth, gw]
  );
  const distToY = useCallback(
    (pos: number) => PAD.top + (maxPos > 0 ? (pos / maxPos) * gh : 0),
    [maxPos, gh]
  );

  const handleMouseLeave = () => { setTooltip(null); setHoveredId(null); };

  // Highlight from external source (e.g. Sidebar crew panel hover)
  useEffect(() => {
    if (hoveredId || !externalHoveredId) {
      if (!hoveredId) setTooltip(null);
      return;
    }
    const { stationMap, viewStart, viewEnd, maxPos, gw, gh, timetable } = layoutRef.current;
    const train = timetable.trains.find((t) => t.id === externalHoveredId);
    if (!train || !svgRef.current) return;
    const points = buildTrainPoints(train, stationMap, viewStart, viewEnd, maxPos, gw, gh);
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
  const svgH = size.h - (isZoomed ? 20 : 0);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col select-none overflow-hidden">
      <div className="flex-1 relative">
        <svg
          ref={svgRef}
          width={size.w}
          height={svgH}
          className="absolute inset-0"
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

          {/* Major grid lines + labels */}
          {majorTicks.map((min) => {
            const x = timeToX(min);
            return (
              <g key={`major-${min}`}>
                <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + gh} stroke="#334155" strokeWidth="1" />
                <text x={x} y={PAD.top + gh + 18} textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="monospace">
                  {minutesToTime(min)}
                </text>
              </g>
            );
          })}

          {/* Station lines & labels */}
          {stations.map((station) => {
            const y = distToY(station.graph_pos ?? 0);
            const kmLabel = station.distance != null ? `${station.distance}km` : null;
            return (
              <g key={station.id}>
                <line
                  x1={PAD.left} y1={y} x2={PAD.left + gw} y2={y}
                  stroke="#1e293b" strokeWidth="1"
                  strokeDasharray={(station.graph_pos ?? 0) === 0 ? 'none' : '4 4'}
                />
                <text x={PAD.left - 8} y={kmLabel ? y + 4 : y + 5} textAnchor="end" fill="#94a3b8" fontSize="12" fontFamily="system-ui, sans-serif">
                  {labelMode === 'code' ? (station.short_code || station.name) : station.name}
                </text>
                {kmLabel && (
                  <text x={PAD.left - 8} y={y + 16} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{kmLabel}</text>
                )}
              </g>
            );
          })}

          {/* Graph border */}
          <rect x={PAD.left} y={PAD.top} width={gw} height={gh} fill="none" stroke="#334155" strokeWidth="1" />

          {/* Train paths — clipped */}
          <g clipPath="url(#graphClip)">
            {timetable.trains.map((train) => {
              const points = buildTrainPoints(train, stationMap, viewStart, viewEnd, maxPos, gw, gh);
              if (points.length < 2) return null;
              const ptStr = points.map((p) => `${p.x},${p.y}`).join(' ');
              const isHovered = effectiveHoveredId === train.id;
              return (
                <g
                  key={train.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => handleTrainHover(train, points, e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
                  onClick={() => onTrainClick?.(train)}
                >
                  <polyline points={ptStr} fill="none" stroke="transparent" strokeWidth="12" />
                  {isHovered && <polyline points={ptStr} fill="none" stroke={train.color} strokeWidth="6" strokeOpacity="0.25" />}
                  <polyline points={ptStr} fill="none" stroke={train.color} strokeWidth={isHovered ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
                  {points.filter((_, i, arr) => i > 0 && arr[i - 1].y === arr[i].y).map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={train.color} />
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
          <text x={PAD.left + gw / 2} y={svgH - 4} textAnchor="middle" fill="#475569" fontSize="11" fontFamily="system-ui, sans-serif">Time</text>
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
            <div className="absolute inset-y-[7px] inset-x-0 bg-slate-800 rounded-full" />
            <div
              className="absolute inset-y-[3px] rounded-full bg-slate-500 hover:bg-slate-400 transition-colors cursor-grab active:cursor-grabbing"
              style={{ left: `${thumbOffset * 100}%`, width: `${thumbFrac * 100}%` }}
              onMouseDown={handleScrollbarMouseDown}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {tooltip && <GraphTooltip data={tooltip} />}
    </div>
  );
}
