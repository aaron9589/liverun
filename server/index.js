const express = require('express');
const cors = require('cors');
const path = require('path');
const { readDB, writeDB, getTimetable, mutateTimetable, uuidv4 } = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
// Optional sub-path prefix, e.g. BASE_PATH=/traingraph
// Strips the prefix from incoming URLs before any routing so the same
// image works whether the reverse proxy rewrites the path or not.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

app.use(cors());
app.use(express.json());

if (BASE_PATH) {
  app.use((req, _res, next) => {
    if (req.url.startsWith(BASE_PATH + '/') || req.url === BASE_PATH) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

const DEFAULT_SETTINGS = {
  clock_enabled: false,
  clock_broker_url: '',
  clock_topic: 'jmri/memory/currentTime',
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
  writeDB(db);
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
  res.json({ id: db.active_timetable_id });
});

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
    name: data.name,
    description: data.description || '',
    start_time: data.start_time || '06:00',
    end_time: data.end_time || '22:00',
    created_at: now,
    updated_at: now,
    settings: data.settings || { ...DEFAULT_SETTINGS },
    stations: (data.stations || []).map((s) => ({ ...s, id: stationIdMap[s.id], timetable_id: newId })),
    trains: (data.trains || []).map((tr) => {
      const trainId = uuidv4();
      return {
        ...tr, id: trainId, timetable_id: newId,
        crew_id: tr.crew_id ? (crewIdMap[tr.crew_id] || null) : null,
        stops: (tr.stops || []).map((stop) => ({
          ...stop, id: uuidv4(), train_id: trainId,
          station_id: stationIdMap[stop.station_id] || stop.station_id,
        })),
      };
    }),
    paths: (data.paths || []).map((p) => {
      const pathId = pathIdMap[p.id];
      return {
        ...p, id: pathId, timetable_id: newId,
        stops: (p.stops || []).map((ps) => ({
          ...ps, id: uuidv4(), path_id: pathId,
          station_id: stationIdMap[ps.station_id] || ps.station_id,
        })),
      };
    }),
    crews: (data.crews || []).map((c) => ({ ...c, id: crewIdMap[c.id], timetable_id: newId })),
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
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (Array.isArray(stations)) tt.stations = stations;
    if (Array.isArray(trains)) tt.trains = trains;
    if (Array.isArray(paths)) tt.paths = paths;
    if (Array.isArray(crews)) tt.crews = crews;
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.put('/api/timetables/:id/settings', (req, res) => {
  const { clock_enabled, clock_broker_url, clock_topic } = req.body;
  const updated = mutateTimetable(req.params.id, (tt) => {
    if (!tt.settings) tt.settings = { ...DEFAULT_SETTINGS };
    if (clock_enabled !== undefined) tt.settings.clock_enabled = Boolean(clock_enabled);
    if (clock_broker_url !== undefined) tt.settings.clock_broker_url = String(clock_broker_url);
    if (clock_topic !== undefined) tt.settings.clock_topic = String(clock_topic);
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(normalise(updated));
});

app.post('/api/timetables/:id/stations', (req, res) => {
  const { name, shortCode, distance, graphPos } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (graphPos == null || graphPos === '') return res.status(400).json({ error: 'graphPos is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const maxOrder = tt.stations.reduce((m, s) => Math.max(m, s.sort_order || 0), -1);
    tt.stations.push({
      id: uuidv4(), timetable_id: req.params.id, name: name.trim(),
      short_code: shortCode || '',
      distance: (distance !== '' && distance != null) ? Number(distance) : null,
      graph_pos: Number(graphPos),
      sort_order: maxOrder + 1,
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

app.put('/api/timetables/:id/stations/:stationId', (req, res) => {
  const { name, shortCode, distance, graphPos, sortOrder } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const st = tt.stations.find((s) => s.id === req.params.stationId);
    if (st) {
      st.name = name.trim(); st.short_code = shortCode || '';
      st.distance = (distance !== '' && distance != null) ? Number(distance) : null;
      if (graphPos != null && graphPos !== '') st.graph_pos = Number(graphPos);
      st.sort_order = sortOrder != null ? sortOrder : st.sort_order;
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
  const { name, color, notes, trainType, trainId: trainIdField, direction, crewId, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const trainId = uuidv4();
  const updated = mutateTimetable(req.params.id, (tt) => {
    tt.trains.push({
      id: trainId, timetable_id: req.params.id, name: name.trim(),
      color: color || '#3b82f6', notes: notes || '',
      train_type: trainType || '', train_id: trainIdField || '', direction: direction || '',
      crew_id: crewId || null,
      stops: buildStops(trainId, stops || []),
    });
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(normalise(updated));
});

app.put('/api/timetables/:id/trains/:trainId', (req, res) => {
  const { name, color, notes, trainType, trainId: trainIdField, direction, crewId, stops } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const updated = mutateTimetable(req.params.id, (tt) => {
    const tr = tt.trains.find((t) => t.id === req.params.trainId);
    if (tr) {
      tr.name = name.trim(); tr.color = color || '#3b82f6'; tr.notes = notes || '';
      tr.train_type = trainType || ''; tr.train_id = trainIdField || ''; tr.direction = direction || '';
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

function buildStops(trainId, stops) {
  return stops
    .filter((s) => s.arrival || s.departure)
    .map((s) => ({
      id: uuidv4(), train_id: trainId, station_id: s.stationId,
      arrival: s.arrival || null, departure: s.departure || null,
      special_instructions: s.specialInstructions || null,
    }));
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
  };
}

// ── Auto-assign trains to crews ───────────────────────────────

app.post('/api/timetables/:id/trains/auto-assign', (req, res) => {
  const { crewIds, trainIds, onlyUnassigned } = req.body;
  if (!Array.isArray(crewIds) || crewIds.length === 0) {
    return res.status(400).json({ error: 'crewIds must be a non-empty array' });
  }

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
    // Which trains to consider — filter by explicit trainIds list if provided, then by onlyUnassigned
    const trainIdSet = Array.isArray(trainIds) && trainIds.length > 0 ? new Set(trainIds) : null;
    const candidates = tt.trains.filter((t) => {
      if (trainIdSet && !trainIdSet.has(t.id)) return false;
      if (onlyUnassigned && t.crew_id) return false;
      return true;
    });

    // Sort by start time
    const sorted = [...candidates].sort((a, b) => trainMinutes(a).start - trainMinutes(b).start);

    // Track the latest end minute and job count per crew.
    // Pre-seed with any jobs those crews already hold (so existing assignments
    // act as hard constraints and aren't overlapped).
    const crewEnds = {};
    const crewCounts = {};
    const crewIdSet = new Set(crewIds);
    crewIds.forEach((id) => { crewEnds[id] = -1; crewCounts[id] = 0; });
    for (const tr of tt.trains) {
      if (!tr.crew_id || !crewIdSet.has(tr.crew_id)) continue;
      const { end } = trainMinutes(tr);
      if (end > crewEnds[tr.crew_id]) crewEnds[tr.crew_id] = end;
      crewCounts[tr.crew_id]++;
    }

    for (const train of sorted) {
      const { start, end } = trainMinutes(train);
      // Collect all crews who are free (no overlap with this train's start)
      const available = crewIds.filter((id) => crewEnds[id] < start);
      if (!available.length) {
        unassignedNames.push(train.name);
        continue;
      }
      // Pick the crew with the fewest jobs; break ties by who finished earliest
      available.sort((a, b) =>
        crewCounts[a] !== crewCounts[b]
          ? crewCounts[a] - crewCounts[b]
          : crewEnds[a] - crewEnds[b]
      );
      const chosen = available[0];
      train.crew_id = chosen;
      crewEnds[chosen] = end;
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
      trainType: tr.train_type || '',
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
      arrival: stop.arrival || null,
      departure: stop.departure || null,
      specialInstructions: stop.special_instructions || null,
    };
  });
  res.json({
    name: train.name,
    trainType: train.train_type || '',
    trainId: train.train_id || '',
    direction: train.direction || '',
    notes: train.notes || '',
    nextCrewService: computeNextCrewService(tt, train),
    stops,
  });
});

if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log('Train Graph server listening on http://localhost:' + PORT);
});
