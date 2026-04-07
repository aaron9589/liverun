import { useRef, useState } from 'react';
import type { Path, Timetable, TimetableSummary, Train } from '../types';
import { StationPanel } from './StationPanel';
import { useLocalStorage } from '../utils';

interface Props {
  timetables: TimetableSummary[];
  selectedId: string | null;
  timetable: Timetable | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTimetable: (id: string) => void;
  onNewTimetable: () => void;
  onEditTimetable: () => void;
  onDeleteTimetable: (id: string) => void;
  onDuplicateTimetable: (id: string) => void;
  onSetActiveTimetable: (id: string | null) => void;
  onAddStation: (data: { name: string; shortCode: string; distance: number | null; graphPos: number }) => void;
  onUpdateStation: (id: string, data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number }) => void;
  onDeleteStation: (id: string) => void;
  onNewPath: () => void;
  onEditPath: (path: Path) => void;
  onDeletePath: (pathId: string) => void;
  onNewTrain: () => void;
  onEditTrain: (train: Train) => void;
  onDeleteTrain: (trainId: string) => void;
  hiddenTrainIds: Set<string>;
  onToggleTrainVisibility: (trainId: string) => void;
  onExportTimetable: () => void;
  onExportCatsXml: () => void;
  onImportTimetable: (file: File) => void;
  onAddCrew: (data: { name: string; color: string }) => void;
  onUpdateCrew: (crewId: string, data: { name: string; color: string }) => void;
  onDeleteCrew: (crewId: string) => void;
  onReorderCrews: (order: string[]) => void;
  onAutoAssignCrews: (data: { crewIds: string[]; trainIds: string[]; onlyUnassigned: boolean }) => Promise<string[]>;
  onUnassignTrain: (trainId: string) => void;
  onCrewTrainHover?: (trainId: string | null) => void;
}

export function Sidebar({
  timetables,
  selectedId,
  timetable,
  collapsed,
  onToggleCollapse,
  onSelectTimetable,
  onNewTimetable,
  onEditTimetable,
  onDeleteTimetable,
  onDuplicateTimetable,
  onSetActiveTimetable,
  onAddStation,
  onUpdateStation,
  onDeleteStation,
  onNewPath,
  onEditPath,
  onDeletePath,
  onNewTrain,
  onEditTrain,
  onDeleteTrain,
  hiddenTrainIds,
  onToggleTrainVisibility,
  onExportTimetable,
  onExportCatsXml,
  onImportTimetable,
  onAddCrew,
  onUpdateCrew,
  onDeleteCrew,
  onReorderCrews,
  onAutoAssignCrews,
  onUnassignTrain,
  onCrewTrainHover,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openSections, setOpenSections] = useLocalStorage('tg:openSections', { trains: true, stations: true, paths: false, crews: false });
  const [editingCrew, setEditingCrew] = useState<{ id: string; name: string; color: string } | null>(null);
  const [newCrew, setNewCrew] = useState<{ name: string; color: string } | null>(null);
  const [crewOrder, setCrewOrder] = useState<string[] | null>(null);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  const [autoAssignCrewIds, setAutoAssignCrewIds] = useState<Set<string>>(new Set());
  const [autoAssignTrainIds, setAutoAssignTrainIds] = useState<Set<string>>(new Set());
  const [autoAssignOnlyUnassigned, setAutoAssignOnlyUnassigned] = useState(true);
  const [autoAssignWarning, setAutoAssignWarning] = useState<string[] | null>(null);
  const dragCrewId = useRef<string | null>(null);
  const dragOverCrewId = useRef<string | null>(null);

  function toggleSection(s: 'trains' | 'stations' | 'paths' | 'crews') {
    setOpenSections((prev) => ({ ...prev, [s]: !prev[s] }));
  }

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 flex flex-col items-center bg-slate-900 border-r border-slate-800 py-4 gap-4">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-slate-500 hover:text-slate-300 rounded transition-colors"
          title="Expand sidebar"
        >
          <ChevronRightIcon />
        </button>
        <span className="text-lg">🚂</span>
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-slate-900 border-r border-slate-800 overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🚂</span>
          <span className="font-bold text-white tracking-tight text-lg flex-1">LiveRun</span>
          <button
            onClick={onToggleCollapse}
            className="p-1 text-slate-500 hover:text-slate-300 rounded transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeftIcon />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3 pl-9">Operating Session Resource Planner</p>

        {/* Timetable section */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Timetables
          </span>
          <div className="flex items-center gap-1">
            <label
              title="Import timetable from JSON"
              className="cursor-pointer p-1 text-slate-500 hover:text-slate-300 rounded transition-colors"
            >
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { onImportTimetable(f); e.target.value = ''; }
                }}
              />
              <UploadIcon />
            </label>
            <button
              onClick={onNewTimetable}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              + New
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-600 mb-2">Click a timetable to open it. Use the <span className="text-green-400">●</span> flag to mark it active for the live API.</p>

        {/* Timetable list */}
        <div className="space-y-1">
          {timetables.length === 0 && (
            <p className="text-xs text-slate-600 py-2">No timetables yet</p>
          )}
          {timetables.map((tt) => (
            <div
              key={tt.id}
              className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                tt.id === selectedId
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              onClick={() => onSelectTimetable(tt.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetActiveTimetable(tt.active ? null : tt.id);
                }}
                title={tt.active ? 'Active for guard panel — click to deactivate' : 'Set as active for guard panel'}
                className={`shrink-0 transition-colors ${
                  tt.active ? 'text-green-400' : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                <ActiveFlagIcon />
              </button>
              <span className="flex-1 text-sm font-medium truncate">{tt.name}</span>
              {tt.id === selectedId && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onExportCatsXml(); }}
                    title="Export timetable as CATS XML"
                    className="p-1 text-slate-400 hover:text-slate-200 rounded"
                  >
                    <CatsIcon />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onExportTimetable(); }}
                    title="Export timetable as JSON"
                    className="p-1 text-slate-400 hover:text-slate-200 rounded"
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicateTimetable(tt.id); }}
                    title="Duplicate timetable"
                    className="p-1 text-slate-400 hover:text-slate-200 rounded"
                  >
                    <CopyIcon />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditTimetable(); }}
                    title="Edit timetable settings"
                    className="p-1 text-slate-400 hover:text-slate-200 rounded"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(tt.id); }}
                    title="Delete timetable"
                    className="p-1 text-slate-400 hover:text-red-400 rounded"
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Trains ── */}
      {timetable && (
        <>
          <div className="border-t border-slate-800 mx-4" />
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => toggleSection('trains')}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors"
              >
                <Chevron open={openSections.trains} />
                Trains
              </button>
              <div className="flex items-center gap-2">
                <a
                  href={`${(import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')}/api/timetables/${timetable.id}/live/trains`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Live API — /api/timetables/${timetable.id}/live/trains`}
                  className="text-slate-600 hover:text-blue-400 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <LinkIcon />
                </a>
                <button
                  onClick={onNewTrain}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  + Add
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 mb-2">Add and manage trains on the graph. Dots indicate: <span className="text-blue-400">●</span> notes &nbsp;<span className="text-amber-400">●</span> special instructions &nbsp;<span className="text-green-400">●</span> crew assigned.</p>
            {openSections.trains && (
              <>
                {timetable.trains.length === 0 && (
                  <p className="text-xs text-slate-600 py-1">No trains yet</p>
                )}
                <div className="space-y-1">
                  {sortTrains(timetable.trains).map((train) => {
                    const hidden = hiddenTrainIds.has(train.id);
                    const hasNotes = !!train.notes;
                    const hasSpecialInstructions = train.stops.some((s) => !!s.special_instructions);
                    const assignedCrew = train.crew_id ? timetable.crews.find((c) => c.id === train.crew_id) : null;
                    return (
                    <div
                      key={train.id}
                      className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800 cursor-pointer transition-colors"
                      onClick={() => onEditTrain(train)}
                      onMouseEnter={() => onCrewTrainHover?.(train.id)}
                      onMouseLeave={() => onCrewTrainHover?.(null)}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/20"
                        style={{ background: train.color, opacity: hidden ? 0.35 : 1 }}
                      />
                      <span className={`flex-1 text-sm truncate ${hidden ? 'text-slate-600' : 'text-slate-300'}`}>{train.name}</span>
                      {(hasNotes || hasSpecialInstructions || assignedCrew) && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {hasNotes && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-blue-400"
                              title="Has train notes"
                            />
                          )}
                          {hasSpecialInstructions && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-amber-400"
                              title="Has special instructions"
                            />
                          )}
                          {assignedCrew && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-green-400"
                              title={`Crew: ${assignedCrew.name}`}
                            />
                          )}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleTrainVisibility(train.id); }}
                        title={hidden ? 'Show on graph' : 'Hide from graph'}
                        className="p-1 text-slate-600 hover:text-slate-300 rounded shrink-0 transition-colors"
                      >
                        {hidden ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditTrain(train); }}
                          className="p-1 text-slate-400 hover:text-slate-200 rounded"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(`train-${train.id}`); }}
                          className="p-1 text-slate-400 hover:text-red-400 rounded"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Crews ── */}
      {timetable && (
        <>
          <div className="border-t border-slate-800 mx-4" />
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => toggleSection('crews')}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors"
              >
                <Chevron open={openSections.crews} />
                Crew
              </button>
              <div className="flex items-center gap-2">
                {timetable.crews.length > 0 && (
                  <button
                    onClick={() => {
                      setAutoAssignOpen((v) => !v);
                      setAutoAssignCrewIds(new Set(timetable.crews.map((c) => c.id)));
                      setAutoAssignTrainIds(new Set(timetable.trains.filter((t) => !t.crew_id).map((t) => t.id)));
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                    title="Auto-assign trains to crews"
                  >
                    Auto-assign
                  </button>
                )}
                <button
                  onClick={() => { setNewCrew({ name: '', color: '#94a3b8' }); setEditingCrew(null); }}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  + Add
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 mb-2">Define operators for this session. Assign trains to crew in the train editor or use auto-assign.</p>
            {autoAssignWarning && autoAssignWarning.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-600/50 bg-amber-950/30 p-3 flex items-start gap-2">
                <span className="text-amber-400 text-xs mt-0.5">⚠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-300 mb-1">
                    Could not assign {autoAssignWarning.length} train{autoAssignWarning.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-0.5">
                    {autoAssignWarning.map((name) => (
                      <li key={name} className="text-xs text-amber-400/80 break-all">{name}</li>
                    ))}
                  </ul>
                </div>
                <button onClick={() => setAutoAssignWarning(null)} className="text-amber-600 hover:text-amber-400 text-xs ml-1 shrink-0">✕</button>
              </div>
            )}
            {autoAssignOpen && timetable.crews.length > 0 && (
              <div className="mb-3 rounded-lg border border-violet-700/50 bg-violet-950/30 p-3 space-y-3">
                <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">Crew pool</p>
                <div className="space-y-1.5">
                  {timetable.crews.map((crew) => (
                    <label key={crew.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={autoAssignCrewIds.has(crew.id)}
                        onChange={(e) => {
                          setAutoAssignCrewIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(crew.id); else next.delete(crew.id);
                            return next;
                          });
                        }}
                        className="accent-violet-500 w-3.5 h-3.5 shrink-0"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: crew.color }} />
                      <span className="text-xs text-slate-300 truncate group-hover:text-white transition-colors">{crew.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider pt-2 border-t border-violet-700/30">Train pool</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {timetable.trains.map((train) => (
                    <label key={train.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={autoAssignTrainIds.has(train.id)}
                        onChange={(e) => {
                          setAutoAssignTrainIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(train.id); else next.delete(train.id);
                            return next;
                          });
                        }}
                        className="accent-violet-500 w-3.5 h-3.5 shrink-0"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: train.color || '#94a3b8' }} />
                      <span className="text-xs text-slate-300 truncate group-hover:text-white transition-colors">{train.name}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-violet-700/30">
                  <input
                    type="checkbox"
                    checked={autoAssignOnlyUnassigned}
                    onChange={(e) => setAutoAssignOnlyUnassigned(e.target.checked)}
                    className="accent-violet-500 w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs text-slate-400">Only unassigned trains</span>
                </label>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      if (autoAssignCrewIds.size === 0 || autoAssignTrainIds.size === 0) return;
                      onAutoAssignCrews({ crewIds: [...autoAssignCrewIds], trainIds: [...autoAssignTrainIds], onlyUnassigned: autoAssignOnlyUnassigned })
                        .then((unassigned) => {
                          setAutoAssignOpen(false);
                          if (unassigned.length > 0) setAutoAssignWarning(unassigned);
                        });
                    }}
                    disabled={autoAssignCrewIds.size === 0 || autoAssignTrainIds.size === 0}
                    className="flex-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                  >
                    Assign
                  </button>
                  <button
                    onClick={() => setAutoAssignOpen(false)}
                    className="px-3 py-1.5 rounded text-slate-400 hover:bg-slate-700 text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {openSections.crews && (
              <div className="space-y-3">
                {timetable.crews.length === 0 && !newCrew && (
                  <p className="text-xs text-slate-600 py-1">No crew members yet</p>
                )}
                {(crewOrder
                  ? crewOrder.map((id) => timetable.crews.find((c) => c.id === id)).filter(Boolean)
                  : timetable.crews
                ).map((crew) => {
                  const assigned = sortTrains(timetable.trains.filter((t) => t.crew_id === crew!.id));
                  const overlaps = findOverlappingTrains(assigned);
                  const isEditing = editingCrew?.id === crew!.id;
                  return (
                    <div
                      key={crew!.id}
                      className="rounded-lg bg-slate-800/50 border border-slate-700/50 overflow-hidden"
                      draggable
                      onDragStart={() => {
                        dragCrewId.current = crew!.id;
                        setCrewOrder(timetable.crews.map((c) => c.id));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!dragCrewId.current || dragCrewId.current === crew!.id) return;
                        dragOverCrewId.current = crew!.id;
                        setCrewOrder((prev) => {
                          const ids = prev ? [...prev] : timetable.crews.map((c) => c.id);
                          const from = ids.indexOf(dragCrewId.current!);
                          const to = ids.indexOf(crew!.id);
                          if (from === -1 || to === -1) return prev;
                          ids.splice(to, 0, ids.splice(from, 1)[0]);
                          return ids;
                        });
                      }}
                      onDrop={() => {
                        if (crewOrder) onReorderCrews(crewOrder);
                        dragCrewId.current = null;
                        dragOverCrewId.current = null;
                      }}
                      onDragEnd={() => {
                        dragCrewId.current = null;
                        dragOverCrewId.current = null;
                        setCrewOrder(null);
                      }}
                    >
                      {isEditing ? (
                        <div className="p-2 flex items-center gap-2">
                          <input
                            type="color"
                            value={editingCrew.color}
                            onChange={(e) => setEditingCrew((prev) => prev ? { ...prev, color: e.target.value } : prev)}
                            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                            title="Crew colour"
                          />
                          <input
                            autoFocus
                            value={editingCrew.name}
                            onChange={(e) => setEditingCrew((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editingCrew.name.trim()) {
                                onUpdateCrew(editingCrew.id, { name: editingCrew.name.trim(), color: editingCrew.color });
                                setEditingCrew(null);
                              }
                              if (e.key === 'Escape') setEditingCrew(null);
                            }}
                            className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => {
                              if (editingCrew.name.trim()) {
                                onUpdateCrew(editingCrew.id, { name: editingCrew.name.trim(), color: editingCrew.color });
                              }
                              setEditingCrew(null);
                            }}
                            className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
                          >
                            Save
                          </button>
                          <button onClick={() => setEditingCrew(null)} className="text-xs px-2 py-1 rounded text-slate-400 hover:bg-slate-700">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="group flex items-center gap-2 px-3 py-2">
                          <span className="text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing shrink-0" title="Drag to reorder">
                            <GripIcon />
                          </span>
                          <span className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/20" style={{ background: crew!.color }} />
                          <span className="flex-1 text-sm font-medium text-slate-200 truncate">{crew!.name}</span>
                          {overlaps.size > 0 && (
                            <span
                              className="text-xs font-semibold text-red-400 shrink-0"
                              title="Scheduling conflict: overlapping trains"
                            >
                              ⚠ overlap
                            </span>
                          )}
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setEditingCrew({ id: crew!.id, name: crew!.name, color: crew!.color }); setNewCrew(null); }}
                              className="p-1 text-slate-400 hover:text-slate-200 rounded"
                              title="Edit crew"
                            >
                              <PencilIcon />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(`crew-${crew!.id}`)}
                              className="p-1 text-slate-400 hover:text-red-400 rounded"
                              title="Delete crew"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      )}
                      {assigned.length > 0 && (
                        <div className="border-t border-slate-700/50 px-3 py-1.5 space-y-0.5">
                          {assigned.map((train) => {
                            const [start, end] = trainTimeRange(train);
                            const hasOverlap = overlaps.has(train.id);
                            return (
                              <div
                                key={train.id}
                                className="group/row flex items-center gap-2 py-0.5 cursor-default rounded px-1 -mx-1 hover:bg-slate-700/40 transition-colors"
                                onMouseEnter={() => onCrewTrainHover?.(train.id)}
                                onMouseLeave={() => onCrewTrainHover?.(null)}
                              >
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ background: train.color }}
                                />
                                <span className={`flex-1 text-xs truncate ${hasOverlap ? 'text-red-300' : 'text-slate-400'}`}>
                                  {train.name}
                                </span>
                                <span className={`text-xs tabular-nums shrink-0 ${hasOverlap ? 'text-red-400' : 'text-slate-600'} group-hover/row:hidden`}>
                                  {start}–{end}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onUnassignTrain(train.id); }}
                                  className="hidden group-hover/row:flex items-center justify-center w-4 h-4 rounded shrink-0 text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                  title="Remove from crew"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {assigned.length === 0 && !isEditing && (
                        <div className="border-t border-slate-700/50 px-3 py-1.5">
                          <span className="text-xs text-slate-600 italic">No trains assigned</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* New crew inline form */}
                {newCrew && (
                  <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={newCrew.color}
                        onChange={(e) => setNewCrew((prev) => prev ? { ...prev, color: e.target.value } : prev)}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                        title="Crew colour"
                      />
                      <input
                        autoFocus
                        value={newCrew.name}
                        placeholder="Crew name"
                        onChange={(e) => setNewCrew((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newCrew.name.trim()) {
                            onAddCrew({ name: newCrew.name.trim(), color: newCrew.color });
                            setNewCrew(null);
                          }
                          if (e.key === 'Escape') setNewCrew(null);
                        }}
                        className="flex-1 min-w-0 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => {
                          if (newCrew.name.trim()) {
                            onAddCrew({ name: newCrew.name.trim(), color: newCrew.color });
                          }
                          setNewCrew(null);
                        }}
                        className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
                      >
                        Add
                      </button>
                      <button onClick={() => setNewCrew(null)} className="text-xs px-2 py-1 rounded text-slate-400 hover:bg-slate-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Stations ── */}
      {timetable && (
        <>
          <div className="border-t border-slate-800 mx-4" />
          <StationPanel
            stations={timetable.stations}
            open={openSections.stations}
            onToggle={() => toggleSection('stations')}
            onAdd={onAddStation}
            onUpdate={onUpdateStation}
            onDelete={onDeleteStation}
          />
        </>
      )}

      {/* ── Paths ── */}
      {timetable && (
        <>
          <div className="border-t border-slate-800 mx-4" />
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => toggleSection('paths')}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors"
              >
                <Chevron open={openSections.paths} />
                Paths
              </button>
              <button
                onClick={onNewPath}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                + Add
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-2">Reusable route templates with timing. Apply a path when adding a new train to pre-fill its stops.</p>
            {openSections.paths && (
              <>
                {timetable.paths.length === 0 && (
                  <p className="text-xs text-slate-600 py-1">No paths yet</p>
                )}
                <div className="space-y-1">
                  {timetable.paths.map((path) => (
                    <div
                      key={path.id}
                      className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800 cursor-pointer transition-colors"
                      onClick={() => onEditPath(path)}
                    >
                      <RouteIcon />
                      <span className="flex-1 text-sm text-slate-300 truncate">{path.name}</span>
                      <span className="text-xs text-slate-600">{path.stops.length} stops</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditPath(path); }}
                          className="p-1 text-slate-400 hover:text-slate-200 rounded"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(`path-${path.id}`); }}
                          className="p-1 text-slate-400 hover:text-red-400 rounded"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-6 max-w-xs w-full mx-4">
            <h3 className="text-white font-semibold mb-2">Confirm delete</h3>
            <p className="text-slate-400 text-sm mb-5">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmDelete.startsWith('train-')) {
                    onDeleteTrain(confirmDelete.slice(6));
                  } else if (confirmDelete.startsWith('path-')) {
                    onDeletePath(confirmDelete.slice(5));
                  } else if (confirmDelete.startsWith('crew-')) {
                    onDeleteCrew(confirmDelete.slice(5));
                  } else {
                    onDeleteTimetable(confirmDelete);
                  }
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trainStartMinute(train: Train): number {
  let earliest = Infinity;
  for (const s of train.stops) {
    const t = s.arrival ?? s.departure;
    if (t) {
      const [h, m] = t.split(':').map(Number);
      const min = h * 60 + m;
      if (min < earliest) earliest = min;
    }
  }
  return earliest === Infinity ? 0 : earliest;
}

function sortTrains(trains: Train[]): Train[] {
  return [...trains].sort((a, b) => trainStartMinute(a) - trainStartMinute(b));
}

/** Returns [startHH:MM, endHH:MM] for a train's first and last timed stop. */
function trainTimeRange(train: Train): [string, string] {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const s of train.stops) {
    if (s.arrival) {
      const [h, m] = s.arrival.split(':').map(Number);
      const t = h * 60 + m;
      if (t < earliest) earliest = t;
      if (t > latest) latest = t;
    }
    if (s.departure) {
      const [h, m] = s.departure.split(':').map(Number);
      const t = h * 60 + m;
      if (t < earliest) earliest = t;
      if (t > latest) latest = t;
    }
  }
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  if (!isFinite(earliest)) return ['--:--', '--:--'];
  return [fmt(earliest), fmt(latest)];
}

/** Returns a Set of train IDs that have a time overlap with at least one other train in the list. */
function findOverlappingTrains(trains: Train[]): Set<string> {
  const ranges = trains.map((t) => {
    const [s, e] = trainTimeRange(t);
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    return { id: t.id, start: toMin(s), end: toMin(e) };
  });
  const overlapping = new Set<string>();
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      // Overlap if neither is entirely before the other
      if (a.start < b.end && b.start < a.end) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return overlapping;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CatsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function ActiveFlagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}
