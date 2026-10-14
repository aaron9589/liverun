import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { modeUrl } from './lib/mode';
import type { LayoutConfig, Timetable, TimetableSummary, TimetableSettings, Train, ModalState, TrainRequest, Path, PathRequest } from './types';
import { api } from './api';
import { useLocalStorage, timeToMinutes, exportCatsXml, exportCrewsXml, escapeHtml, stationNameStyle } from './utils';
import { useFastClock } from './hooks/useFastClock';
import { Sidebar } from './components/Sidebar';
import { TrainGraph } from './components/TrainGraph';
import { SettingsPanel } from './components/SettingsPanel';
import { LayoutSettings } from './components/LayoutSettings';
import { DEFAULT_LAYOUT } from './lib/layoutDefaults';
import { TimetableForm } from './components/TimetableForm';
import { TrainEditor } from './components/TrainEditor';
import { PathEditor } from './components/PathEditor';
import { StationReport } from './components/StationReport';

// ─── Print helpers ────────────────────────────────────────────────────────────

function buildFullTimetableHtml(timetable: Timetable): string {
  const stations = [...timetable.stations].sort((a, b) => (a.graph_pos ?? 0) - (b.graph_pos ?? 0));
  const trains = [...timetable.trains].sort((a, b) => {
    const firstTime = (t: Train) =>
      t.stops.reduce((min, s) => {
        const tm = s.departure ?? s.arrival;
        return tm ? Math.min(min, timeToMinutes(tm)) : min;
      }, Infinity);
    return firstTime(a) - firstTime(b);
  });

  // Dynamically fit trains per page based on A4 landscape printable width.
  // Estimates column widths using 8pt Arial character metrics at 96 dpi.
  const PX_PER_CHAR = 5.5; // 8pt Arial average glyph width
  const CELL_PAD = 10;     // 5px padding each side
  const PAGE_W = 1085;     // A4 landscape minus 0.5cm margins at 96 dpi

  const longestStationLen = stations.reduce(
    (max, s) => Math.max(max, s.name.length + (s.short_code ? 1 + s.short_code.length : 0)),
    7 // minimum: "Station" header
  );
  const stationColW = Math.min(longestStationLen * PX_PER_CHAR + CELL_PAD, 110);

  const trainColW = (t: Train) => {
    const hasBoth = t.stops.some(s => s.arrival && s.departure && s.arrival !== s.departure);
    return Math.max(t.name.length, hasBoth ? 11 : 5) * PX_PER_CHAR + CELL_PAD;
  };

  // Greedily pack trains until the estimated row width would exceed the page
  const pages: Train[][] = [];
  let idx = 0;
  while (idx < trains.length) {
    let usedW = stationColW;
    let end = idx;
    while (end < trains.length) {
      const cw = trainColW(trains[end]);
      if (usedW + cw > PAGE_W && end > idx) break;
      usedW += cw;
      end++;
    }
    pages.push(trains.slice(idx, end));
    idx = end;
  }
  if (pages.length === 0) pages.push([]);

  function buildTable(pageTrains: Train[], pageIndex: number): string {
    const isLast = pageIndex === pages.length - 1;

    // Precompute the first (origin) station ID for each train
    const originStationId = new Map<string, string>();
    for (const t of pageTrains) {
      let minMins = Infinity;
      let originId: string | null = null;
      for (const s of t.stops) {
        const tm = s.departure ?? s.arrival;
        if (tm) {
          const mins = timeToMinutes(tm);
          if (mins < minMins) { minMins = mins; originId = s.station_id; }
        }
      }
      if (originId) originStationId.set(t.id, originId);
    }

    const headerCells = pageTrains
      .map(
        (t) =>
          `<th style="text-align:center;white-space:nowrap;border-bottom:2px solid ${escapeHtml(t.color)};">${escapeHtml(t.name)}</th>`
      )
      .join('');

    const bodyRows = stations
      .map((station, si) => {
        const rowBg = si % 2 === 0 ? 'background-color:#f7f7e6;' : 'background-color:#ffffff;';
        const cells = pageTrains
          .map((train) => {
            const stop = train.stops.find((s) => s.station_id === station.id);
            if (!stop) return `<td style="${rowBg}">&#8203;</td>`;
            let content: string;
            if (stop.arrival && stop.departure && stop.arrival !== stop.departure) {
              content = `${escapeHtml(stop.arrival)} / ${escapeHtml(stop.departure)}`;
            } else {
              content = escapeHtml(stop.arrival ?? stop.departure ?? '');
            }
            const isOrigin = originStationId.get(train.id) === station.id;
            const cellStyle = `${rowBg}text-align:center;${isOrigin ? 'font-weight:bold;' : ''}`;
            return `<td style="${cellStyle}">${content}</td>`;
          })
          .join('');
        const shortCode = station.short_code
          ? ` <span style="font-weight:normal;color:#666;">${escapeHtml(station.short_code)}</span>`
          : '';
        const nameStyle = stationNameStyle(station);
        const stationNameStyleStr = `${rowBg}${nameStyle.bold ? 'font-weight:bold;' : ''}${nameStyle.italic ? 'font-style:italic;' : ''}${nameStyle.underline ? 'text-decoration:underline;' : ''}`;
        return `<tr><td style="${stationNameStyleStr}">${escapeHtml(station.name)}${shortCode}</td>${cells}</tr>`;
      })
      .join('');

    const pageLabel = pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : '';
    return `<div style="${isLast ? '' : 'page-break-after:always;'}">
  <div style="padding-bottom:6px;">
    <h2>${escapeHtml(timetable.name)}</h2>
    <h3>Working Timetable${pageLabel}</h3>
    <div class="rule"></div>
    <small>Session: ${escapeHtml(timetable.start_time)}&#8211;${escapeHtml(timetable.end_time)} &middot; ${trains.length} train${trains.length !== 1 ? 's' : ''} &middot; ${stations.length} station${stations.length !== 1 ? 's' : ''}</small>
  </div>
  <table>
    <thead>
      <tr>
        <th style="text-align:left;">Station</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</div>`;
  }

  const pagesHtml = pages.map((pageTrains, i) => buildTable(pageTrains, i)).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Working Timetable \u2014 ${escapeHtml(timetable.name)}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; line-height: 1.2; color: #000; background: white; padding: 0.5cm; }
    h2 { font-size: 9pt; font-weight: bold; line-height: 1.3; }
    h3 { font-size: 8pt; font-weight: normal; line-height: 1.3; }
    small { font-size: 7pt; line-height: 1.3; color: #444; }
    .rule { border-top: 1px solid #999; margin: 3px 0; }
    table { border-collapse: collapse; table-layout: auto; empty-cells: show; }
    thead { display: table-header-group; }
    th { font-size: 7.5pt; font-weight: bold; line-height: 1.2; border: 1px solid #aaa; padding: 2px 5px; white-space: nowrap; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { font-size: 8pt; line-height: 1.2; border: 1px solid #aaa; padding: 2px 5px; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td:first-child, th:first-child { white-space: normal; min-width: 80px; max-width: 110px; }
    tr { page-break-inside: avoid; }
    .print-btn { display:inline-flex; align-items:center; gap:6px; margin-bottom:10px; padding:6px 14px; background:#1d4ed8; color:#fff; border:none; border-radius:4px; font-size:9pt; font-family:Arial,sans-serif; cursor:pointer; }
    .print-btn:hover { background:#1e40af; }
    @media print { .print-btn { display:none; } }
  </style>
</head>
<body>
<button class="print-btn" onclick="window.print()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
${pagesHtml}
</body>
</html>`;
}

export default function App() {
  const [timetables, setTimetables] = useState<TimetableSummary[]>([]);
  const [layout, setLayout] = useState<LayoutConfig | null>(null);
  // Layout config is optional; if the endpoint fails, JMRI is treated as unconfigured.
  useEffect(() => { api.getLayout().then(setLayout).catch(() => {}); }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
/** Live draft of train being edited – merged into graph for real-time preview */
  const [draftTrain, setDraftTrain] = useState<Train | null>(null);

  // ── Sidebar + undo/redo ───────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('tg:sidebarCollapsed', false);
  const [labelMode, setLabelMode] = useLocalStorage<'code' | 'name'>('tg:labelMode', 'code');
  const [distanceUnit, setDistanceUnit] = useLocalStorage<'km' | 'mi'>('tg:distanceUnit', 'km');
  const [historyPast, setHistoryPast] = useState<Timetable[]>([]);
  const [historyFuture, setHistoryFuture] = useState<Timetable[]>([]);
  // Keep a ref so undo/redo callbacks can always see the latest timetable
  const timetableRef = useRef<Timetable | null>(null);
  useEffect(() => { timetableRef.current = timetable; }, [timetable]);
  // Update window title when timetable changes
  useEffect(() => {
    document.title = timetable ? `LiveRun | ${timetable.name}` : 'LiveRun';
  }, [timetable]);
  // Reset history + zoom when switching timetables
  useEffect(() => { setHistoryPast([]); setHistoryFuture([]); }, [selectedId]);
  useEffect(() => { setZoomLevel(1); setViewOffset(0); }, [selectedId]);

  // ── Train visibility ──────────────────────────────────
  const [hiddenTrainIds, setHiddenTrainIds] = useState<Set<string>>(new Set());
  useEffect(() => { setHiddenTrainIds(new Set()); }, [selectedId]);

  // ── Crew filter (show only one operator's trains on graph) ────
  const [crewFilter, setCrewFilter] = useState<string | null>(null);
  useEffect(() => { setCrewFilter(null); }, [selectedId]);

  // ── Crew train hover (highlights train in graph from Sidebar) ──
  const [hoveredCrewTrainId, setHoveredCrewTrainId] = useState<string | null>(null);

  function handleToggleTrainVisibility(trainId: string) {
    setHiddenTrainIds((prev) => {
      const next = new Set(prev);
      if (next.has(trainId)) next.delete(trainId);
      else next.add(trainId);
      return next;
    });
  }

  // ── Zoom / pan / settings UI ───────────────────────────
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);

  // ── Derived view window ────────────────────────────────
  const { viewStart, viewEnd } = useMemo(() => {
    if (!timetable) return { viewStart: 0, viewEnd: 0 };
    const start = timeToMinutes(timetable.start_time);
    const end = timeToMinutes(timetable.end_time);
    const range = end - start;
    if (zoomLevel <= 1) return { viewStart: start, viewEnd: end };
    const viewWidth = range / zoomLevel;
    const maxPan = range - viewWidth;
    return { viewStart: start + viewOffset * maxPan, viewEnd: start + viewOffset * maxPan + viewWidth };
  }, [timetable, zoomLevel, viewOffset]);

  // ── Fast clock ───────────────────────────────────────
  const clockSettings = timetable?.settings ?? { clock_enabled: false, clock_broker_url: '', clock_topic: 'trains/jmri/memory/currentTime' };
  const { clockTime, status: clockStatus, errorMessage: clockError } = useFastClock(
    clockSettings.clock_broker_url,
    clockSettings.clock_topic,
    clockSettings.clock_enabled
  );

  // ── Sync WebSocket — keep completion state in sync across all clients ────────
  useEffect(() => {
    if (!selectedId) return;
    // Build an absolute WS URL. BASE_URL is './' in production (relative),
    // so strip both the trailing slash and any leading dot before splicing in.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Derive the deployment base path from the current URL so the WS works under
    // a reverse-proxy sub-path. Strip a trailing '/mobile' and any trailing slash.
    const basePath = window.location.pathname.replace(/\/mobile\/?$/, '').replace(/\/+$/, '');
    const ws = new WebSocket(`${proto}//${window.location.host}${basePath}/api/live/sync?id=${selectedId}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'completions' && msg.timetableId === selectedId) {
          setTimetable((prev) => {
            if (!prev) return prev;
            const statuses: Record<string, 'running' | 'completed'> = msg.statuses ?? {};
            const trains = prev.trains.map((t) => ({ ...t, status: statuses[t.id] ?? undefined }));
            return { ...prev, trains };
          });
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); };
  }, [selectedId]);

  async function handleSettingsSave(updated: TimetableSettings) {
    if (!selectedId) return;
    try {
      const result = await api.updateTimetableSettings(selectedId, updated);
      setTimetable(result);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  function stripStatus(tt: Timetable): Timetable {
    return { ...tt, trains: tt.trains.map((t) => { const { status: _, ...rest } = t; return rest as typeof t; }) };
  }

  function recordAndSet(updated: Timetable) {
    if (timetableRef.current) {
      setHistoryPast((prev) => [...prev.slice(-19), stripStatus(timetableRef.current!)]);
    }
    setHistoryFuture([]);
    setTimetable(updated);
  }

  // ── Data loading ─────────────────────────────────────────────

  const refreshList = useCallback(async () => {
    const list = await api.listTimetables();
    setTimetables(list);
    return list;
  }, []);

  const loadTimetable = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await api.getTimetable(id);
      setTimetable(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, [refreshList]);

  useEffect(() => {
    if (selectedId) {
      setDraftTrain(null);
      loadTimetable(selectedId);
    } else {
      setTimetable(null);
    }
  }, [selectedId, loadTimetable]);

  // ── Derived: timetable with draft merged in ──────────────────

  const displayTimetable = useMemo<Timetable | null>(() => {
    if (!timetable) return null;
    let trains = timetable.trains;
    if (draftTrain) {
      const idx = trains.findIndex((t) => t.id === draftTrain.id);
      trains = idx >= 0
        ? trains.map((t, i) => (i === idx ? draftTrain : t))
        : [...trains, draftTrain];
    }
    trains = trains.filter((t) => !hiddenTrainIds.has(t.id));
    if (crewFilter) trains = trains.filter((t) => t.crew_id === crewFilter);
    return { ...timetable, trains };
  }, [timetable, draftTrain, hiddenTrainIds, crewFilter]);

  // ── Timetable CRUD ───────────────────────────────────────────

  async function handleCreateTimetable(data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) {
    const created = await api.createTimetable(data);
    const list = await refreshList();
    const found = list.find((t) => t.id === created.id);
    if (found) setSelectedId(found.id);
    setModal({ type: 'none' });
  }

  async function handleDuplicateTimetable(id: string) {
    const created = await api.duplicateTimetable(id);
    const list = await refreshList();
    const found = list.find((t) => t.id === created.id);
    if (found) setSelectedId(found.id);
  }

  async function handleUpdateTimetable(data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) {
    if (!selectedId) return;
    const updated = await api.updateTimetable(selectedId, data);
    recordAndSet(updated);
    await refreshList();
    setModal({ type: 'none' });
  }

  async function handleDeleteTimetable(id: string) {
    await api.deleteTimetable(id);
    const list = await refreshList();
    if (selectedId === id) {
      setSelectedId(list.length > 0 ? list[0].id : null);
    }
  }

  async function handleSetActiveTimetable(id: string | null) {
    await api.setActiveTimetable(id);
    await refreshList();
  }

  // ── Station CRUD ─────────────────────────────────────────────

  async function handleAddStation(data: {
    name: string;
    shortCode: string;
    distance: number | null;
    graphPos: number;
    branchName?: string | null;
    pushDown?: boolean;
    aliasEnabled?: boolean;
    boldName?: boolean;
    italicName?: boolean;
    underlineName?: boolean;
  }) {
    if (!selectedId) return;
    const updated = await api.addStation(selectedId, data);
    recordAndSet(updated);
  }

  async function handleUpdateStation(
    stationId: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number; branchName?: string | null; pushDown?: boolean; aliasEnabled?: boolean; boldName?: boolean; italicName?: boolean; underlineName?: boolean }
  ) {
    if (!selectedId) return;
    const updated = await api.updateStation(selectedId, stationId, data);
    recordAndSet(updated);
  }

  async function handleDeleteStation(stationId: string) {
    if (!selectedId) return;
    const updated = await api.deleteStation(selectedId, stationId);
    recordAndSet(updated);
  }

  // ── Train CRUD ───────────────────────────────────────────────

  async function handleSaveTrain(data: TrainRequest) {
    if (!selectedId) return;
    let updated: Timetable;
    if (data.id) {
      updated = await api.updateTrain(selectedId, data.id, data);
    } else {
      updated = await api.addTrain(selectedId, data);
    }
    recordAndSet(updated);
    setDraftTrain(null);
    setModal({ type: 'none' });
  }

  async function handleDeleteTrain(trainId: string) {
    if (!selectedId) return;
    const updated = await api.deleteTrain(selectedId, trainId);
    recordAndSet(updated);
    setDraftTrain(null);
    if (modal.type === 'editTrain') setModal({ type: 'none' });
  }

  // ── Path CRUD ────────────────────────────────────────────────

  async function handleSavePath(data: PathRequest) {
    if (!selectedId) return;
    let updated: Timetable;
    if (data.id) {
      updated = await api.updatePath(selectedId, data.id, data);
    } else {
      updated = await api.addPath(selectedId, data);
    }
    recordAndSet(updated);
    setModal({ type: 'none' });
  }

  async function handleDeletePath(pathId: string) {
    if (!selectedId) return;
    const updated = await api.deletePath(selectedId, pathId);
    recordAndSet(updated);
    if (modal.type === 'editPath') setModal({ type: 'none' });
  }

  // ── Crew CRUD ────────────────────────────────────────────────

  async function handleAddCrew(data: { name: string; color: string }) {
    if (!selectedId) return;
    const updated = await api.addCrew(selectedId, data);
    recordAndSet(updated);
  }

  async function handleUpdateCrew(crewId: string, data: { name: string; color: string }) {
    if (!selectedId) return;
    const updated = await api.updateCrew(selectedId, crewId, data);
    recordAndSet(updated);
  }

  async function handleDeleteCrew(crewId: string) {
    if (!selectedId) return;
    const updated = await api.deleteCrew(selectedId, crewId);
    recordAndSet(updated);
  }

  async function handleReorderCrews(order: string[]) {
    if (!selectedId) return;
    const updated = await api.reorderCrews(selectedId, order);
    recordAndSet(updated);
  }

  async function handleAutoAssignCrews(data: { crewIds: string[]; trainIds: string[]; onlyUnassigned: boolean; minBreakMins: number }): Promise<string[]> {
    if (!selectedId) return [];
    const result = await api.autoAssignCrews(selectedId, data);
    const { unassigned = [], ...timetable } = result as any;
    recordAndSet(timetable);
    return unassigned;
  }

  async function handleUnassignTrain(trainId: string) {
    if (!selectedId || !timetable) return;
    const train = timetable.trains.find((t) => t.id === trainId);
    if (!train) return;
    const updated = await api.updateTrain(selectedId, trainId, {
      name: train.name,
      color: train.color,
      notes: train.notes,
      trainId: train.train_id,
      direction: train.direction,
      crewId: undefined,
      stops: train.stops.map((s) => ({
        stationId: s.station_id,
        arrival: s.arrival,
        departure: s.departure,
        specialInstructions: s.special_instructions,
      })),
    });
    recordAndSet(updated);
  }

  async function handleToggleTrainComplete(trainId: string) {
    if (!selectedId || !timetable) return;
    const train = timetable.trains.find((t) => t.id === trainId);
    if (!train) return;
    const next = train.status === 'running' ? 'completed' : train.status === 'completed' ? null : 'running';
    try {
      const updated = await api.setTrainStatus(selectedId, trainId, next);
      setTimetable(updated);
    } catch { /* ignore — status toggle is best-effort */ }
  }

  async function handleResetAllCompleted() {
    if (!selectedId) return;
    try {
      const updated = await api.resetAllCompleted(selectedId);
      setTimetable(updated);
    } catch { /* ignore — status reset is best-effort */ }
  }

  // ── Undo / Redo ──────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (historyPast.length === 0 || !selectedId) return;
    const prev = historyPast[historyPast.length - 1];
    const cur = timetableRef.current;
    setHistoryPast((p) => p.slice(0, -1));
    if (cur) setHistoryFuture((f) => [stripStatus(cur), ...f.slice(0, 19)]);
    setTimetable(prev);
    await api.restoreTimetable(selectedId, prev);
  }, [historyPast, selectedId]);

  const handleRedo = useCallback(async () => {
    if (historyFuture.length === 0 || !selectedId) return;
    const next = historyFuture[0];
    const cur = timetableRef.current;
    setHistoryFuture((f) => f.slice(1));
    if (cur) setHistoryPast((p) => [...p.slice(-19), stripStatus(cur)]);
    setTimetable(next);
    await api.restoreTimetable(selectedId, next);
  }, [historyFuture, selectedId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  // ── Zoom handlers ─────────────────────────────────────
  function adjustZoom(newLevel: number, atMinute?: number) {
    if (!timetable) return;
    const start = timeToMinutes(timetable.start_time);
    const end = timeToMinutes(timetable.end_time);
    const range = end - start;
    const oldWidth = range / zoomLevel;
    const oldMaxPan = Math.max(0, range - oldWidth);
    const currentStart = start + viewOffset * oldMaxPan;
    const pivot = atMinute ?? (currentStart + oldWidth / 2);
    const fracInOld = (pivot - currentStart) / oldWidth;
    const newWidth = range / newLevel;
    const newStart = pivot - fracInOld * newWidth;
    const newMaxPan = Math.max(0, range - newWidth);
    setZoomLevel(newLevel);
    setViewOffset(newMaxPan > 0 ? Math.max(0, Math.min(1, (newStart - start) / newMaxPan)) : 0);
  }

  function handleZoomIn() { adjustZoom(Math.min(8, zoomLevel * 2)); }
  function handleZoomOut() { adjustZoom(Math.max(1, zoomLevel / 2)); }

  function handlePan(newViewStart: number) {
    if (!timetable) return;
    const start = timeToMinutes(timetable.start_time);
    const end = timeToMinutes(timetable.end_time);
    const range = end - start;
    const viewWidth = range / zoomLevel;
    const maxPan = Math.max(0, range - viewWidth);
    setViewOffset(maxPan > 0 ? Math.max(0, Math.min(1, (newViewStart - start) / maxPan)) : 0);
  }

  // ── Export / Import ──────────────────────────────────

  function handleExportTimetable() {
    if (!timetable) return;
    const json = JSON.stringify(timetable, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timetable.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCatsXml() {
    if (!timetable) return;
    const baseName = `${timetable.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

    const xml = exportCatsXml(timetable);
    const xmlBlob = new Blob([xml], { type: 'application/xml' });
    const xmlUrl = URL.createObjectURL(xmlBlob);
    const a = document.createElement('a');
    a.href = xmlUrl;
    a.download = `${baseName}.xml`;
    a.click();
    URL.revokeObjectURL(xmlUrl);

    const crewXml = exportCrewsXml(timetable);
    const crewBlob = new Blob([crewXml], { type: 'application/xml' });
    const crewUrl = URL.createObjectURL(crewBlob);
    const b = document.createElement('a');
    b.href = crewUrl;
    b.download = `${baseName}-crews.xml`;
    b.click();
    URL.revokeObjectURL(crewUrl);
  }

  async function handleImportTimetable(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const imported = await api.importTimetable(data);
      const list = await refreshList();
      const found = list.find((t) => t.id === imported.id);
      if (found) setSelectedId(found.id);
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import timetable. Make sure the file is a valid timetable JSON export.');
    }
  }

  // ── Print handlers ──────────────────────────────────────────

  function handlePrintTimetable() {
    if (!timetable) return;
    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) return;
    win.document.write(buildFullTimetableHtml(timetable));
    win.document.close();
    win.focus();
  }

  function handlePrintGraph() {
    if (!timetable) return;
    const svg = document.getElementById('train-graph-svg') as SVGSVGElement | null;
    if (!svg) return;
    // Clone so we can modify attributes without affecting the live graph
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const w = svg.width.baseVal.value;
    const h = svg.height.baseVal.value;
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    clone.setAttribute('width', '100%');
    clone.removeAttribute('height');
    clone.removeAttribute('class');
    clone.removeAttribute('style');

    // Remap dark SVG palette to print-friendly light equivalents
    let svgContent = clone.outerHTML;
    const colorMap: [string, string][] = [
      ['fill="#0a0f1e"',  'fill="#ffffff"'],    // graph background
      ['stroke="#1e293b"','stroke="#d1d5db"'],  // minor grid lines + station lines
      ['stroke="#334155"','stroke="#9ca3af"'],  // major grid lines + border
      ['fill="#64748b"',  'fill="#374151"'],    // time-axis labels
      ['fill="#94a3b8"',  'fill="#111827"'],    // station name labels
      ['fill="#475569"',  'fill="#4b5563"'],    // km labels
    ];
    for (const [from, to] of colorMap) {
      svgContent = svgContent.split(from).join(to);
    }

    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(timetable.name)} \u2014 Train Graph</title>
  <style>
    @page { size: A3 landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #ffffff; color: #111827; font-family: Arial, sans-serif; padding: 0.25in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { font-size: 9pt; font-weight: normal; color: #374151; margin-bottom: 6px; }
    svg { width: 100%; height: auto; display: block; }
    .print-btn { display:inline-flex; align-items:center; gap:6px; margin-bottom:10px; padding:6px 14px; background:#1d4ed8; color:#fff; border:none; border-radius:4px; font-size:9pt; font-family:Arial,sans-serif; cursor:pointer; }
    .print-btn:hover { background:#1e40af; }
    @media print { .print-btn { display:none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
  <h2>${escapeHtml(timetable.name)} \u2014 Train Graph</h2>
  ${svgContent}
</body>
</html>`);
    win.document.close();
    win.focus();
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* ── LEFT SIDEBAR ── */}
      <Sidebar
        timetables={timetables}
        selectedId={selectedId}
        timetable={timetable}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onSelectTimetable={setSelectedId}
        onNewTimetable={() => setModal({ type: 'newTimetable' })}
        onEditTimetable={() =>
          timetable && setModal({ type: 'editTimetable', timetable })
        }
        onDeleteTimetable={handleDeleteTimetable}
        onDuplicateTimetable={handleDuplicateTimetable}
        onSetActiveTimetable={handleSetActiveTimetable}
        onAddStation={handleAddStation}
        onUpdateStation={handleUpdateStation}
        onDeleteStation={handleDeleteStation}
        onNewPath={() => setModal({ type: 'newPath' })}
        onEditPath={(path: Path) => setModal({ type: 'editPath', path })}
        onDeletePath={handleDeletePath}
        onNewTrain={() => setModal({ type: 'newTrain' })}
        onEditTrain={(train: Train) => setModal({ type: 'editTrain', train })}
        onDeleteTrain={handleDeleteTrain}
        hiddenTrainIds={hiddenTrainIds}
        onToggleTrainVisibility={handleToggleTrainVisibility}
        onExportTimetable={handleExportTimetable}
        onExportCatsXml={handleExportCatsXml}
        onImportTimetable={handleImportTimetable}
        onAddCrew={handleAddCrew}
        onUpdateCrew={handleUpdateCrew}
        onDeleteCrew={handleDeleteCrew}
        onReorderCrews={handleReorderCrews}
        onAutoAssignCrews={handleAutoAssignCrews}
        onUnassignTrain={handleUnassignTrain}
        onToggleTrainComplete={handleToggleTrainComplete}
        onCrewTrainHover={setHoveredCrewTrainId}
        distanceUnit={distanceUnit}
      />

      {/* ── MAIN GRAPH AREA ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
          {timetable && (
            <span className="text-slate-300 font-medium">{timetable.name}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {timetable && (
              <>
                <button
                  onClick={handleUndo}
                  disabled={historyPast.length === 0}
                  title="Undo (⌘Z)"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors hover:bg-slate-800"
                >
                  <UndoIcon />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyFuture.length === 0}
                  title="Redo (⌘⇧Z)"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors hover:bg-slate-800"
                >
                  <RedoIcon />
                </button>
                <span className="text-slate-700 mx-1">|</span>
                {/* Zoom controls */}
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 1}
                  title="Zoom out"
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 text-lg leading-none"
                >−</button>
                <span className="text-xs text-slate-500 w-6 text-center">{zoomLevel <= 1 ? '1×' : `${Math.round(zoomLevel)}×`}</span>
                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 8}
                  title="Zoom in"
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 text-lg leading-none"
                >+</button>
                <span className="text-slate-700 mx-1">|</span>
                {/* Crew filter */}
                {timetable.crews && timetable.crews.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Filter by crew:</span>
                    <select
                      value={crewFilter ?? ''}
                      onChange={(e) => setCrewFilter(e.target.value || null)}
                      className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500 cursor-pointer"
                      title="Filter graph to show only trains assigned to this crew member"
                    >
                      <option value="">All operators</option>
                      {timetable.crews.map((crew) => (
                        <option key={crew.id} value={crew.id}>{crew.name}</option>
                      ))}
                    </select>
                    {crewFilter && (
                      <button
                        onClick={() => setCrewFilter(null)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        title="Clear filter"
                      >✕</button>
                    )}
                  </div>
                )}
                {/* Reset completions — only shown when any train is completed */}
                {timetable.trains.some((t) => t.status) && (
                  <>
                    <span className="text-slate-700 mx-1">|</span>
                    <button
                      onClick={handleResetAllCompleted}
                      title="Reset all completed jobs"
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors px-1.5 py-1 rounded hover:bg-slate-800"
                    >
                      <span className="text-green-600">✓</span> Reset jobs
                    </button>
                  </>
                )}
                <span className="text-slate-700 mx-1">|</span>
                {/* Print menu */}
                <div className="relative">
                  <button
                    onClick={() => setPrintMenuOpen((v) => !v)}
                    title="Print"
                    className={`p-1.5 rounded transition-colors hover:bg-slate-800 ${printMenuOpen ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <PrintIcon />
                  </button>
                  {printMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setPrintMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[190px]">
                        <button
                          onClick={() => { setPrintMenuOpen(false); setModal({ type: 'stationReport', stationId: timetable.stations[0]?.id ?? null }); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <ReportIcon />
                          Station report
                        </button>
                        <button
                          onClick={() => { setPrintMenuOpen(false); handlePrintTimetable(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <PrintTimetableIcon />
                          Full timetable
                        </button>
                        <button
                          onClick={() => { setPrintMenuOpen(false); handlePrintGraph(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <PrintGraphIcon />
                          Train graph
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <span className="text-slate-700 mx-1">|</span>
                {/* Fast clock indicator */}
                {timetable.settings?.clock_enabled && (
                  <span className="flex items-center gap-1.5 mr-1" title={`Fast clock — MQTT topic: ${timetable.settings.clock_topic}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      clockStatus === 'connected' ? 'bg-emerald-400' :
                      clockStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
                      'bg-slate-600'
                    }`} />
                    {timetable.settings.clock_topic && (
                      <span className="text-xs text-slate-500 font-mono">{timetable.settings.clock_topic}</span>
                    )}
                  </span>
                )}
                {/* Settings cog */}
                <div className="relative">
                  <button
                    onClick={() => setSettingsOpen((v) => !v)}
                    title="Settings"
                    className={`p-1.5 rounded transition-colors hover:bg-slate-800 ${
                      settingsOpen ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CogIcon />
                  </button>
                  {settingsOpen && (
                    <SettingsPanel
                      labelMode={labelMode}
                      onLabelModeChange={setLabelMode}
                      distanceUnit={distanceUnit}
                      onDistanceUnitChange={setDistanceUnit}
                      settings={timetable.settings}
                      onSettingsSave={handleSettingsSave}
                      clockStatus={clockStatus}
                      clockError={clockError}
                      onClose={() => setSettingsOpen(false)}
                      onOpenLayoutSettings={() => setModal({ type: 'layoutSettings' })}
                      timetableId={selectedId ?? undefined}
                      firstStationName={timetable.stations?.[0]?.name}
                    />
                  )}
                </div>
              </>
            )}
            <a
              href={modeUrl('guard')}
              title="Open the guard panel"
              className="flex items-center gap-1 px-1.5 py-1.5 rounded text-xs transition-colors hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            >
              Guard panel
            </a>
            {/* Layout settings — reachable without a timetable */}
            <button
              onClick={() => setModal({ type: 'layoutSettings' })}
              title="Layout settings"
              className={`flex items-center gap-1 px-1.5 py-1.5 rounded text-xs transition-colors hover:bg-slate-800 ${
                modal.type === 'layoutSettings' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutIcon />
              Layout
            </button>
          </div>
        </header>


        {/* Graph */}
        <div className="flex-1 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 z-10 bg-slate-950/60">
              Loading…
            </div>
          )}
          {!selectedId && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 gap-3">
              <span className="text-4xl">🚂</span>
              <p className="text-lg">No timetable selected</p>
              <button
                onClick={() => setModal({ type: 'newTimetable' })}
                className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Create your first timetable
              </button>
            </div>
          )}
          {displayTimetable && !loading && (
            <TrainGraph
              timetable={displayTimetable}
              onTrainClick={(train) => setModal({ type: 'editTrain', train })}
              labelMode={labelMode}
              distanceUnit={distanceUnit}
              viewStart={viewStart}
              viewEnd={viewEnd}
              clockTime={clockTime}
              onPan={handlePan}
              externalHoveredId={hoveredCrewTrainId}
              onScaleChange={(scale) => handleSettingsSave({ ...displayTimetable.settings, graph_scale: scale })}
            />
          )}
        </div>
      </main>

      {/* ── MODALS ── */}
      {(modal.type === 'newTimetable' || modal.type === 'editTimetable') && (
        <TimetableForm
          initial={modal.type === 'editTimetable' ? modal.timetable : undefined}
          onSave={modal.type === 'newTimetable' ? handleCreateTimetable : handleUpdateTimetable}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {(modal.type === 'newTrain' || modal.type === 'editTrain') && timetable && (
        <TrainEditor
          train={modal.type === 'editTrain' ? modal.train : undefined}
          stations={timetable.stations}
          paths={timetable.paths}
          crews={timetable.crews}
          existingColors={timetable.trains.map((t) => t.color)}
          distanceUnit={distanceUnit}
          jmriUrl={layout?.jmri.url}
          profiles={layout?.train_profiles ?? []}
          onDraftChange={setDraftTrain}
          onSave={handleSaveTrain}
          onDelete={modal.type === 'editTrain' ? () => handleDeleteTrain(modal.train.id) : undefined}
          onClose={() => {
            setDraftTrain(null);
            setModal({ type: 'none' });
          }}
        />
      )}

      {(modal.type === 'newPath' || modal.type === 'editPath') && timetable && (
        <PathEditor
          path={modal.type === 'editPath' ? modal.path : undefined}
          stations={timetable.stations}
          onSave={(data) =>
            handleSavePath({ ...data, id: modal.type === 'editPath' ? modal.path.id : undefined })
          }
          onDelete={modal.type === 'editPath' ? () => handleDeletePath(modal.path.id) : undefined}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'layoutSettings' && (
        <LayoutSettings
          layout={layout ?? DEFAULT_LAYOUT}
          timetable={timetable}
          onSaved={setLayout}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'stationReport' && timetable && (
        <StationReport
          timetable={timetable}
          initialStationId={modal.stationId}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
    </div>
  );
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M3 13C5.5 6.5 13 4 18 8s5 12 0 16" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M21 13C18.5 6.5 11 4 6 8s-5 12 0 16" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="9" y1="7" x2="15" y2="7" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <line x1="9" y1="15" x2="12" y2="15" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" fill="currentColor" />
      <circle cx="16" cy="12" r="2" fill="currentColor" />
      <circle cx="10" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function PrintTimetableIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  );
}

function PrintGraphIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
