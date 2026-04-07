import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Timetable, TimetableSummary, TimetableSettings, Train, ModalState, TrainRequest, Path, PathRequest } from './types';
import { api } from './api';
import { useLocalStorage, timeToMinutes, exportCatsXml } from './utils';
import { useFastClock } from './hooks/useFastClock';
import { Sidebar } from './components/Sidebar';
import { TrainGraph } from './components/TrainGraph';
import { SettingsPanel } from './components/SettingsPanel';
import { TimetableForm } from './components/TimetableForm';
import { TrainEditor } from './components/TrainEditor';
import { PathEditor } from './components/PathEditor';

export default function App() {
  const [timetables, setTimetables] = useState<TimetableSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  /** Live draft of train being edited – merged into graph for real-time preview */
  const [draftTrain, setDraftTrain] = useState<Train | null>(null);

  // ── Sidebar + undo/redo ───────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('tg:sidebarCollapsed', false);
  const [labelMode, setLabelMode] = useLocalStorage<'code' | 'name'>('tg:labelMode', 'code');
  const [historyPast, setHistoryPast] = useState<Timetable[]>([]);
  const [historyFuture, setHistoryFuture] = useState<Timetable[]>([]);
  // Keep a ref so undo/redo callbacks can always see the latest timetable
  const timetableRef = useRef<Timetable | null>(null);
  useEffect(() => { timetableRef.current = timetable; }, [timetable]);
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

  async function handleSettingsSave(updated: TimetableSettings) {
    if (!selectedId) return;
    const result = await api.updateTimetableSettings(selectedId, updated);
    setTimetable(result);
  }

  function recordAndSet(updated: Timetable) {
    if (timetableRef.current) {
      setHistoryPast((prev) => [...prev.slice(-19), timetableRef.current!]);
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
  }) {
    if (!selectedId) return;
    const updated = await api.addStation(selectedId, data);
    recordAndSet(updated);
  }

  async function handleUpdateStation(
    stationId: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number }
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

  async function handleAutoAssignCrews(data: { crewIds: string[]; trainIds: string[]; onlyUnassigned: boolean }): Promise<string[]> {
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
      trainType: train.train_type,
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

  // ── Undo / Redo ──────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (historyPast.length === 0 || !selectedId) return;
    const prev = historyPast[historyPast.length - 1];
    const cur = timetableRef.current;
    setHistoryPast((p) => p.slice(0, -1));
    if (cur) setHistoryFuture((f) => [cur, ...f.slice(0, 19)]);
    setTimetable(prev);
    await api.restoreTimetable(selectedId, prev);
  }, [historyPast, selectedId]);

  const handleRedo = useCallback(async () => {
    if (historyFuture.length === 0 || !selectedId) return;
    const next = historyFuture[0];
    const cur = timetableRef.current;
    setHistoryFuture((f) => f.slice(1));
    if (cur) setHistoryPast((p) => [...p.slice(-19), cur]);
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
    const xml = exportCatsXml(timetable);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timetable.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
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
        onCrewTrainHover={setHoveredCrewTrainId}
      />

      {/* ── MAIN GRAPH AREA ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
          <span className="text-xl">🚂</span>
          <h1 className="text-lg font-semibold tracking-tight text-white">Train Graph</h1>
          {timetable && (
            <>
              <span className="text-slate-600 mx-1">·</span>
              <span className="text-slate-300 font-medium">{timetable.name}</span>
            </>
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
                      settings={timetable.settings}
                      onSettingsSave={handleSettingsSave}
                      clockStatus={clockStatus}
                      clockError={clockError}
                      onClose={() => setSettingsOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
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
              viewStart={viewStart}
              viewEnd={viewEnd}
              clockTime={clockTime}
              onPan={handlePan}
              externalHoveredId={hoveredCrewTrainId}
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

function CogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
