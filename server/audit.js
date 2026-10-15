/**
 * Path-request audit log (docs/path-requests-spec.md §4.4).
 *
 * Append-only JSON lines at <dataDir>/audit.jsonl, one entry per line, rotated
 * to audit.1.jsonl at 5 MB (one old file kept). Never part of the timetable DB,
 * so it survives undo, timetable deletion and restore.
 *
 * Entry shape = AuditEntry in client/src/types.ts:
 *   { at, clock, ip, device, ua, actor, crew_id, crew_name, action, outcome,
 *     error?, timetable_id, timetable_name, request_id, detail }
 *
 * register(app, { dataDir, maxBytes? }) mounts
 *   GET /api/audit?timetableId=&requestId=&crewId=&ip=&device=&action=&before=&limit=[&format=csv]
 * (newest first; limit default 200, max 1000; reads both files; format=csv
 * downloads liverun-audit.csv with formula-injection guarded cells) and returns
 * the logger:
 *   audit.record(req, fields) → entry
 *     fields: { actor: 'crew'|'control', crew_id?, crew_name?, action,
 *               outcome: 'ok'|'rejected', error?, timetable_id, timetable_name?,
 *               request_id?, detail? }
 *     Fills at (now), ip (req.ip), device (X-LiveRun-Device header, stripped to
 *     [A-Za-z0-9_-], ≤ 64 chars, '' if absent), clock (X-LiveRun-Clock header
 *     if HH:MM, else null) and ua (shortUa(User-Agent)). Appends synchronously;
 *     never throws (a write error is logged to the console and the request
 *     carries on). dataDir is a function, called at write time.
 *
 * Pure helpers (exported, node:test):
 *   entry(reqLike, fields, now?) → AuditEntry   reqLike = { ip, headers }
 *   shortUa(ua) → e.g. 'Safari iOS 18', 'Chrome Android 14', 'Firefox macOS', 'unknown'
 *   summariseTrain(train, stations, crews) → { name, crew, loco, stops: [{ station, arr, dep }] }
 *     (for accept / cancel-approve details in phase 3)
 *   matches(entry, query) / toCsv(entries)
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const CSV_COLUMNS = ['at', 'clock', 'ip', 'device', 'ua', 'actor', 'crew_id', 'crew_name', 'action', 'outcome', 'error', 'timetable_name', 'request_id', 'detail'];

function shortUa(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return 'unknown';
  let browser = 'Browser';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '';
  let m;
  if (/iPhone|iPad|iPod/.test(ua)) os = (m = ua.match(/OS (\d+)[_.]/)) ? `iOS ${m[1]}` : 'iOS';
  else if (/Android/.test(ua)) os = (m = ua.match(/Android (\d+)/)) ? `Android ${m[1]}` : 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  if (browser === 'Browser' && !os) return 'unknown';
  return `${browser}${os ? ' ' + os : ''}`.slice(0, 40);
}

/** Builds an entry from a request-like { ip, headers } and the caller's fields. */
function entry(reqLike, fields, now = new Date()) {
  const headers = (reqLike && reqLike.headers) || {};
  const device = String(headers['x-liverun-device'] || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const clockHeader = String(headers['x-liverun-clock'] || '').trim();
  const f = fields || {};
  const e = {
    at: now.toISOString(),
    clock: HHMM_RE.test(clockHeader) ? clockHeader : null,
    ip: (reqLike && reqLike.ip) || '',
    device,
    ua: shortUa(headers['user-agent']),
    actor: f.actor,
    crew_id: f.crew_id ?? null,
    crew_name: f.crew_name ?? null,
    action: f.action,
    outcome: f.outcome,
    timetable_id: f.timetable_id,
    timetable_name: f.timetable_name ?? null,
    request_id: f.request_id ?? null,
    detail: f.detail ?? {},
  };
  if (f.error) e.error = f.error;
  return e;
}

/** Compact picture of a train for accept / cancel-approve details. Stops in stored order. */
function summariseTrain(train, stations, crews) {
  const stationName = new Map((stations || []).map((s) => [s.id, s.name]));
  const crew = train.crew_id ? (crews || []).find((c) => c.id === train.crew_id) : null;
  return {
    name: train.name,
    crew: crew ? crew.name : null,
    loco: train.train_id || null,
    stops: (train.stops || []).map((s) => ({
      station: stationName.get(s.station_id) || s.station_id,
      arr: s.arrival ?? null,
      dep: s.departure ?? null,
    })),
  };
}

/** True when the entry passes every filter present in the query. */
function matches(e, q) {
  if (!q) return true;
  if (q.timetableId && e.timetable_id !== q.timetableId) return false;
  if (q.requestId && e.request_id !== q.requestId) return false;
  if (q.crewId && e.crew_id !== q.crewId) return false;
  if (q.ip && e.ip !== q.ip) return false;
  if (q.device && e.device !== q.device) return false;
  if (q.action && e.action !== q.action) return false;
  if (q.before && !(e.at < q.before)) return false;
  return true;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Request text comes from crews: stop spreadsheets treating it as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(entries) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const e of entries) rows.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
  return rows.join('\r\n') + '\r\n';
}

function readLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && typeof e.at === 'string') out.push(e);
    } catch { /* skip a torn or corrupt line */ }
  }
  return out;
}

function parseLimit(v) {
  if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) < 1) return DEFAULT_LIMIT;
  return Math.min(Number(v), MAX_LIMIT);
}

function register(app, { dataDir, maxBytes = MAX_BYTES }) {
  function record(req, fields) {
    const e = entry({ ip: (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '', headers: (req && req.headers) || {} }, fields);
    try {
      const dir = dataDir();
      const file = path.join(dir, 'audit.jsonl');
      try {
        if (fs.statSync(file).size >= maxBytes) fs.renameSync(file, path.join(dir, 'audit.1.jsonl'));
      } catch { /* no file yet */ }
      fs.appendFileSync(file, JSON.stringify(e) + '\n');
    } catch (err) {
      console.error('audit: could not write entry:', err.message);
    }
    return e;
  }

  app.get('/api/audit', (req, res) => {
    try {
      const dir = dataDir();
      const q = {};
      for (const k of ['timetableId', 'requestId', 'crewId', 'ip', 'device', 'action', 'before']) {
        if (typeof req.query[k] === 'string' && req.query[k]) q[k] = req.query[k];
      }
      const all = [...readLines(path.join(dir, 'audit.1.jsonl')), ...readLines(path.join(dir, 'audit.jsonl'))];
      const result = all.filter((e) => matches(e, q)).reverse().slice(0, parseLimit(req.query.limit));
      if (req.query.format === 'csv') {
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="liverun-audit.csv"');
        return res.send(toCsv(result));
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return { record };
}

module.exports = { register, entry, shortUa, summariseTrain, matches, toCsv };
