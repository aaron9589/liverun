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

/** Persist a mutation to a specific timetable. fn receives the timetable and may mutate it. */
function mutateTimetable(id, fn) {
  const db = readDB();
  const idx = db.timetables.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  fn(db.timetables[idx]);
  db.timetables[idx].updated_at = new Date().toISOString();
  writeDB(db);
  return db.timetables[idx];
}

// ── Layout-wide configuration ──────────────────────────────────────────────
// Physical-layout settings shared by every timetable (JMRI, guard panel, …).
// Stored under db.layout; always read through getLayout() so callers see
// defaults for any section that hasn't been saved yet.

const LAYOUT_DEFAULTS = {
  jmri: { url: '' },
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

module.exports = { readDB, writeDB, getTimetable, mutateTimetable, uuidv4, getLayout, setLayout, LAYOUT_DEFAULTS };
