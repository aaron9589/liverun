import { useEffect, useRef, useState, useCallback, type InputHTMLAttributes } from 'react';
import { useJmriRoster } from '../hooks/useJmriRoster';
import { RosterCombobox } from './RosterCombobox';
import type { Station, Train, TrainStop, TrainRequest, Path, PathStop, Crew } from '../types';

interface StopForm {
  stationId: string;
  stationName: string;
  distance: number | null;
  arrival: string;
  departure: string;
  dwell: string; // minutes, used to compute departure and cascade
  specialInstructions: string;
  locationAlias: string;
}

interface Props {
  train?: Train;
  stations: Station[];
  paths: Path[];
  crews?: Crew[];
  existingColors?: string[];
  distanceUnit?: 'km' | 'mi';
  onDraftChange: (draft: Train) => void;
  onSave: (data: TrainRequest) => void;
  onDelete?: () => void;
  onClose: () => void;
  jmriUrl?: string;
}

const PRESET_COLORS = [
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#eab308', // yellow-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#06b6d4', // cyan-500
  '#0ea5e9', // sky-500
  '#3b82f6', // blue-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#d946ef', // fuchsia-500
  '#ec4899', // pink-500
  '#f43f5e', // rose-500
  '#fbbf24', // amber-400  (gold tone)
  '#4ade80', // green-400  (bright mint)
  '#38bdf8', // sky-400    (light sky)
  '#c084fc', // purple-400 (soft purple)
];

export function TrainEditor({ train, stations, paths, crews = [], existingColors, distanceUnit = 'km', onDraftChange, onSave, onDelete, onClose, jmriUrl }: Props) {
  const roster = useJmriRoster(jmriUrl);
  // Escape closes the editor like Cancel. Inner controls that use Escape
  // themselves (e.g. an open roster dropdown) stop propagation first.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const sorted = [...stations].sort((a, b) => (a.graph_pos ?? 0) - (b.graph_pos ?? 0));
  // Keep original stops around so we can restore all-stations view if path is deselected
  const trainStopsRef = useRef(train?.stops);

  const [name, setName] = useState(train?.name ?? '');
  const [color, setColor] = useState(() => {
    if (train?.color) return train.color;
    const used = existingColors ?? [];
    const unused = PRESET_COLORS.filter((c) => !used.includes(c));
    const pool = unused.length > 0 ? unused : PRESET_COLORS;
    return pool[Math.floor(Math.random() * pool.length)];
  });
  const [notes, setNotes] = useState(train?.notes ?? '');
  const [trainIdField, setTrainIdField] = useState(train?.train_id ?? '');
  const [direction, setDirection] = useState(train?.direction ?? '');
  const [crewId, setCrewId] = useState(train?.crew_id ?? '');
  const [stops, setStops] = useState<StopForm[]>(() => buildStopForms(sorted, train?.stops));
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Sync form → draft for live graph preview ─────────────────
  const buildDraft = useCallback((): Train => {
    const draftStops: TrainStop[] = stops
      .filter((s) => s.arrival || s.departure)
      .map((s) => ({
        id: `draft-${s.stationId}`,
        train_id: train?.id ?? '__new__',
        station_id: s.stationId,
        arrival: s.arrival || null,
        departure: s.departure || null,
        special_instructions: s.specialInstructions || undefined,
        location_alias: s.locationAlias || null,
      }));

    return {
      id: train?.id ?? '__new__',
      timetable_id: train?.timetable_id ?? '',
      name: name || '(unnamed)',
      color,
      notes,
      train_id: trainIdField,
      direction,
      crew_id: crewId || undefined,
      stops: draftStops,
    };
  }, [name, color, notes, trainIdField, direction, crewId, stops, train]);

  useEffect(() => {
    onDraftChange(buildDraft());
  }, [buildDraft, onDraftChange]);

  // ── Handlers ─────────────────────────────────────────────────

  function getPathStops(): PathStop[] | null {
    if (!selectedPathId) return null;
    const path = paths.find((p) => p.id === selectedPathId);
    return path ? [...path.stops].sort((a, b) => a.sort_order - b.sort_order) : null;
  }

  function updateStop(idx: number, field: 'arrival' | 'departure' | 'dwell', value: string) {
    const pathStops = getPathStops();
    setStops((prev) => {
      // Apply the raw field change
      let next = prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s));

      // If arrival or dwell changed, recompute departure for this stop
      if (field === 'arrival' || field === 'dwell') {
        const s = next[idx];
        if (s.arrival && s.dwell !== '') {
          next = next.map((r, i) =>
            i === idx ? { ...r, departure: addMinutes(s.arrival, Number(s.dwell)) } : r
          );
        }
      }

      // If departure was manually changed and arrival is set, back-compute dwell
      if (field === 'departure') {
        const s = next[idx];
        if (s.arrival && s.departure) {
          const inferredDwell = diffMinutes(s.arrival, s.departure);
          next = next.map((r, i) =>
            i === idx ? { ...r, dwell: inferredDwell >= 0 ? String(inferredDwell) : r.dwell } : r
          );
        }
      }

      // Cascade in the direction of travel whenever departure effectively changed
      if (next[idx].departure) {
        // Paths are already stored in travel order → always forward.
        // For free-form stops (graph_pos order) detect direction from the
        // *previous* (fully-cascaded) state, not from `next`. At this point
        // `next` only has the edited stop's departure updated — downstream
        // stops are still at their old times. If the new departure crosses
        // the old time of the very next stop (e.g. Kiama→10:05 while Bombo
        // is still showing 10:00), detectDirection(next) would incorrectly
        // flip the direction, causing the cascade to go the wrong way.
        const direction = pathStops ? 'down' : detectDirection(prev);
        next = cascadeFrom(idx, next, pathStops, prev, direction);
      }

      return next;
    });
  }

  function inferDeparture(idx: number) {
    // If arrival is set but departure isn't, populate departure (respecting dwell)
    setStops((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        if (s.arrival && !s.departure) {
          const dep = s.dwell !== '' ? addMinutes(s.arrival, Number(s.dwell)) : s.arrival;
          return { ...s, departure: dep };
        }
        return s;
      })
    );
  }

  function handleStopBlur(idx: number) {
    // If this is the first timed stop and arrival == departure, drop arrival (redundant at origin)
    setStops((prev) => {
      const s = prev[idx];
      if (!s.arrival || !s.departure || s.arrival !== s.departure) return prev;
      const timed = prev.filter((r) => r.arrival || r.departure);
      const firstId = [...timed].sort((a, b) => stopMinutes(a) - stopMinutes(b))[0]?.stationId;
      if (s.stationId !== firstId) return prev;
      return prev.map((r, i) => i === idx ? { ...r, arrival: '' } : r);
    });
  }

  function handlePathChange(pathId: string) {
    const pid = pathId || null;
    setSelectedPathId(pid);
    if (!pid) {
      setStops(buildStopForms(sorted, trainStopsRef.current));
      return;
    }
    const path = paths.find((p) => p.id === pid);
    if (!path) return;
    const currentMap = new Map(stops.map((s) => [s.stationId, s]));
    const newStops = [...path.stops]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((ps) => {
        const station = sorted.find((s) => s.id === ps.station_id);
        const existing = currentMap.get(ps.station_id);
        return {
          stationId: ps.station_id,
          stationName: station?.name ?? 'Unknown',
          distance: station?.distance ?? 0,
          arrival: existing?.arrival ?? '',
          departure: existing?.departure ?? '',
          dwell: existing?.dwell ?? '',
          specialInstructions: existing?.specialInstructions ?? '',
          locationAlias: existing?.locationAlias ?? '',
        };
      });
    setStops(newStops);
  }

  function autoFill() {
    if (!selectedPathId) return;
    const path = paths.find((p) => p.id === selectedPathId);
    if (!path) return;
    const firstDep = stops[0]?.departure;
    if (!firstDep) {
      setError('Enter a departure time for the first stop to auto-fill');
      return;
    }
    setError('');
    const pathStops = [...path.stops].sort((a, b) => a.sort_order - b.sort_order);
    setStops((prev) => {
      const next = [...prev];
      let prevDep = firstDep;
      for (let i = 1; i < next.length; i++) {
        const ps = pathStops[i];
        if (!ps) break;
        const arrival = addMinutes(prevDep, ps.travel_time_from_prev);
        // Last stop is arrival-only — no departure or dwell
        if (i === next.length - 1) {
          next[i] = { ...next[i], arrival, departure: '', dwell: '' };
        } else {
          const departure = addMinutes(arrival, ps.dwell_time);
          next[i] = { ...next[i], arrival, departure };
          prevDep = departure;
        }
      }
      return next;
    });
  }

  function handleSave() {
    if (!name.trim()) {
      setError('Train name is required');
      return;
    }
    const hasAnyStop = stops.some((s) => s.arrival || s.departure);
    if (!hasAnyStop) {
      setError('Add at least one stop time');
      return;
    }
    setError('');

    const timedStops = stops.filter((s) => s.arrival || s.departure);
    const sortedByTime = [...timedStops].sort((a, b) => stopMinutes(a) - stopMinutes(b));
    const firstTimedId = sortedByTime[0]?.stationId;
    const lastTimedId = sortedByTime[sortedByTime.length - 1]?.stationId;
    const saveStops = timedStops.map((s) => {
      // Stops with a true dwell (arrival and departure differ) keep both times
      // even at terminal positions. Same arrival == departure is treated as terminal.
      const hasDwell = !!(s.arrival && s.departure && s.arrival !== s.departure);
      return {
        stationId: s.stationId,
        arrival: (s.stationId === firstTimedId && !hasDwell) ? null : (s.arrival || null),
        departure: (s.stationId === lastTimedId && !hasDwell) ? null : (s.departure || null),
        specialInstructions: s.specialInstructions || undefined,
        locationAlias: s.locationAlias || undefined,
      };
    });

    onSave({ id: train?.id, name: name.trim(), color, notes, trainId: trainIdField, direction, crewId: crewId || undefined, stops: saveStops });
  }

  // Derived: which rows get the arrival-only / departure-only treatment.
  // Use chronological time order (not graph_pos) so trains running in reverse
  // direction (descending graph_pos) are handled correctly.
  const timedStopsForOrder = stops.filter((s) => s.arrival || s.departure);
  const [firstTimedId, lastTimedId] = (() => {
    if (timedStopsForOrder.length < 2) return [null, null];
    const sorted = [...timedStopsForOrder].sort((a, b) => stopMinutes(a) - stopMinutes(b));
    return [sorted[0].stationId, sorted[sorted.length - 1].stationId];
  })();

  // Keep form state consistent with the terminal-stop rule: whenever the first
  // or last timed stop changes, clear the disallowed field so there is no
  // hidden stale value that could be saved.
  // Exception: stops with a dwell (both arrival and departure) are preserved —
  // the dwell is intentional and should not be stripped.
  useEffect(() => {
    if (!firstTimedId && !lastTimedId) return;
    setStops((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.stationId === firstTimedId && s.arrival && (!s.departure || s.arrival === s.departure)) {
          changed = true;
          return { ...s, arrival: '' };
        }
        if (s.stationId === lastTimedId && (s.departure || s.dwell) && !s.arrival) {
          changed = true;
          return { ...s, departure: '', dwell: '' };
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, [firstTimedId, lastTimedId]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-in panel from right */}
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-lg font-semibold text-white">
            {train ? 'Edit train' : 'New train'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Path selector — only shown when creating a new train so the template can be applied */}
          {paths.length > 0 && !train && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Path (optional)</label>
              <select
                value={selectedPathId ?? ''}
                onChange={(e) => handlePathChange(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="">— No path (show all stations) —</option>
                {paths.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedPathId && (
                <p className="text-xs text-slate-500 mt-1">
                  Showing {stops.length} station{stops.length !== 1 ? 's' : ''} for this path.
                  Set the first departure time then use Auto-fill.
                </p>
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Train name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 1A15 Express"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Line colour</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid white` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
              {/* Custom picker */}
              <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer border-2 border-dashed border-slate-600 hover:border-slate-400 transition-colors flex items-center justify-center" title="Custom colour">
                <span className="text-xs text-slate-500">+</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </label>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="w-4 h-4 rounded-full" style={{ background: color }} />
              <span className="font-mono text-xs">{color}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes…"
              rows={2}
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 text-sm resize-none"
            />
            <p className="text-xs text-slate-600 mt-1">Shown as Train Notes on the first stop in the live API output.</p>
          </div>

          {/* Train metadata */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Train ID</label>
              <RosterCombobox
                value={trainIdField}
                onChange={setTrainIdField}
                roster={roster}
                placeholder="JMRI roster entry"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Direction</label>
              <input
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="e.g. FWD"
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Crew assignment */}
          {crews.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Crew</label>
              <select
                value={crewId}
                onChange={(e) => setCrewId(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="">— Unassigned —</option>
                {crews.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Stop times table */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium text-slate-400 flex-1">
                Stop times
                <span className="ml-1 text-slate-600 font-normal">— leave blank to skip a station</span>
              </label>
              {selectedPathId && (
                <button
                  type="button"
                  onClick={autoFill}
                  className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors"
                  title="Auto-fill stops from first departure using path timings"
                >
                  ⚡ Auto-fill
                </button>
              )}
            </div>

            {sorted.length === 0 && (
              <p className="text-xs text-slate-600 py-2">Add stations to the timetable first</p>
            )}

            {sorted.length > 0 && (
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_100px_100px_58px] gap-0 bg-slate-800 border-b border-slate-700 text-xs text-slate-500 font-medium">
                  <div className="px-3 py-2">Station</div>
                  <div className="px-2 py-2 border-l border-slate-700">Arrive</div>
                  <div className="px-2 py-2 border-l border-slate-700">Depart</div>
                  <div className="px-2 py-2 border-l border-slate-700" title="Dwell time in minutes — auto-computes departure and cascades subsequent stops">Dwell</div>
                </div>

                {/* Rows */}
                {stops.map((stop, idx) => (
                  <div
                    key={stop.stationId}
                    className={`border-b border-slate-800 last:border-0 ${
                      stop.arrival || stop.departure ? 'bg-slate-800/40' : ''
                    }`}
                  >
                    {/* Times row */}
                    <div className="grid grid-cols-[1fr_100px_100px_58px] gap-0">
                    {/* Station cell */}
                    <div className="px-3 py-2 flex flex-col justify-center gap-0.5">
                      <span className="text-sm text-slate-300">{stop.stationName}</span>
                      <span className="text-xs text-slate-600">{stop.distance != null ? `${stop.distance} ${distanceUnit ?? 'km'}` : ''}</span>
                      {sorted.find((s) => s.id === stop.stationId)?.alias_enabled && (stop.arrival || stop.departure || stop.locationAlias) && (
                        <input
                          type="text"
                          value={stop.locationAlias}
                          onChange={(e) =>
                            setStops((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, locationAlias: e.target.value } : s
                              )
                            )
                          }
                          placeholder="Alias…"
                          title="Location alias — overrides the station name in reports and tooltips for this train"
                          className="bg-transparent text-xs text-sky-300 focus:outline-none focus:bg-slate-700/50 px-1 py-0.5 rounded border border-slate-700/50 focus:border-sky-500/50 placeholder:text-slate-700 w-full"
                        />
                      )}
                    </div>

                    {/* Arrival — hidden for first timed stop unless it has a dwell */}
                    <div className="border-l border-slate-800 flex items-center px-1">
                      {stop.stationId === firstTimedId && !stop.departure ? (
                        <span className="w-full text-center text-slate-600 text-sm px-1 py-1.5 select-none" title="First stop is departure only">—</span>
                      ) : (
                        <TimeInput
                          value={stop.arrival}
                          onChange={(v) => updateStop(idx, 'arrival', v)}
                          onBlur={() => { inferDeparture(idx); handleStopBlur(idx); }}
                          className="w-full bg-transparent text-sm text-slate-200 focus:outline-none focus:bg-slate-700/50 px-1 py-1.5 rounded"
                        />
                      )}
                    </div>

                    {/* Departure — hidden for last timed stop unless it has a dwell */}
                    <div className="border-l border-slate-800 flex items-center px-1">
                      {stop.stationId === lastTimedId && !stop.arrival ? (
                        <span className="w-full text-center text-slate-600 text-sm px-1 py-1.5 select-none" title="Last stop is arrival only">—</span>
                      ) : (
                        <TimeInput
                          value={stop.departure}
                          onChange={(v) => updateStop(idx, 'departure', v)}
                          onBlur={() => handleStopBlur(idx)}
                          className="w-full bg-transparent text-sm text-slate-200 focus:outline-none focus:bg-slate-700/50 px-1 py-1.5 rounded"
                        />
                      )}
                    </div>

                    {/* Dwell — hidden for last stop unless it has a dwell (both times) */}
                    <div className="border-l border-slate-800 flex items-center px-1">
                      {stop.stationId === lastTimedId && !stop.arrival ? (
                        <span className="w-full" />
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={stop.dwell}
                          onChange={(e) => updateStop(idx, 'dwell', e.target.value)}
                          placeholder="min"
                          title="Dwell time in minutes"
                          className="w-full bg-transparent text-sm text-slate-200 focus:outline-none focus:bg-slate-700/50 px-1 py-1.5 rounded text-center placeholder:text-slate-600"
                        />
                      )}
                    </div>
                    </div>

                    {/* Special instructions sub-row — shown for any timed stop */}
                    {(stop.arrival || stop.departure || stop.specialInstructions) && (
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          value={stop.specialInstructions}
                          onChange={(e) =>
                            setStops((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, specialInstructions: e.target.value } : s
                              )
                            )
                          }
                          placeholder="Special instructions for this stop…"
                          className="w-full bg-transparent text-xs text-amber-200 focus:outline-none focus:bg-slate-700/50 px-1 py-1 rounded border border-slate-700/50 focus:border-amber-500/50 placeholder:text-slate-600"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-800 shrink-0">
          {onDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 text-sm rounded-lg text-red-400 hover:bg-red-950/40 border border-red-900/50 hover:border-red-800 transition-colors"
            >
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-slate-400 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
          >
            Save train
          </button>
        </div>
      </aside>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-6 max-w-xs w-full mx-4">
            <h3 className="text-white font-semibold mb-2">Delete "{train?.name}"?</h3>
            <p className="text-slate-400 text-sm mb-5">This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete?.();
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stopMinutes(s: StopForm): number {
  const t = s.departure || s.arrival;
  if (!t) return Infinity;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function buildStopForms(stations: Station[], existingStops?: TrainStop[]): StopForm[] {
  const stopMap = new Map(existingStops?.map((s) => [s.station_id, s]) ?? []);
  return stations.map((s) => {
    const existing = stopMap.get(s.id);
    return {
      stationId: s.id,
      stationName: s.name,
      distance: s.distance,
      arrival: existing?.arrival ?? '',
      departure: existing?.departure ?? '',
      dwell: '',
      specialInstructions: existing?.special_instructions ?? '',
      locationAlias: existing?.location_alias ?? '',
    };
  });
}

function cascadeFrom(
  fromIdx: number,
  stops: StopForm[],
  pathStops: PathStop[] | null,
  original: StopForm[],
  direction: 'down' | 'up' = 'down',
): StopForm[] {
  const next = [...stops];
  let prevDep = next[fromIdx].departure;
  if (!prevDep) return next;

  let prevOrigDep = original[fromIdx].departure;

  const indices =
    direction === 'down'
      ? Array.from({ length: next.length - fromIdx - 1 }, (_, k) => fromIdx + 1 + k)
      : Array.from({ length: fromIdx }, (_, k) => fromIdx - 1 - k);

  for (const i of indices) {
    // Skip stops that were blank — don't fill them in
    if (!original[i].arrival && !original[i].departure) continue;

    let travelMins: number;
    if (pathStops) {
      // Path stops are in travel order; travel_time_from_prev is always
      // relative to the previous entry in sort_order (i.e. direction === 'down').
      const ps = pathStops[i];
      travelMins = ps ? (ps.travel_time_from_prev ?? 0) : 0;
    } else {
      // Infer travel time from the original schedule gap:
      //   arrival at next-in-travel stop − departure from previous-in-travel stop
      // This is positive for both up and down directions as long as times are
      // monotonically increasing along the direction of travel.
      if (!prevOrigDep || !original[i].arrival) break;
      travelMins = diffMinutes(prevOrigDep, original[i].arrival);
      if (travelMins < 0) travelMins = 0;
    }

    const arrival = addMinutes(prevDep, travelMins);
    const origDwell =
      original[i].arrival && original[i].departure
        ? diffMinutes(original[i].arrival, original[i].departure)
        : 0;
    const dwellMins = next[i].dwell !== '' ? Number(next[i].dwell) : origDwell;
    const departure = addMinutes(arrival, dwellMins);

    next[i] = { ...next[i], arrival, departure };
    prevDep = departure;
    prevOrigDep = original[i].departure;
  }
  return next;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Determine whether a train travels down (times increase with array index) or
// up (times decrease with array index) by comparing the first and last timed stops.
function detectDirection(stops: StopForm[]): 'down' | 'up' {
  const timed = stops
    .map((s, i) => ({
      i,
      min: s.departure ? timeToMin(s.departure) : s.arrival ? timeToMin(s.arrival) : -1,
    }))
    .filter((s) => s.min >= 0);
  if (timed.length < 2) return 'down';
  return timed[0].min <= timed[timed.length - 1].min ? 'down' : 'up';
}

// Safari renders a default time (e.g. 12:30 PM) for <input type="time" value="">
// instead of the blank --:-- -- placeholder that other browsers show.
// Fix: render as type="text" when empty and not focused; switch to type="time" on focus.
function TimeInput({ value, onChange, onBlur, className, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [focused, setFocused] = useState(false);
  const asTime = value !== '' || focused;
  return (
    <input
      {...rest}
      type={asTime ? 'time' : 'text'}
      value={value}
      placeholder={asTime ? undefined : '--:-- --'}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      className={className}
    />
  );
}

function diffMinutes(from: string, to: string): number {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let diff = th * 60 + tm - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
