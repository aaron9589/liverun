const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const path = require('path');
const events = require('./events');
const { readDB, writeDB, getTimetable, mutateTimetable, onTimetableChange, uuidv4, getLayout, setLayout } = require('./db');
const openApiSpec = require('./openapi');
const { stripTrainType } = require('./migrations');
const layoutRoutes = require('./layout');
const { WS_SYNC_PATH, createSync } = require('./sync');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const WS_STATION_FEED_PATH = '/api/live/station-feed';
const VALID_TRAIN_STATUSES = new Set(['running', 'completed']);
// Optional sub-path prefix, e.g. BASE_PATH=/traingraph
// Strips the prefix from incoming URLs before any routing so the same
// image works whether the reverse proxy rewrites the path or not.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}));
app.use(express.json({ limit: '1mb' }));

// Behind a reverse proxy every client would otherwise share the proxy's IP
// (and its rate-limit bucket). Trust X-Forwarded-For only from proxies on
// loopback/private networks, which covers Docker bridges and LAN proxies.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Strip BASE_PATH before anything path-based (rate limiter, routes, static).
if (BASE_PATH) {
  app.use((req, _res, next) => {
    if (req.url.startsWith(BASE_PATH + '/') || req.url === BASE_PATH) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

// 200 requests per minute per client across all API routes
app.use('/api', rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// '/guard/' and '/mobile/' would resolve the relative ./assets and ./api URLs
// one level too deep. Redirect to the slash-less form with a *relative*
// Location so it is correct with or without BASE_PATH / proxy prefixes.
// (A middleware with an exact path check: Express routes ignore a trailing
// slash, so app.get('/guard/') would also catch '/guard' and loop.)
app.use((req, res, next) => {
  if (req.method !== 'GET' || (req.path !== '/guard/' && req.path !== '/mobile/')) return next();
  const name = req.path.replace(/\//g, '');
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `../${name}${qs}`);
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

// Live sync socket (/api/live/sync) — see server/sync.js
const sync = createSync({
  getTimetable,
  getActiveId: () => readDB().active_timetable_id || null,
  onTimetableChange,
});

const DEFAULT_SETTINGS = {
  clock_enabled: false,
  clock_broker_url: '',
  clock_topic: 'trains/jmri/memory/currentTime',
  auto_assign_min_break: 0,
  graph_scale: null,
};

app.get('/api/timetables', (_req, res) => {
  const db = readDB();
  const summaries = [...db.timetables]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(({ id, name, description, start_time, end_time, created_at, updated_at }) => ({
      id, name, description, start_time, end_time, created_at, updated_at,
      active: id === (db.active_timetable_id || null),
    }));
  res.json(summaries);
});

app.post('/api/timetables', (req, res) => {
  const { name, description, startTime, endTime } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const db = readDB();
  const now = new Date().toISOString();
  const timetable = {
    id: uuidv4(), name: name.trim(), description: description || '',
    start_time: startTime || '06:00', end_time: endTime || '22:00',
    created_at: now, updated_at: now, stations: [], trains: [], paths: [],
    settings: { ...DEFAULT_SETTINGS },
  };
  db.timetables.push(timetable);
  writeDB(db);
  res.status(201).json(timetable);
});

app.get('/api/timetables/:id', (req, res) => {
  const tt = getTimetable(req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(tt));
});

app.put('/api/timetables/:id', (req, res) => {
  const { name, description, startTime, endTime } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.name = name.trim(); tt.description = description || '';
    tt.start_time = startTime; tt.end_time = endTime;
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.delete('/api/timetables/:id', (req, res) => {
  const db = readDB();
  db.timetables = db.timetables.filter((t) => t.id !== req.params.id);
  // Don't leave the active flag pointing at a timetable that no longer exists
  const wasActive = db.active_timetable_id === req.params.id;
  if (wasActive) db.active_timetable_id = null;
  writeDB(db);
  sync.timetableDeleted(req.params.id, { activeCleared: wasActive });
  res.json({ ok: true });
});

// ── Active timetable (guard panel flag) ───────────────────────

app.get('/api/active-timetable', (_req, res) => {
  const db = readDB();
  const id = db.active_timetable_id || null;
  res.json({ id });
});

app.put('/api/active-timetable', (req, res) => {
  const { id } = req.body;
  const db = readDB();
  if (id && !db.timetables.find((t) => t.id === id)) {
    return res.status(404).json({ error: 'Timetable not found' });
  }
  db.active_timetable_id = id || null;
  writeDB(db);
  sync.activeChanged(db.active_timetable_id);
  res.json({ id: db.active_timetable_id });
});

// ── Layout-wide config (see server/layout.js) ────────────────

layoutRoutes.register(app, { getLayout, setLayout });
require('./sounds').register(app, { dataDir: require('./db').dataDir });

// Must be defined before /:id routes to avoid 'import' being matched as an id
app.post('/api/timetables/import', (req, res) => {
  const data = req.body;
  if (!data || !data.name) return res.status(400).json({ error: 'Invalid timetable data: name is required' });
  const db = readDB();
  const now = new Date().toISOString();
  const newId = uuidv4();
  const stationIdMap = {};
  (data.stations || []).forEach((s) => { stationIdMap[s.id] = uuidv4(); });
  const pathIdMap = {};
  (data.paths || []).forEach((p) => { pathIdMap[p.id] = uuidv4(); });
  const crewIdMap = {};
  (data.crews || []).forEach((c) => { crewIdMap[c.id] = uuidv4(); });
  const imported = {
    id: newId,
    name: String(data.name).trim(),
    description: String(data.description || ''),
    start_time: String(data.start_time || '06:00'),
    end_time: String(data.end_time || '22:00'),
    created_at: now,
    updated_at: now,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings && typeof data.settings === 'object' ? {
      clock_enabled: Boolean(data.settings.clock_enabled),
      clock_broker_url: String(data.settings.clock_broker_url || ''),
      clock_topic: String(data.settings.clock_topic || DEFAULT_SETTINGS.clock_topic),
      graph_scale: (data.settings.graph_scale != null && Number.isFinite(Number(data.settings.graph_scale))) ? Number(data.settings.graph_scale) : null,
    } : {}) },
    stations: (data.stations || []).map((s) => ({
      id: stationIdMap[s.id],
      timetable_id: newId,
      name: String(s.name || '').trim(),
      short_code: String(s.short_code || ''),
      distance: (s.distance != null && s.distance !== '' && Number.isFinite(Number(s.distance))) ? Number(s.distance) : null,
      graph_pos: Number.isFinite(Number(s.graph_pos)) ? Number(s.graph_pos) : 0,
      sort_order: Number.isFinite(Number(s.sort_order)) ? Number(s.sort_order) : 0,
      branch_name: (s.branch_name && String(s.branch_name).trim()) ? String(s.branch_name).trim() : null,
      alias_enabled: Boolean(s.alias_enabled),
      bold_name: Boolean(s.bold_name),
      italic_name: Boolean(s.italic_name),
      underline_name: Boolean(s.underline_name),
      ...(parseBoardingWeight(s.boarding_weight) !== undefined && { boarding_weight: parseBoardingWeight(s.boarding_weight) }),
    })),
    trains: (data.trains || []).map((tr) => {
      const trainId = uuidv4();
      return {
        id: trainId,
        timetable_id: newId,
        name: String(tr.name || '').trim(),
        color: /^#[0-9a-fA-F]{3,8}$/.test(tr.color) ? tr.color : '#3b82f6',
        notes: String(tr.notes || ''),
        train_id: String(tr.train_id || ''),
        direction: String(tr.direction || ''),
        crew_id: tr.crew_id ? (crewIdMap[tr.crew_id] || null) : null,
        stops: (tr.stops || []).map((stop) => ({
          id: uuidv4(),
          train_id: trainId,
          station_id: stationIdMap[stop.station_id] || String(stop.station_id),
          arrival: stop.arrival ? String(stop.arrival) : null,
          departure: stop.departure ? String(stop.departure) : null,
          special_instructions: stop.special_instructions ? String(stop.special_instructions) : null,
          location_alias: stop.location_alias ? String(stop.location_alias) : null,
          ...withGuardEvents(stop.guard_events),
        })),
      };
    }),
    paths: (data.paths || []).map((p) => {
      const pathId = pathIdMap[p.id];
      return {
        id: pathId,
        timetable_id: newId,
        name: String(p.name || '').trim(),
        stops: (p.stops || []).map((ps) => ({
          id: uuidv4(),
          path_id: pathId,
          station_id: stationIdMap[ps.station_id] || String(ps.station_id),
          sort_order: Number.isFinite(Number(ps.sort_order)) ? Number(ps.sort_order) : 0,
          travel_time_from_prev: Number.isFinite(Number(ps.travel_time_from_prev)) ? Number(ps.travel_time_from_prev) : 0,
          dwell_time: Number.isFinite(Number(ps.dwell_time)) ? Number(ps.dwell_time) : 0,
        })),
      };
    }),
    crews: (data.crews || []).map((c) => ({
      id: crewIdMap[c.id],
      timetable_id: newId,
      name: String(c.name || '').trim(),
      color: /^#[0-9a-fA-F]{3,8}$/.test(c.color) ? c.color : '#94a3b8',
    })),
  };
  db.timetables.push(imported);
  writeDB(db);
  res.status(201).json(normalise(imported));
});

app.post('/api/timetables/:id/duplicate', (req, res) => {
  const db = readDB();
  const original = db.timetables.find((t) => t.id === req.params.id);
  if (!original) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString();
  const newId = uuidv4();
  const stationIdMap = {};
  (original.stations || []).forEach((s) => { stationIdMap[s.id] = uuidv4(); });
  const pathIdMap = {};
  (original.paths || []).forEach((p) => { pathIdMap[p.id] = uuidv4(); });
  const crewIdMap = {};
  (original.crews || []).forEach((c) => { crewIdMap[c.id] = uuidv4(); });
  const duplicate = {
    ...original,
    id: newId,
    name: original.name + ' (copy)',
    created_at: now,
    updated_at: now,
    stations: (original.stations || []).map((s) => ({ ...s, id: stationIdMap[s.id], timetable_id: newId })),
    trains: (original.trains || []).map((tr) => {
      const trainId = uuidv4();
      return {
        ...tr, id: trainId, timetable_id: newId,
        status: undefined,
        crew_id: tr.crew_id ? (crewIdMap[tr.crew_id] || null) : null,
        stops: (tr.stops || []).map((stop) => ({
          ...stop, id: uuidv4(), train_id: trainId,
          station_id: stationIdMap[stop.station_id] || stop.station_id,
        })),
      };
    }),
    paths: (original.paths || []).map((p) => {
      const pathId = pathIdMap[p.id];
      return {
        ...p, id: pathId, timetable_id: newId,
        stops: (p.stops || []).map((ps) => ({
          ...ps, id: uuidv4(), path_id: pathId,
          station_id: stationIdMap[ps.station_id] || ps.station_id,
        })),
      };
    }),
    crews: (original.crews || []).map((c) => ({ ...c, id: crewIdMap[c.id], timetable_id: newId })),
  };
  db.timetables.push(duplicate);
  writeDB(db);
  res.status(201).json(normalise(duplicate));
});

app.post('/api/timetables/:id/restore', (req, res) => {
  const { stations, trains, paths, crews } = req.body;
  const ttId = req.params.id;
  const updated = mutateTimetable(ttId, (tt) => {
    if (Array.isArray(stations)) tt.stations = stations.map((s) => ({
      id: String(s.id),
      timetable_id: ttId,
      name: String(s.name || '').trim(),
      short_code: String(s.short_code || ''),
      distance: (s.distance != null && s.distance !== '' && Number.isFinite(Number(s.distance))) ? Number(s.distance) : null,
      graph_pos: Number.isFinite(Number(s.graph_pos)) ? Number(s.graph_pos) : 0,
      sort_order: Number.isFinite(Number(s.sort_order)) ? Number(s.sort_order) : 0,
      branch_name: (s.branch_name && String(s.branch_name).trim()) ? String(s.branch_name).trim() : null,
      alias_enabled: Boolean(s.alias_enabled),
      bold_name: Boolean(s.bold_name),
      italic_name: Boolean(s.italic_name),
      underline_name: Boolean(s.underline_name),
      ...(parseBoardingWeight(s.boarding_weight) !== undefined && { boarding_weight: parseBoardingWeight(s.boarding_weight) }),
    }));
    if (Array.isArray(trains)) tt.trains = trains.map((tr) => ({
      id: String(tr.id),
      timetable_id: ttId,
      name: String(tr.name || '').trim(),
      color: /^#[0-9a-fA-F]{3,8}$/.test(tr.color) ? tr.color : '#3b82f6',
      notes: String(tr.notes || ''),
      train_id: String(tr.train_id || ''),
      direction: String(tr.direction || ''),
      crew_id: tr.crew_id ? String(tr.crew_id) : null,
      ...(VALID_TRAIN_STATUSES.has(tr.status) ? { status: tr.status } : {}),
      stops: (tr.stops || []).map((s) => ({
        id: String(s.id),
        train_id: String(tr.id),
        station_id: String(s.station_id),
        arrival: s.arrival ? String(s.arrival) : null,
        departure: s.departure ? String(s.departure) : null,
        special_instructions: s.special_instructions ? String(s.special_instructions) : null,
        location_alias: s.location_alias ? String(s.location_alias) : null,
        ...withGuardEvents(s.guard_events),
      })),
    }));
    if (Array.isArray(paths)) tt.paths = paths.map((p) => ({
      id: String(p.id),
      timetable_id: ttId,
      name: String(p.name || '').trim(),
      stops: (p.stops || []).map((ps) => ({
        id: String(ps.id),
        path_id: String(p.id),
        station_id: String(ps.station_id),
        sort_order: Number.isFinite(Number(ps.sort_order)) ? Number(ps.sort_order) : 0,
        travel_time_from_prev: Number.isFinite(Number(ps.travel_time_from_prev)) ? Number(ps.travel_time_from_prev) : 0,
        dwell_time: Number.isFinite(Number(ps.dwell_time)) ? Number(ps.dwell_time) : 0,
      })),
    }));
    if (Array.isArray(crews)) tt.crews = crews.map((c) => ({
      id: String(c.id),
      timetable_id: ttId,
      name: String(c.name || '').trim(),
      color: /^#[0-9a-fA-F]{3,8}$/.test(c.color) ? c.color : '#94a3b8',
    }));
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  sync.broadcastCompletions(req.params.id, updated);
  res.json(normalise(updated));
});

app.put('/api/timetables/:id/settings', (req, res) => {
  const { clock_enabled, clock_broker_url, clock_topic, graph_scale, auto_assign_min_break } = req.body;
  if (clock_broker_url !== undefined) {
    // Only allow ws:// or wss:// broker URLs to prevent the client being
    // directed to connect to arbitrary non-MQTT endpoints.
    let parsedUrl = null;
    try { parsedUrl = new URL(String(clock_broker_url)); } catch { /* invalid */ }
    if (clock_broker_url !== '' && (!parsedUrl || !['ws:', 'wss:'].includes(parsedUrl.protocol))) {
      return res.status(400).json({ error: 'clock_broker_url must use ws:// or wss://' });
    }
  }
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.settings) tt.settings = { ...DEFAULT_SETTINGS };
    if (clock_enabled !== undefined) tt.settings.clock_enabled = Boolean(clock_enabled);
    if (clock_broker_url !== undefined) tt.settings.clock_broker_url = String(clock_broker_url);
    if (clock_topic !== undefined) tt.settings.clock_topic = String(clock_topic);
    if (graph_scale !== undefined) tt.settings.graph_scale = (graph_scale === null || !Number.isFinite(Number(graph_scale))) ? null : Number(graph_scale);
    if (auto_assign_min_break !== undefined) tt.settings.auto_assign_min_break = Math.max(0, Number(auto_assign_min_break) || 0);
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

/** Boarding weight: finite number 0-2, else undefined (= unset, treated as 1.0). */
function parseBoardingWeight(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : undefined;
}
function boardingWeightInvalid(v) {
  return v != null && v !== '' && parseBoardingWeight(v) === undefined;
}

app.post('/api/timetables/:id/stations', (req, res) => {
  const { name, shortCode, distance, graphPos, branchName, pushDown, aliasEnabled, boldName, italicName, underlineName, boardingWeight } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (boardingWeightInvalid(boardingWeight)) return res.status(400).json({ error: 'boardingWeight must be a number 0-2' });
  if (graphPos == null || graphPos === '') return res.status(400).json({ error: 'graphPos is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const newPos = Number(graphPos);
    if (pushDown) {
      tt.stations.forEach((s) => {
        if ((s.graph_pos ?? 0) >= newPos) s.graph_pos = (s.graph_pos ?? 0) + 1;
      });
    }
    const maxOrder = tt.stations.reduce((m, s) => Math.max(m, s.sort_order || 0), -1);
    tt.stations.push({
      id: uuidv4(), timetable_id: req.params.id, name: name.trim(),
      short_code: shortCode || '',
      distance: (distance !== '' && distance != null) ? Number(distance) : null,
      graph_pos: newPos,
      sort_order: maxOrder + 1,
      branch_name: (branchName && String(branchName).trim()) ? String(branchName).trim() : null,
      alias_enabled: Boolean(aliasEnabled),
      bold_name: Boolean(boldName),
      italic_name: Boolean(italicName),
      underline_name: Boolean(underlineName),
      ...(parseBoardingWeight(boardingWeight) !== undefined && { boarding_weight: parseBoardingWeight(boardingWeight) }),
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

app.put('/api/timetables/:id/stations/:stationId', (req, res) => {
  const { name, shortCode, distance, graphPos, sortOrder, branchName, pushDown, aliasEnabled, boldName, italicName, underlineName, boardingWeight } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (boardingWeightInvalid(boardingWeight)) return res.status(400).json({ error: 'boardingWeight must be a number 0-2' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const st = tt.stations.find((s) => s.id === req.params.stationId);
    if (st) {
      st.name = name.trim(); st.short_code = shortCode || '';
      st.distance = (distance !== '' && distance != null) ? Number(distance) : null;
      if (graphPos != null && graphPos !== '') {
        const newPos = Number(graphPos);
        const oldPos = st.graph_pos ?? 0;
        if (pushDown) {
          const delta = newPos - oldPos;
          if (delta !== 0) {
            tt.stations.forEach((s) => {
              if (s.id !== req.params.stationId && (s.graph_pos ?? 0) > oldPos) {
                s.graph_pos = (s.graph_pos ?? 0) + delta;
              }
            });
          }
        }
        st.graph_pos = newPos;
      }
      st.sort_order = sortOrder != null ? sortOrder : st.sort_order;
      st.branch_name = (branchName && String(branchName).trim()) ? String(branchName).trim() : null;
      st.alias_enabled = Boolean(aliasEnabled);
      st.bold_name = Boolean(boldName);
      st.italic_name = Boolean(italicName);
      st.underline_name = Boolean(underlineName);
      const bw = parseBoardingWeight(boardingWeight);
      if (bw === undefined) delete st.boarding_weight; else st.boarding_weight = bw;
    }
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.delete('/api/timetables/:id/stations/:stationId', (req, res) => {
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.stations = tt.stations.filter((s) => s.id !== req.params.stationId);
    tt.trains.forEach((tr) => {
      tr.stops = tr.stops.filter((s) => s.station_id !== req.params.stationId);
    });
    (tt.paths || []).forEach((p) => {
      p.stops = p.stops.filter((s) => s.station_id !== req.params.stationId);
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

// ── Paths ─────────────────────────────────────────────────────

app.post('/api/timetables/:id/paths', (req, res) => {
  const { name, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const pathId = uuidv4();
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.paths) tt.paths = [];
    tt.paths.push({
      id: pathId, timetable_id: req.params.id, name: name.trim(),
      stops: buildPathStops(pathId, stops || []),
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

app.put('/api/timetables/:id/paths/:pathId', (req, res) => {
  const { name, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.paths) tt.paths = [];
    const p = tt.paths.find((x) => x.id === req.params.pathId);
    if (p) {
      p.name = name.trim();
      p.stops = buildPathStops(req.params.pathId, stops || []);
    }
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.delete('/api/timetables/:id/paths/:pathId', (req, res) => {
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.paths) tt.paths = [];
    tt.paths = tt.paths.filter((p) => p.id !== req.params.pathId);
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.post('/api/timetables/:id/trains', (req, res) => {
  const { name, color, notes, trainId: trainIdField, direction, crewId, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const evCheck = events.validateStopsEvents(stops);
  if (evCheck.error) return res.status(400).json({ error: evCheck.error });
  const trainId = uuidv4();
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.trains.push({
      id: trainId, timetable_id: req.params.id, name: name.trim(),
      color: color || '#3b82f6', notes: notes || '',
      train_id: trainIdField || '', direction: direction || '',
      crew_id: crewId || null,
      stops: buildStops(trainId, stops || []),
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

app.put('/api/timetables/:id/trains/:trainId', (req, res) => {
  const { name, color, notes, trainId: trainIdField, direction, crewId, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const evCheck = events.validateStopsEvents(stops);
  if (evCheck.error) return res.status(400).json({ error: evCheck.error });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const tr = tt.trains.find((t) => t.id === req.params.trainId);
    if (tr) {
      tr.name = name.trim(); tr.color = color || '#3b82f6'; tr.notes = notes || '';
      delete tr.train_type; tr.train_id = trainIdField || ''; tr.direction = direction || '';
      tr.crew_id = crewId || null;
      tr.stops = buildStops(req.params.trainId, stops || []);
    }
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.delete('/api/timetables/:id/trains/:trainId', (req, res) => {
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.trains = tt.trains.filter((t) => t.id !== req.params.trainId);
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  sync.broadcastCompletions(req.params.id, updated);
  res.json(normalise(updated));
});

// Must be before /:trainId to avoid 'reset-complete' matching as an ID
app.post('/api/timetables/:id/trains/reset-complete', (req, res) => {
  // Run status only: crews tap this constantly, so no 'timetable-updated' re-fetch
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.trains.forEach((t) => { delete t.status; });
  }, { notify: false });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  sync.broadcastCompletions(req.params.id, updated, { statusOnly: true });
  res.json(normalise(updated));
});

app.patch('/api/timetables/:id/trains/:trainId/complete', (req, res) => {
  const status = req.body?.status;
  const updated = mutateTimetable(req.params.id, (tt) => {
    const train = tt.trains.find((t) => t.id === req.params.trainId);
    if (train) {
      if (VALID_TRAIN_STATUSES.has(status)) {
        train.status = status;
      } else {
        delete train.status;
      }
    }
  }, { notify: false });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  sync.broadcastCompletions(req.params.id, updated, { statusOnly: true });
  res.json(normalise(updated));
});

// ── Crews ─────────────────────────────────────────────────────

app.post('/api/timetables/:id/crews', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.crews) tt.crews = [];
    tt.crews.push({ id: uuidv4(), timetable_id: req.params.id, name: name.trim(), color: color || '#94a3b8' });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

// Must be defined before /:crewId to avoid 'reorder' being matched as an ID
app.put('/api/timetables/:id/crews/reorder', (req, res) => {
  const { order } = req.body; // array of crew IDs in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.crews) tt.crews = [];
    const map = new Map(tt.crews.map((c) => [c.id, c]));
    const reordered = order.map((id) => map.get(id)).filter(Boolean);
    // Append any crews not mentioned in order (safety net)
    const mentioned = new Set(order);
    tt.crews.filter((c) => !mentioned.has(c.id)).forEach((c) => reordered.push(c));
    tt.crews = reordered;
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.put('/api/timetables/:id/crews/:crewId', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.crews) tt.crews = [];
    const crew = tt.crews.find((c) => c.id === req.params.crewId);
    if (crew) { crew.name = name.trim(); crew.color = color || crew.color; }
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.delete('/api/timetables/:id/crews/:crewId', (req, res) => {
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.crews) tt.crews = [];
    tt.crews = tt.crews.filter((c) => c.id !== req.params.crewId);
    // Clear crew assignment from all trains
    tt.trains.forEach((tr) => { if (tr.crew_id === req.params.crewId) tr.crew_id = null; });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

function buildPathStops(pathId, stops) {
  return stops.map((s, i) => ({
    id: uuidv4(), path_id: pathId, station_id: s.stationId,
    sort_order: i,
    travel_time_from_prev: Number(s.travelTimeFromPrev) || 0,
    dwell_time: Number(s.dwellTime) || 0,
  }));
}

/**
 * Enforce terminal stop convention:
 *   - first (origin) stop:      departure only  — arrival is stripped (or moved if that's all there is)
 *   - last (destination) stop:  arrival only    — departure is stripped (or moved if that's all there is)
 *
 * Also removes any stops that ended up with both times null (e.g. from a
 * previous buggy migration run).
 */
function stripTerminalTimes(stops) {
  if (!stops || stops.length === 0) return stops;
  function stopMins(s) {
    const t = s.departure || s.arrival;
    if (!t) return Infinity;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  // Only consider stops that actually have a time when finding first/last
  const timedStops = stops.filter((s) => s.arrival || s.departure);
  if (timedStops.length === 0) return stops;
  const sorted = [...timedStops].sort((a, b) => stopMins(a) - stopMins(b));
  const firstId = sorted[0]?.id ?? sorted[0]?.station_id;
  const lastId  = sorted[sorted.length - 1]?.id ?? sorted[sorted.length - 1]?.station_id;
  if (firstId === lastId) return stops; // single-stop train — nothing to strip
  return stops
    .map((s) => {
      const key = s.id ?? s.station_id;
      if (key === firstId) {
        // Origin: departure only — unless the stop has a meaningful dwell (arrival ≠ departure).
        if (s.arrival && s.departure && s.arrival !== s.departure) return s;
        const dep = s.departure || s.arrival;
        return { ...s, arrival: null, departure: dep };
      }
      if (key === lastId) {
        // Destination: arrival only — unless the stop has a meaningful dwell (arrival ≠ departure).
        if (s.arrival && s.departure && s.arrival !== s.departure) return s;
        const arr = s.arrival || s.departure;
        return { ...s, arrival: arr, departure: null };
      }
      return s;
    })
    .filter((s) => s.arrival || s.departure); // drop any null-null stops
}

function withGuardEvents(list) {
  const g = events.sanitizePlacements(list);
  return g ? { guard_events: g } : {};
}

function buildStops(trainId, stops) {
  const built = stops
    .filter((s) => s.arrival || s.departure)
    .map((s) => ({
      id: uuidv4(), train_id: trainId, station_id: s.stationId,
      arrival: s.arrival || null, departure: s.departure || null,
      special_instructions: s.specialInstructions || null,
      location_alias: s.locationAlias || null,
      ...withGuardEvents(s.guardEvents),
    }));
  return stripTerminalTimes(built);
}

function normTime(t) {
  if (!t || typeof t !== 'string') return t;
  const parts = t.split(':');
  if (parts.length < 2) return t;
  return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
}

function normalise(tt) {
  return {
    ...tt,
    paths: tt.paths ?? [],
    crews: tt.crews ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(tt.settings ?? {}) },
    stations: [...tt.stations].sort(
      (a, b) =>
        (a.graph_pos ?? a.distance ?? 0) - (b.graph_pos ?? b.distance ?? 0) ||
        a.sort_order - b.sort_order
    ),
    trains: (tt.trains ?? []).map((tr) => ({
      ...tr,
      stops: stripTerminalTimes(
        (tr.stops ?? []).map((s) => ({
          ...s,
          arrival: normTime(s.arrival),
          departure: normTime(s.departure),
        }))
      ),
    })),
  };
}

// ── Auto-assign trains to crews ───────────────────────────────

app.post('/api/timetables/:id/trains/auto-assign', (req, res) => {
  const { crewIds, trainIds, onlyUnassigned, minBreakMins } = req.body;
  if (!Array.isArray(crewIds) || crewIds.length === 0) {
    return res.status(400).json({ error: 'crewIds must be a non-empty array' });
  }
  const breakMins = Math.max(0, Number(minBreakMins) || 0);

  function trainMinutes(tr) {
    let start = Infinity, end = -Infinity;
    for (const s of (tr.stops || [])) {
      const times = [s.arrival, s.departure].filter(Boolean);
      for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        const min = h * 60 + m;
        if (min < start) start = min;
        if (min > end) end = min;
      }
    }
    return { start: start === Infinity ? 0 : start, end: end === -Infinity ? 0 : end };
  }

  const unassignedNames = [];

  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.settings) tt.settings = { ...DEFAULT_SETTINGS };
    tt.settings.auto_assign_min_break = breakMins;
    // Which trains to consider — filter by explicit trainIds list if provided, then by onlyUnassigned
    const trainIdSet = Array.isArray(trainIds) && trainIds.length > 0 ? new Set(trainIds) : null;
    const candidates = tt.trains.filter((t) => {
      if (trainIdSet && !trainIdSet.has(t.id)) return false;
      if (onlyUnassigned && t.crew_id) return false;
      return true;
    });

    // Track all occupied intervals and job count per crew.
    // Pre-seed with any jobs those crews already hold (so existing assignments
    // act as hard constraints and aren't overlapped).
    // Using intervals (not just max-end) means gaps between existing jobs are
    // visible and new trains can fill them.
    const crewIntervals = {};
    const crewCounts = {};
    const crewLastEnd = {};
    const crewIdSet = new Set(crewIds);
    crewIds.forEach((id) => { crewIntervals[id] = []; crewCounts[id] = 0; crewLastEnd[id] = -1; });
    for (const tr of tt.trains) {
      if (!tr.crew_id || !crewIdSet.has(tr.crew_id)) continue;
      const { start, end } = trainMinutes(tr);
      crewIntervals[tr.crew_id].push({ start, end });
      if (end > crewLastEnd[tr.crew_id]) crewLastEnd[tr.crew_id] = end;
      crewCounts[tr.crew_id]++;
    }

    // Returns true if [start, end] doesn't overlap any interval in the list,
    // respecting the mandatory break gap between jobs.
    function isFree(intervals, start, end) {
      return intervals.every(({ start: s, end: e }) => end + breakMins <= s || start >= e + breakMins);
    }

    // Sort using MRV (minimum remaining values): process the most constrained
    // trains first — those with the fewest crews available given pre-existing
    // schedules. This prevents a train with many choices from accidentally
    // consuming the only crew that a more constrained train could have used.
    // Break ties by start time so the overall schedule stays chronological.
    const sorted = [...candidates].sort((a, b) => {
      const { start: sa, end: ea } = trainMinutes(a);
      const { start: sb, end: eb } = trainMinutes(b);
      const availA = crewIds.filter((id) => isFree(crewIntervals[id], sa, ea)).length;
      const availB = crewIds.filter((id) => isFree(crewIntervals[id], sb, eb)).length;
      if (availA !== availB) return availA - availB;
      return sa - sb;
    });

    for (const train of sorted) {
      const { start, end } = trainMinutes(train);
      // Collect all crews who have no overlapping job
      const available = crewIds.filter((id) => isFree(crewIntervals[id], start, end));
      if (!available.length) {
        unassignedNames.push(train.name);
        continue;
      }
      // Pick the crew with the fewest jobs; break ties by who finished most recently
      available.sort((a, b) =>
        crewCounts[a] !== crewCounts[b]
          ? crewCounts[a] - crewCounts[b]
          : crewLastEnd[a] - crewLastEnd[b]
      );
      const chosen = available[0];
      train.crew_id = chosen;
      crewIntervals[chosen].push({ start, end });
      if (end > crewLastEnd[chosen]) crewLastEnd[chosen] = end;
      crewCounts[chosen]++;
    }
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ ...normalise(updated), unassigned: unassignedNames });
});

// ── Live API (external system integration) ────────────────────────────────────

// Derive the next service a crew member is assigned to after this train
function computeNextCrewService(tt, train) {
  if (!train.crew_id) return '';
  const crewTrains = (tt.trains || []).filter((t) => t.crew_id === train.crew_id);
  if (crewTrains.length < 2) return '';
  function trainStartMinute(tr) {
    let earliest = Infinity;
    for (const s of (tr.stops || [])) {
      const t = s.arrival || s.departure;
      if (t) {
        const [h, m] = t.split(':').map(Number);
        const min = h * 60 + m;
        if (min < earliest) earliest = min;
      }
    }
    return earliest === Infinity ? 0 : earliest;
  }
  const sorted = [...crewTrains].sort((a, b) => trainStartMinute(a) - trainStartMinute(b));
  const idx = sorted.findIndex((t) => t.id === train.id);
  if (idx === -1 || idx === sorted.length - 1) return '';
  return sorted[idx + 1].name;
}

function minuteFromTime(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function parseClockMinuteFromPayload(raw) {
  let s = String(raw || '').trim();
  try {
    const obj = JSON.parse(s);
    s = String(obj.value ?? obj.time ?? obj.Value ?? s).trim();
  } catch {
    // Not JSON payload, continue with plain text matching.
  }
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minuteForStop(stop) {
  return minuteFromTime(stop.arrival || stop.departure);
}

function formatClockMinute(minute) {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseDirection(value) {
  const direction = String(value || '').trim().toLowerCase();
  if (!direction) return '';
  if (direction === 'up' || direction === 'down') return direction;
  return null;
}

function parseTrainIdFilter(value) {
  const raw = String(value || '').trim();
  return raw;
}

function makeLikeMatcher(pattern) {
  if (!pattern) return null;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${regexBody}$`, 'i');
}

function sortStationsForDirection(stations) {
  return [...(stations || [])].sort(
    (a, b) =>
      (a.graph_pos ?? a.distance ?? 0) - (b.graph_pos ?? b.distance ?? 0) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
}

function getSequencedTimedStops(train, stationOrderById) {
  const timedStops = (train.stops || [])
    .filter((s) => (s.arrival || s.departure) && stationOrderById.has(s.station_id));

  return [...timedStops].sort((a, b) => {
    const am = minuteForStop(a);
    const bm = minuteForStop(b);
    if (am == null && bm == null) return 0;
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });
}

function deriveDirectionAtStation(train, stationId, stationOrderById) {
  const sequencedStops = getSequencedTimedStops(train, stationOrderById);
  if (sequencedStops.length < 2) return '';

  const idx = sequencedStops.findIndex((s) => s.station_id === stationId);
  if (idx === -1) return '';
  const here = stationOrderById.get(stationId);
  if (here == null) return '';

  let delta = 0;
  if (idx + 1 < sequencedStops.length) {
    const next = stationOrderById.get(sequencedStops[idx + 1].station_id);
    if (next != null) delta = next - here;
  }
  if (delta === 0 && idx > 0) {
    const prev = stationOrderById.get(sequencedStops[idx - 1].station_id);
    if (prev != null) delta = here - prev;
  }

  // By station order convention: increasing order = down, decreasing order = up.
  if (delta > 0) return 'down';
  if (delta < 0) return 'up';
  return '';
}

function buildStationBoard(tt, stationNameParam, directionQuery, trainIdFilter) {
  const sortedStations = sortStationsForDirection(tt.stations || []);
  const stationOrderById = new Map(sortedStations.map((s, idx) => [s.id, idx]));
  const stationGraphPosById = new Map(sortedStations.map((s) => [s.id, Number(s.graph_pos ?? 0)]));
  const trainIdMatcher = makeLikeMatcher(trainIdFilter);
  const stationNameQuery = String(stationNameParam || '').trim().toLowerCase();
  const station = (sortedStations || []).find((s) => String(s.name || '').trim().toLowerCase() === stationNameQuery);
  if (!station) {
    return { status: 404, error: 'Station not found' };
  }

  const stationMap = new Map((sortedStations || []).map((s) => [s.id, s]));

  // Trains that physically stop at this station (used to exclude from pass-through detection)
  const stoppingTrainIds = new Set(
    (tt.trains || [])
      .filter((tr) => getSequencedTimedStops(tr, stationOrderById).some((s) => s.station_id === station.id))
      .map((tr) => tr.id)
  );

  const allServices = [];

  // Regular stopping services
  for (const tr of (tt.trains || [])) {
    const sequencedStops = getSequencedTimedStops(tr, stationOrderById);
    const stationStopIndex = sequencedStops.findIndex((stop) => stop.station_id === station.id);
    if (stationStopIndex === -1) continue;
    const stationStop = sequencedStops[stationStopIndex];
    const derivedDirection = deriveDirectionAtStation(tr, station.id, stationOrderById);
    if (directionQuery && derivedDirection !== directionQuery) continue;
    if (trainIdMatcher && !trainIdMatcher.test(String(tr.train_id || ''))) continue;
    const stoppingPattern = sequencedStops.slice(stationStopIndex).map((stop) => {
      const stopStation = stationMap.get(stop.station_id);
      return {
        stopName: stopStation ? stopStation.name : stop.station_id,
        locationAlias: stop.location_alias || null,
        arrival: stop.arrival || null,
        departure: stop.departure || null,
        specialInstructions: stop.special_instructions || null,
      };
    });
    const eventTime = stationStop.arrival || stationStop.departure || null;
    allServices.push({
      name: tr.name,
      trainId: tr.train_id || '',
      direction: derivedDirection || tr.direction || '',
      notes: tr.notes || '',
      nextCrewService: computeNextCrewService(tt, tr),
      arrival: stationStop.arrival || null,
      departure: stationStop.departure || null,
      eventTime,
      stoppingPattern,
      _sortMinute: minuteForStop(stationStop),
    });
  }

  // Pass-through services: trains whose route crosses this station's graph_pos without stopping
  const targetPos = stationGraphPosById.get(station.id);
  if (targetPos != null) {
    for (const tr of (tt.trains || [])) {
      if (stoppingTrainIds.has(tr.id)) continue;
      if (trainIdMatcher && !trainIdMatcher.test(String(tr.train_id || ''))) continue;

      const sequencedStops = getSequencedTimedStops(tr, stationOrderById);
      if (sequencedStops.length < 2) continue;

      for (let i = 0; i < sequencedStops.length - 1; i++) {
        const stopA = sequencedStops[i];
        const stopB = sequencedStops[i + 1];
        const posA = stationGraphPosById.get(stopA.station_id);
        const posB = stationGraphPosById.get(stopB.station_id);
        if (posA == null || posB == null) continue;

        const minPos = Math.min(posA, posB);
        const maxPos = Math.max(posA, posB);
        if (targetPos <= minPos || targetPos >= maxPos) continue;

        const derivedDirection = posA < posB ? 'down' : 'up';
        if (directionQuery && derivedDirection !== directionQuery) continue;

        // Interpolate estimated pass time between departure of A and arrival at B
        const tAmin = minuteFromTime(stopA.departure || stopA.arrival);
        const tBmin = minuteFromTime(stopB.arrival || stopB.departure);
        let passTime = null;
        let passMinute = null;
        if (tAmin != null && tBmin != null && posA !== posB) {
          const fraction = (targetPos - posA) / (posB - posA);
          passMinute = Math.round(tAmin + fraction * (tBmin - tAmin));
          passTime = formatClockMinute(passMinute);
        }

        const stoppingPattern = sequencedStops.slice(i + 1).map((stop) => {
          const stopStation = stationMap.get(stop.station_id);
          return {
            stopName: stopStation ? stopStation.name : stop.station_id,
            locationAlias: stop.location_alias || null,
            arrival: stop.arrival || null,
            departure: stop.departure || null,
            specialInstructions: stop.special_instructions || null,
          };
        });

        allServices.push({
          name: tr.name,
          trainId: tr.train_id || '',
          direction: derivedDirection,
          notes: tr.notes || '',
          nextCrewService: computeNextCrewService(tt, tr),
          arrival: null,
          departure: null,
          eventTime: passTime,
          passTime,
          passingThrough: true,
          stoppingPattern,
          _sortMinute: passMinute,
        });
        break; // one entry per train
      }
    }
  }

  return {
    stationName: station.name,
    direction: directionQuery || 'all',
    trainIdFilter: trainIdFilter || null,
    services: allServices
      .sort((a, b) => {
        const am = a._sortMinute == null ? Number.POSITIVE_INFINITY : a._sortMinute;
        const bm = b._sortMinute == null ? Number.POSITIVE_INFINITY : b._sortMinute;
        return am - bm || a.name.localeCompare(b.name);
      })
      .map(({ _sortMinute, ...service }) => service),
  };
}

app.get('/api/timetables/:id/live/trains', (req, res) => {
  const tt = getTimetable(req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });
  function trainStartMinute(tr) {
    let earliest = Infinity;
    for (const s of (tr.stops || [])) {
      const t = s.arrival || s.departure;
      if (t) {
        const [h, m] = t.split(':').map(Number);
        const min = h * 60 + m;
        if (min < earliest) earliest = min;
      }
    }
    return earliest === Infinity ? 0 : earliest;
  }
  const trains = [...(tt.trains || [])]
    .sort((a, b) => trainStartMinute(a) - trainStartMinute(b))
    .map((tr) => ({
      name: tr.name,
      trainId: tr.train_id || '',
      direction: tr.direction || '',
      notes: tr.notes || '',
      nextCrewService: computeNextCrewService(tt, tr),
    }));
  res.json({ trains });
});

app.get('/api/timetables/:id/live/trains/:trainName', (req, res) => {
  const tt = getTimetable(req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });
  const train = (tt.trains || []).find((tr) => tr.name === req.params.trainName);
  if (!train) return res.status(404).json({ error: 'Train not found' });
  const stationMap = new Map((tt.stations || []).map((s) => [s.id, s]));
  const stops = (train.stops || []).map((stop) => {
    const station = stationMap.get(stop.station_id);
    return {
      stopName: station ? station.name : stop.station_id,
      locationAlias: stop.location_alias || null,
      arrival: stop.arrival || null,
      departure: stop.departure || null,
      specialInstructions: stop.special_instructions || null,
    };
  });
  res.json({
    name: train.name,
    trainId: train.train_id || '',
    direction: train.direction || '',
    notes: train.notes || '',
    nextCrewService: computeNextCrewService(tt, train),
    stops,
  });
});

app.get('/api/timetables/:id/live/stations/:stationName', (req, res) => {
  const tt = getTimetable(req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });

  const directionQuery = parseDirection(req.query.direction);
  const trainIdFilter = parseTrainIdFilter(req.query.trainId);
  if (directionQuery === null) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  const board = buildStationBoard(tt, req.params.stationName, directionQuery, trainIdFilter);
  if (board.error) return res.status(board.status || 500).json({ error: board.error });
  res.json(board);
});

function sendWsJson(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function sendStationFeedTick(ws, config, clockMinute) {
  const tt = getTimetable(config.timetableId);
  if (!tt) {
    sendWsJson(ws, { type: 'error', error: 'Timetable not found' });
    return;
  }
  const board = buildStationBoard(tt, config.stationName, config.direction, config.trainIdFilter);
  if (board.error) {
    sendWsJson(ws, { type: 'error', error: board.error });
    return;
  }

  if (!Number.isFinite(clockMinute)) return;
  const services = board.services
    .map((svc) => {
      const eventMinute = minuteFromTime(svc.eventTime);
      const minutesUntil = eventMinute == null ? null : eventMinute - clockMinute;
      return { ...svc, minutesUntil };
    })
    .filter((svc) => svc.minutesUntil != null && svc.minutesUntil >= 0)
    .slice(0, config.futureCount);

  sendWsJson(ws, {
    type: 'stationFeed',
    timetableId: config.timetableId,
    stationName: board.stationName,
    direction: board.direction,
    clockTime: formatClockMinute(clockMinute),
    source: 'mqtt',
    clockTopic: config.clockTopic,
    futureCount: config.futureCount,
    services,
    generatedAt: new Date().toISOString(),
  });
}

// ── JMRI clock script download ────────────────────────────────

app.get('/api/download/jmri-clock-script', (req, res) => {
  const topic = String(req.query.topic || 'jmri/memory/currentTime');
  // Allow only safe MQTT topic characters. Double-quote is intentionally
  // excluded — it is the Python string delimiter used below and must never
  // appear here, even if this regex is widened in future.
  if (!/^[a-zA-Z0-9/_\-.]{1,256}$/.test(topic)) {
    return res.status(400).json({ error: 'Invalid topic' });
  }

  const script = [
    'import jmri',
    'import java',
    'from datetime import datetime',
    '',
    '# Publishes the JMRI internal fast clock to an MQTT topic in 24-hour format.',
    '# Generated by LiveRun — https://liverun.app',
    '#',
    '# Compatible with JMRI 4.17 and later (requires MQTT connection configured in JMRI).',
    '#',
    '# SETUP',
    '# -----',
    '# 1. In JMRI, open Edit > Preferences > Connections.',
    '#    Add a new connection, choose type "MQTT".',
    '#    Enter your broker hostname/IP and port (default: 1883), then save & restart.',
    '#',
    '# 2. Save this file to the "jython" folder inside your JMRI preferences folder.',
    '#      macOS / Linux : ~/JMRI/jython/',
    '#      Windows       : C:\\Users\\<you>\\JMRI\\jython\\',
    '#',
    '# 3. Run manually  : Scripting > Run Script… > select this file.',
    '#    Run at startup : Edit > Preferences > Start Up > Add Action >',
    '#                    "Execute Jython Script" > select this file.',
    '',
    `mqtt_topic = "${topic}"`,
    'memory_variable_name = "IMCURRENTTIME"',
    '',
    'try:',
    '    memory = jmri.InstanceManager.memoryManagerInstance().getMemory(memory_variable_name)',
    '    if memory is None:',
    '        raise ValueError("Memory variable \'" + memory_variable_name + "\' not found.")',
    '',
    '    mqttAdapter = jmri.InstanceManager.getDefault(jmri.jmrix.mqtt.MqttSystemConnectionMemo).getMqttAdapter()',
    '    if mqttAdapter is None:',
    '        raise ValueError("MQTT Adapter not found. Add an MQTT connection in JMRI Preferences.")',
    '',
    '    def to_24_hour(time_str):',
    '        try:',
    '            dt = datetime.strptime(time_str, "%I:%M %p")',
    '            return "%d:%02d" % (dt.hour, dt.minute)',
    '        except Exception as e:',
    '            print("Error converting time \'%s\': %s" % (time_str, e))',
    '            return time_str',
    '',
    '    class MemoryChangeListener(java.beans.PropertyChangeListener):',
    '        def __init__(self, memory, mqttAdapter, topic):',
    '            self.memory = memory',
    '            self.mqttAdapter = mqttAdapter',
    '            self.topic = topic',
    '',
    '        def propertyChange(self, event):',
    '            new_value = self.memory.getValue()',
    '            if new_value is not None:',
    '                formatted_time = to_24_hour(str(new_value))',
    '                self.mqttAdapter.publish(self.topic, formatted_time.encode("utf-8"))',
    '                print("Published \'%s\' to \'%s\'" % (formatted_time, self.topic))',
    '            else:',
    '                print("Memory value is None, skipping publish.")',
    '',
    '    listener = MemoryChangeListener(memory, mqttAdapter, mqtt_topic)',
    '    memory.addPropertyChangeListener(listener)',
    '',
    '    initial_value = memory.getValue()',
    '    if initial_value is not None:',
    '        formatted_time = to_24_hour(str(initial_value))',
    '        mqttAdapter.publish(mqtt_topic, formatted_time.encode("utf-8"))',
    '        print("Initial publish: \'%s\' to \'%s\'" % (formatted_time, mqtt_topic))',
    '    else:',
    '        print("Initial memory value is None, no publish.")',
    '',
    '    print("LiveRun clock script ready — listening for fast clock changes.")',
    '',
    'except Exception as e:',
    '    print("Error: %s" % e)',
  ].join('\n');

  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="liverun-clock.py"');
  res.send(script);
});

// ── API schema / docs ─────────────────────────────────────────

app.get('/api/schema', (_req, res) => {
  res.json(openApiSpec);
});

app.get('/api/docs', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiveRun API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.32.6/swagger-ui.css"
        integrity="sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT"
        crossorigin="anonymous" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.32.6/swagger-ui-bundle.js"
          integrity="sha384-EYdOaiRwn44zNjrw+Tfs06qYz9BGQVo2f4/pLY5i7VorbjnZNhdplAbTBk8FXHUJ"
          crossorigin="anonymous"></script>
  <script>
    SwaggerUIBundle({
      url: ${JSON.stringify(`${BASE_PATH}/api/schema`)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`);
});

if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
  });
}

// Global error handler — prevents stack traces leaking to clients
app.use((err, _req, res, _next) => {
  console.error(err);
  // Forward 4xx status codes from body-parser (e.g. 413 Payload Too Large,
  // 400 Bad JSON) so clients get a meaningful response rather than 500.
  const status = err.status ?? err.statusCode ?? 500;
  const clientError = status >= 400 && status < 500;
  res.status(status).json({ error: clientError ? err.message : 'Internal server error' });
});

const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

wsServer.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const timetableId = String(reqUrl.searchParams.get('id') || '').trim();
  const stationName = String(reqUrl.searchParams.get('station') || '').trim();
  const direction = parseDirection(reqUrl.searchParams.get('direction'));
  const trainIdFilter = parseTrainIdFilter(reqUrl.searchParams.get('trainId'));
  const futureCount = Math.max(1, Math.min(100, Number(reqUrl.searchParams.get('futureCount')) || 10));

  if (!timetableId || !stationName || direction === null) {
    sendWsJson(ws, {
      type: 'error',
      error: 'Expected query: id=<timetableId>&station=<stationName>[&direction=up|down][&trainId=%pattern%][&futureCount=10]',
    });
    ws.close(1008, 'Invalid query');
    return;
  }

  const tt = getTimetable(timetableId);
  if (!tt) {
    sendWsJson(ws, { type: 'error', error: 'Timetable not found' });
    ws.close(1008, 'Timetable not found');
    return;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(tt.settings || {}) };
  if (!settings.clock_enabled || !settings.clock_broker_url || !settings.clock_topic) {
    sendWsJson(ws, {
      type: 'error',
      error: 'Fast clock is not configured for this timetable. Set clock_enabled, clock_broker_url, and clock_topic in timetable settings.',
    });
    ws.close(1008, 'Clock not configured');
    return;
  }

  const config = {
    timetableId,
    stationName,
    direction,
    trainIdFilter,
    clockTopic: settings.clock_topic,
    futureCount,
  };

  const mqttClient = mqtt.connect(settings.clock_broker_url, {
    reconnectPeriod: 5000,
    protocolVersion: 4,
    clean: true,
    clientId: `liverun_ws_${Math.random().toString(16).slice(2, 10)}`,
  });
  let lastClockMinute = null;

  sendWsJson(ws, {
    type: 'hello',
    message: 'Connected. Waiting for fast clock MQTT updates to push station feed snapshots.',
    clockTopic: settings.clock_topic,
    brokerUrl: settings.clock_broker_url,
  });

  mqttClient.on('connect', () => {
    sendWsJson(ws, { type: 'mqtt', status: 'connected', topic: settings.clock_topic });
    mqttClient.subscribe(settings.clock_topic, { qos: 0 }, (err) => {
      if (err) {
        sendWsJson(ws, { type: 'error', error: `MQTT subscribe failed: ${err.message}` });
      }
    });
  });

  mqttClient.on('message', (topic, message) => {
    if (topic !== settings.clock_topic) return;
    const minute = parseClockMinuteFromPayload(message.toString());
    if (minute == null) return;
    if (minute === lastClockMinute) return;
    lastClockMinute = minute;
    sendStationFeedTick(ws, config, minute);
  });

  mqttClient.on('error', (err) => {
    sendWsJson(ws, { type: 'error', error: `MQTT error: ${err.message}` });
  });

  mqttClient.on('close', () => {
    sendWsJson(ws, { type: 'mqtt', status: 'disconnected', topic: settings.clock_topic });
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendWsJson(ws, { type: 'error', error: 'Invalid JSON message' });
      return;
    }

    if (msg && msg.type === 'ping') {
      sendWsJson(ws, { type: 'pong', at: new Date().toISOString() });
      return;
    }

    sendWsJson(ws, { type: 'error', error: 'Unsupported message type' });
  });

  ws.on('close', () => {
    mqttClient.end(true);
  });
});

server.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const targetPath = reqUrl.pathname;
  const bpFeed = BASE_PATH ? `${BASE_PATH}${WS_STATION_FEED_PATH}` : null;
  const bpSync = BASE_PATH ? `${BASE_PATH}${WS_SYNC_PATH}` : null;

  if (targetPath === WS_STATION_FEED_PATH || targetPath === bpFeed) {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit('connection', ws, req);
    });
  } else if (targetPath === WS_SYNC_PATH || targetPath === bpSync) {
    sync.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// ── Startup migration: normalise terminal stop times ─────────────────────────
// Runs once on every container start. Strips arrival from each train's first
// stop and departure from its last stop across all timetables, so any data
// created before this rule was enforced is brought into compliance.
(function migrateTerminalTimes() {
  const db = readDB();
  let changed = 0;
  for (const tt of db.timetables) {
    const before = changed;
    for (const tr of (tt.trains ?? [])) {
      const original = JSON.stringify(tr.stops);
      tr.stops = stripTerminalTimes(
        (tr.stops ?? []).map((s) => ({
          ...s,
          arrival: normTime(s.arrival),
          departure: normTime(s.departure),
        }))
      );
      if (JSON.stringify(tr.stops) !== original) changed++;
    }
    // Bump rev so live clients holding the old copy re-fetch on reconnect
    if (changed > before) tt.rev = (tt.rev || 0) + 1;
  }
  if (changed > 0) {
    writeDB(db);
    console.log(`Startup migration: normalised terminal stop times on ${changed} train(s).`);
  }
})();

// ── Startup migration: remove retired train_type field ───────────────────────
(function migrateStripTrainType() {
  const db = readDB();
  const before = db.timetables.map((tt) => JSON.stringify(tt.trains ?? []));
  const changed = stripTrainType(db);
  if (changed > 0) {
    db.timetables.forEach((tt, i) => {
      if (JSON.stringify(tt.trains ?? []) !== before[i]) tt.rev = (tt.rev || 0) + 1;
    });
    writeDB(db);
    console.log(`Startup migration: removed train_type from ${changed} train(s).`);
  }
})();

server.listen(PORT, () => {
  console.log('Train Graph server listening on http://localhost:' + PORT);
});
