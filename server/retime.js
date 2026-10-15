/**
 * Times-only train update for graph editing:
 *   POST /api/timetables/:id/trains/retime  { changes: [{ trainId, times: [{ stationId, arrival, departure }] }] }
 *
 * Applies new arrival/departure times to each train's CURRENT stops, matched by
 * station, and leaves every other field (stops, aliases, special instructions,
 * guard events, crew) alone, so an edit made after the drag isn't overwritten.
 * All-or-nothing: any problem with any train and nothing is saved. One mutation,
 * so one rev bump and one sync notice for the whole batch.
 */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CHANGES = 500;

function isTime(v) {
  return v === null || (typeof v === 'string' && HHMM_RE.test(v));
}

/**
 * Checks a batch against the timetable. Returns { error } for a malformed
 * request (400), { conflicts: [message] } when trains no longer match what was
 * dragged (409), or {} when it can be applied.
 */
function validateRetime(tt, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return { error: 'changes must be a non-empty array' };
  if (changes.length > MAX_CHANGES) return { error: `at most ${MAX_CHANGES} trains per request` };
  const conflicts = [];
  const seen = new Set();
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const at = `changes[${i}]`;
    if (!c || typeof c.trainId !== 'string' || !Array.isArray(c.times)) return { error: `${at} needs a trainId and a times array` };
    if (seen.has(c.trainId)) return { error: `${at}: train ${c.trainId} appears twice` };
    seen.add(c.trainId);
    for (const t of c.times) {
      if (!t || typeof t.stationId !== 'string' || !isTime(t.arrival ?? null) || !isTime(t.departure ?? null)) {
        return { error: `${at}.times: each entry needs a stationId and HH:MM (or null) arrival/departure` };
      }
    }
    const train = (tt.trains || []).find((x) => x.id === c.trainId);
    if (!train) { conflicts.push(`train ${c.trainId} no longer exists`); continue; }
    const now = train.stops.map((s) => s.station_id);
    const sent = c.times.map((t) => t.stationId);
    const same = now.length === sent.length && new Set(sent).size === sent.length && now.every((s) => sent.includes(s));
    if (!same) conflicts.push(`${train.name}'s stops were changed after it was moved`);
  }
  return conflicts.length ? { conflicts } : {};
}

/** Applies a validated batch: only arrival/departure change. */
function applyRetime(tt, changes) {
  for (const c of changes) {
    const train = tt.trains.find((x) => x.id === c.trainId);
    const byStation = new Map(c.times.map((t) => [t.stationId, t]));
    for (const stop of train.stops) {
      const t = byStation.get(stop.station_id);
      stop.arrival = t.arrival ?? null;
      stop.departure = t.departure ?? null;
    }
  }
}

function register(app, { getTimetable, mutateTimetable, normalise }) {
  app.post('/api/timetables/:id/trains/retime', (req, res) => {
    const tt = getTimetable(req.params.id);
    if (!tt) return res.status(404).json({ error: 'Not found' });
    const changes = req.body && req.body.changes;
    const check = validateRetime(tt, changes);
    if (check.error) return res.status(400).json({ error: check.error });
    if (check.conflicts) return res.status(409).json({ error: `Not saved: ${check.conflicts.join('; ')}`, conflicts: check.conflicts });
    const updated = mutateTimetable(req.params.id, (t) => applyRetime(t, changes));
    res.json(normalise(updated));
  });
}

module.exports = { register, validateRetime, applyRetime };
