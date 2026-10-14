/**
 * Pure-JSON file database — no native modules required.
 *
 * All timetable data is stored in a single JSON file. Each timetable
 * embeds its stations and trains (with stops) for fast, simple access.
 *
 * Writes use a tmp-file → rename pattern for crash-safety.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = (() => {
  const raw = process.env.DB_PATH
    ? process.env.DB_PATH.replace(/\.db$/, '.json')
    : path.join(__dirname, 'data', 'train-graph.json');
  const resolved = path.resolve(raw);
  // In production (Docker) confine the DB file to the declared data directory
  // so that a misconfigured or tampered DB_PATH cannot redirect reads/writes
  // to arbitrary host paths.
  if (process.env.NODE_ENV === 'production') {
    const allowed = path.resolve('/app/server/data');
    if (!resolved.startsWith(allowed + path.sep) && resolved !== path.join(allowed, path.basename(resolved))) {
      throw new Error(`DB_PATH must be within ${allowed} in production (got ${resolved})`);
    }
  }
  return resolved;
})();

/** @returns {{ timetables: object[] }} */
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { timetables: [] };
  }
}

/** Atomically write the DB to disk. */
function writeDB(data) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

/** Returns the full timetable object (with stations & trains), or null. */
function getTimetable(id) {
  const { timetables } = readDB();
  return timetables.find((t) => t.id === id) ?? null;
}

// ── Change notifications ───────────────────────────────────────────────────
// Every timetable mutation bumps tt.rev and tells registered listeners, so the
// live sync socket (server/sync.js) can push it to clients. Listeners receive
// { type: 'updated', timetableId, rev, notify }.

const changeListeners = new Set();

/** Registers a change listener. Returns a function that unregisters it. */
function onTimetableChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChange(event) {
  for (const listener of changeListeners) {
    try { listener(event); } catch (err) { console.error('Timetable change listener failed:', err); }
  }
}

/**
 * Persist a mutation to a specific timetable. fn receives the timetable and may mutate it.
 * Bumps tt.rev. notify:false marks the change as not worth a 'timetable-updated'
 * broadcast (e.g. train run status, which has its own 'completions' message).
 */
function mutateTimetable(id, fn, { notify = true } = {}) {
  const db = readDB();
  const idx = db.timetables.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const tt = db.timetables[idx];
  fn(tt);
  tt.updated_at = new Date().toISOString();
  tt.rev = (tt.rev || 0) + 1;
  writeDB(db);
  emitChange({ type: 'updated', timetableId: id, rev: tt.rev, notify });
  return tt;
}

// ── Layout-wide configuration ──────────────────────────────────────────────
// Physical-layout settings shared by every timetable (JMRI, guard panel, …).
// Stored under db.layout; always read through getLayout() so callers see
// defaults for any section that hasn't been saved yet.

const NEUTRAL_BOARDING_MODEL = {
  max_passengers: 60,
  demand_curve: [['00:00', 1], ['24:00', 1]],
  rules: [],
  position: { origin: 1, intermediate: 1, terminus: 0 },
  spread: 0.15,
};

// Neutral defaults only (spec D13): layout-specific values belong in the
// layout's own config, e.g. docs/layout.example.json.
const LAYOUT_DEFAULTS = {
  jmri: { url: '' },
  guard: { event_alert_sound: '' },
  train_profiles: [],
  boarding: {
    ...NEUTRAL_BOARDING_MODEL,
    tick_s: 1,
    jitter: 0.3,
    flow_rate: 3,
    straggler_threshold: 5,
    straggler_rate: 0.5,
    runner_chance: 0.2,
    runner_count: [1, 3],
    runner_delay_s: [2, 6],
    start_delay_s: 4,
    doil_off_delay_s: 8,
    show_alighting: false,
    alighting: { ...NEUTRAL_BOARDING_MODEL, position: { origin: 0, intermediate: 1, terminus: 1.5 } },
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge stored values over defaults. Arrays and scalars replace wholesale. */
function mergeLayout(defaults, stored) {
  if (!isPlainObject(stored)) return structuredClone(defaults);
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = isPlainObject(defaults[key])
      ? mergeLayout(defaults[key], stored[key])
      : (stored[key] !== undefined ? stored[key] : structuredClone(defaults[key]));
  }
  return out;
}

/** Returns the layout config with defaults applied. Unknown keys are dropped. */
function getLayout() {
  return mergeLayout(LAYOUT_DEFAULTS, readDB().layout);
}

/** Replaces the stored layout config (caller validates). Returns the merged result. */
function setLayout(layout) {
  const db = readDB();
  db.layout = mergeLayout(LAYOUT_DEFAULTS, layout);
  writeDB(db);
  return db.layout;
}

module.exports = { readDB, writeDB, getTimetable, mutateTimetable, onTimetableChange, uuidv4, getLayout, setLayout, LAYOUT_DEFAULTS };
