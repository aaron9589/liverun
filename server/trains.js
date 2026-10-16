/**
 * Train construction shared by POST /api/timetables/:id/trains and accepting a
 * path request (server/path-requests.js), so both apply the same normalisation
 * and terminal-stop rules. Bodies are camelCase like every request body.
 */

const { v4: uuidv4 } = require('uuid');
const events = require('./events');

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

/**
 * A new stored train from a camelCase body { name, color, notes, trainId,
 * direction, crewId, stops: StopRequest[] }. Callers validate name and
 * guard events first. extra is merged in (e.g. { request_id }).
 */
function newTrain(timetableId, body, extra = {}, id = uuidv4()) {
  const { name, color, notes, trainId, direction, crewId, stops } = body;
  return {
    id, timetable_id: timetableId, name: String(name).trim(),
    color: color || '#3b82f6', notes: notes || '',
    train_id: trainId || '', direction: direction || '',
    crew_id: crewId || null,
    ...extra,
    stops: buildStops(id, stops || []),
  };
}

module.exports = { newTrain, buildStops, stripTerminalTimes, withGuardEvents, normTime };
