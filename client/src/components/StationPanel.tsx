import { useState } from 'react';
import type { Station } from '../types';

interface Props {
  stations: Station[];
  open?: boolean;
  onToggle?: () => void;
  onAdd: (data: { name: string; shortCode: string; distance: number | null; graphPos: number }) => void;
  onUpdate: (
    id: string,
    data: { name: string; shortCode: string; distance: number | null; graphPos: number; sortOrder: number }
  ) => void;
  onDelete: (id: string) => void;
}

interface StationFormData {
  name: string;
  shortCode: string;
  distance: string;   // optional km display label
  graphPos: string;   // required Y-axis position
}

const EMPTY: StationFormData = { name: '', shortCode: '', distance: '', graphPos: '' };

export function StationPanel({ stations, open, onToggle, onAdd, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<StationFormData | null>(null);
  const [editForm, setEditForm] = useState<StationFormData>(EMPTY);
  const [error, setError] = useState('');

  const sorted = [...stations].sort((a, b) => (a.graph_pos ?? 0) - (b.graph_pos ?? 0));

  function startAdd() {
    if (open === false && onToggle) onToggle();
    setAddForm(EMPTY);
    setEditingId(null);
    setError('');
  }

  function startEdit(s: Station) {
    setEditingId(s.id);
    setEditForm({
      name: s.name,
      shortCode: s.short_code,
      distance: s.distance != null ? String(s.distance) : '',
      graphPos: String(s.graph_pos ?? 0),
    });
    setAddForm(null);
    setError('');
  }

  function cancelAll() {
    setEditingId(null);
    setAddForm(null);
    setError('');
  }

  function validateForm(f: StationFormData): string {
    if (!f.name.trim()) return 'Name is required';
    if (f.graphPos === '' || isNaN(Number(f.graphPos))) return 'Graph position must be a number';
    if (f.distance !== '' && isNaN(Number(f.distance))) return 'Km label must be a number if set';
    return '';
  }

  async function commitAdd() {
    if (!addForm) return;
    const err = validateForm(addForm);
    if (err) { setError(err); return; }
    onAdd({
      name: addForm.name.trim(),
      shortCode: addForm.shortCode.trim(),
      distance: addForm.distance !== '' ? Number(addForm.distance) : null,
      graphPos: Number(addForm.graphPos),
    });
    setAddForm(null);
    setError('');
  }

  async function commitEdit(s: Station) {
    const err = validateForm(editForm);
    if (err) { setError(err); return; }
    onUpdate(s.id, {
      name: editForm.name.trim(),
      shortCode: editForm.shortCode.trim(),
      distance: editForm.distance !== '' ? Number(editForm.distance) : null,
      graphPos: Number(editForm.graphPos),
      sortOrder: s.sort_order,
    });
    setEditingId(null);
    setError('');
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-1">
        {onToggle ? (
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 transition-colors"
          >
            <Chevron open={open ?? true} />
            Stations
          </button>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Stations
          </span>
        )}
        <button
          onClick={startAdd}
          className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
        >
          + Add
        </button>
      </div>
      <p className="text-xs text-slate-600 mb-2">Define the stops on the line. Graph position controls vertical order on the train graph.</p>

      {open === false ? null : (
        <>
      {error && (
        <p className="text-xs text-red-400 mb-2 bg-red-950/30 px-2 py-1 rounded">{error}</p>
      )}

      {/* Station list */}
      <div className="space-y-1">
        {sorted.length === 0 && !addForm && (
          <p className="text-xs text-slate-600 py-1">No stations yet</p>
        )}

        {sorted.map((s) =>
          editingId === s.id ? (
            /* ── Edit row ── */
            <div key={s.id} className="rounded-lg bg-slate-800 border border-slate-700 p-2 space-y-2">
              <input
                autoFocus
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Station name"
                className="w-full rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={editForm.shortCode}
                  onChange={(e) => setEditForm({ ...editForm, shortCode: e.target.value })}
                  placeholder="Code"
                  maxLength={6}
                  className="min-w-0 rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={editForm.graphPos}
                  onChange={(e) => setEditForm({ ...editForm, graphPos: e.target.value })}
                  placeholder="Position *"
                  title="Graph position (Y-axis placement)"
                  className="min-w-0 rounded bg-slate-900 border border-blue-800 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={editForm.distance}
                onChange={(e) => setEditForm({ ...editForm, distance: e.target.value })}
                placeholder="km label (optional)"
                title="Km label (display only, optional)"
                className="w-full rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={cancelAll}
                  className="px-3 py-1 text-xs rounded text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => commitEdit(s)}
                  className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { onDelete(s.id); cancelAll(); }}
                  className="px-3 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800 text-red-300 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            /* ── Display row ── */
            <div
              key={s.id}
              className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800 cursor-pointer transition-colors"
              onClick={() => startEdit(s)}
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-300 truncate block">{s.name}</span>
                <span className="text-xs text-slate-600">
                  {s.short_code ? `${s.short_code} · ` : ''}pos {s.graph_pos ?? 0}
                  {s.distance != null ? ` · ${s.distance} km` : ''}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); startEdit(s); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-300 transition-all rounded"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
          )
        )}

        {/* ── Add new station form ── */}
        {addForm !== null && (
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-2 space-y-2 mt-1">
            <input
              autoFocus
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="Station name"
              onKeyDown={(e) => e.key === 'Enter' && commitAdd()}
              className="w-full rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={addForm.shortCode}
                onChange={(e) => setAddForm({ ...addForm, shortCode: e.target.value })}
                placeholder="Code"
                maxLength={6}
                className="min-w-0 rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                inputMode="decimal"
                value={addForm.graphPos}
                onChange={(e) => setAddForm({ ...addForm, graphPos: e.target.value })}
                placeholder="Position *"
                title="Graph position (Y-axis placement)"
                className="min-w-0 rounded bg-slate-900 border border-blue-800 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={addForm.distance}
              onChange={(e) => setAddForm({ ...addForm, distance: e.target.value })}
              placeholder="km label (optional)"
              title="Km label (display only, optional)"
              className="w-full rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelAll}
                className="px-3 py-1 text-xs rounded text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={commitAdd}
                className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

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
