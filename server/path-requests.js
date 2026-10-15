/**
 * Path requests (docs/path-requests-spec.md §1, §4).
 *
 * Stored on the timetable: tt.path_requests[] (PathRequest in client/src/types.ts).
 * Only the ACTIVE timetable takes new submits (400 otherwise).
 *
 * register(app, { readDB, getTimetable, mutateTimetable, normalise, sync, audit })
 *
 * Endpoints (camelCase bodies; every success returns normalise(timetable)):
 *   GET    /api/timetables/:id/path-requests                    → PathRequest[]
 *   POST   /api/timetables/:id/path-requests                    crew   PathRequestSubmit → 201, pending
 *   POST   /api/timetables/:id/path-requests/:reqId/withdraw    crew   { crewId }  pending|in_review → withdrawn
 *   POST   /api/timetables/:id/path-requests/:reqId/acknowledge control           pending → in_review
 *   POST   /api/timetables/:id/path-requests/:reqId/release     control           in_review → pending;
 *                                                                                 accepted whose train no longer exists → pending (Reopen)
 *   POST   /api/timetables/:id/path-requests/:reqId/decline     control { note }  pending|in_review → declined (note required)
 *   POST   /api/timetables/:id/path-requests/:reqId/accept      control PathAcceptBody { train, retime?, note? }
 *                                                                                 in_review → accepted, train created (below)
 *   POST   /api/timetables/:id/path-requests/:reqId/cancel-ask  crew   { crewId, reason? }  accepted, no open ask → cancel_ask open
 *   POST   /api/timetables/:id/path-requests/:reqId/cancel-approve control { note? } open ask → cancelled, train deleted
 *   POST   /api/timetables/:id/path-requests/:reqId/cancel-reject control { note } open ask → rejected (note required)
 *   DELETE /api/timetables/:id/path-requests?closed=true        control           remove accepted/declined/withdrawn/cancelled
 *                                                                                 (an accepted one with an OPEN cancel ask is kept)
 * Errors: 400 malformed / not active timetable / requests disabled; 403 crew
 * action by a crew that isn't the requester; 404 timetable or request missing;
 * 409 wrong state → { error, status: <current status> }; 429-style cap → 409
 * "too many open requests" (50 open per timetable). A missing timetable or
 * request is checked first, then a malformed body, the crew, the state.
 *
 * Accept (spec §4.2), all inside ONE notifying mutateTimetable:
 *   1. the train body: name required (trimmed, ≤ 60), color #hex (3–8) or the
 *      default, stations exist and are unique, times HH:MM or null, at least 2
 *      timed stops, guard events valid (events.validateStopsEvents), crewId an
 *      existing crew or ''/null (unassigned); a malformed retime; note ≤ 300 → 400;
 *   2. the request is still in_review (else 409 with its status, e.g. withdrawn);
 *   3. retime (optional, may be empty) via retime.validateRetime: a moved train
 *      changed meanwhile → 409 { error, status, conflicts };
 *   4. tt.trains.push(trains.newTrain(ttId, train, { request_id })) — the same
 *      normalisation and terminal-stop rules as POST /trains;
 *   5. retime.applyRetime; 6. the request: accepted, train_id_created,
 *      assigned_crew_id (train crewId || null), control_note (if given).
 * Cancel-approve (accepted with an OPEN cancel_ask): request cancelled,
 * cancel_ask approved with control_note = note (if given), and the train
 * train_id_created deleted if it still exists, in one notifying mutation.
 *
 * Every other mutation here is request-only: mutateTimetable(..., { notify: false }),
 * then sync.broadcastPathRequests(id, tt, { requestsOnly: true }) (sends
 * { type: 'path-requests', timetableId, requests, rev }). Accept and
 * cancel-approve create or delete a train, so they notify ({ notify: true }) and
 * broadcast WITHOUT rev: the timetable-updated notice makes clients re-fetch.
 * The sync module also sends the list (without rev) right after 'hello'. The
 * state is checked again inside the mutation; a refusal there throws, so nothing
 * is written and rev doesn't move.
 *
 * Every call (ok AND rejected, incl. 400/403/404/409; not GET) is logged with
 * audit.record(req, { actor, crew_id, crew_name, action, outcome, error?,
 * timetable_id, timetable_name, request_id, detail }). Crew actions: the acting
 * crew is body.crewId (self-declared). detail per spec §4.4; a rejection of a
 * known request has detail { status }. accept: { train: summariseTrain(new),
 * assigned_crew (name, or null for unassigned; only when it isn't the requester),
 * note, moved: [{ name, from: summariseTrain(old).stops, to: …new }] };
 * cancel-approve: { train: summariseTrain(deleted) | null, note }.
 *
 * Pure, exported for node:test: validateSubmit(tt, body, { id?, now? }) →
 * { request } | { error }, transition(request, action, ctx) → { ok: patch } |
 * { status: <HTTP code>, error }, validateAcceptTrain(tt, train) → { train } |
 * { error }, planAccept(tt, reqId, body, { trainId?, now? }) → { plan } |
 * { status, error, requestStatus?, conflicts? }, applyAccept(tt, plan) → audit
 * detail, applyPatch(), clearClosed(), isOpen().
 */

const { randomUUID } = require('crypto');
const { newTrain } = require('./trains');
const { validateRetime, applyRetime } = require('./retime');
const { validateStopsEvents } = require('./events');
const { summariseTrain } = require('./audit');

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const MAX_TRAIN_NAME = 60;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = new Set(['stop', 'shunt', 'work']);
const OPEN = new Set(['pending', 'in_review']);
const MIN_STOPS = 2;
const MAX_STOPS = 20;
const MAX_MINUTES = 240;
const MAX_OPEN = 50;
const MAX_LEN = { loco: 60, notes: 500, note: 200, alias: 60, controlNote: 300, reason: 300 };

// How a state reads in an error shown to Control or the crew.
const STATE_LABEL = {
  pending: 'waiting for Control',
  in_review: 'being plotted',
  accepted: 'accepted',
  declined: 'declined',
  withdrawn: 'withdrawn',
  cancelled: 'cancelled',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isOpen(request) {
  return OPEN.has(request.status);
}

/** Optional text: absent/null → ''; anything but a string is an error; trimmed, capped at max. */
function text(v, max, what) {
  if (v === undefined || v === null) return { value: '' };
  if (typeof v !== 'string') return { error: `${what} must be text` };
  const value = v.trim();
  if (value.length > max) return { error: `${what} is longer than ${max} characters` };
  return { value };
}

function requiredNote(v) {
  const note = text(v, MAX_LEN.controlNote, 'Note');
  if (note.error) return note;
  if (!note.value) return { error: 'A note to the crew is required' };
  return note;
}

/**
 * Checks a PathRequestSubmit against the timetable and builds the stored
 * (snake_case) request. Doesn't check the active timetable, requests_enabled
 * or the open-request cap: the route does, as they aren't about the body.
 */
function validateSubmit(tt, body, { id = randomUUID(), now = new Date().toISOString() } = {}) {
  if (!isPlainObject(body)) return { error: 'Request body must be an object' };
  const crew = typeof body.crewId === 'string' ? (tt.crews || []).find((c) => c.id === body.crewId) : null;
  if (!crew) return { error: 'Unknown crew' };
  if (!Array.isArray(body.stops) || body.stops.length < MIN_STOPS || body.stops.length > MAX_STOPS) {
    return { error: `A request needs ${MIN_STOPS} to ${MAX_STOPS} stops` };
  }

  const stations = new Map((tt.stations || []).map((s) => [s.id, s]));
  const seen = new Set();
  const stops = [];
  for (let i = 0; i < body.stops.length; i++) {
    const s = body.stops[i];
    const at = `stops[${i}]`;
    if (!isPlainObject(s)) return { error: `${at} must be an object` };
    const station = typeof s.stationId === 'string' ? stations.get(s.stationId) : undefined;
    if (!station) return { error: `${at}: unknown station` };
    if (seen.has(station.id)) return { error: `${station.name} appears twice: each station can be visited once` };
    seen.add(station.id);

    // Origin and destination are plain stops; only the points between carry work.
    let kind = 'stop';
    let minutes = 0;
    if (i > 0 && i < body.stops.length - 1) {
      if (!KINDS.has(s.kind)) return { error: `${at}: kind must be stop, shunt or work` };
      if (!Number.isInteger(s.minutes) || s.minutes < 0 || s.minutes > MAX_MINUTES) {
        return { error: `${at}: minutes must be a whole number from 0 to ${MAX_MINUTES}` };
      }
      kind = s.kind;
      minutes = s.minutes;
    }
    const alias = text(s.locationAlias, MAX_LEN.alias, `${at} siding`);
    if (alias.error) return alias;
    const note = text(s.note, MAX_LEN.note, `${at} note`);
    if (note.error) return note;
    stops.push({
      station_id: station.id,
      location_alias: station.alias_enabled && alias.value ? alias.value : null,
      kind,
      minutes,
      ...(note.value ? { note: note.value } : {}),
    });
  }

  let readyAt = null;
  if (body.readyAt !== undefined && body.readyAt !== null) {
    const t = typeof body.readyAt === 'string' ? body.readyAt.trim() : null;
    if (t === null || (t !== '' && !HHMM_RE.test(t))) return { error: 'readyAt must be HH:MM or null' };
    readyAt = t || null;
  }
  const loco = text(body.loco, MAX_LEN.loco, 'Loco');
  if (loco.error) return loco;
  const notes = text(body.notes, MAX_LEN.notes, 'Notes');
  if (notes.error) return notes;

  return {
    request: {
      id,
      timetable_id: tt.id,
      crew_id: crew.id,
      ...(loco.value ? { loco: loco.value } : {}),
      stops,
      ready_at: readyAt,
      ...(notes.value ? { notes: notes.value } : {}),
      status: 'pending',
      created_at: now,
      updated_at: now,
    },
  };
}

/**
 * The request state machine. ctx: { crewId (acting crew, crew actions), note,
 * reason, trainExists (release: the accepted train is still in the timetable),
 * trainCreated + assignedCrewId (accept: the new train's id and crew), now }.
 * Returns { ok: patch } (keys set to undefined are removed by applyPatch) or
 * { status: 400|403|409, error }.
 */
function transition(request, action, {
  crewId, note, reason, trainExists = true, trainCreated, assignedCrewId = null, now = new Date().toISOString(),
} = {}) {
  const status = request.status;
  const wrongState = (what) => ({ status: 409, error: `Can't ${what}: the request is ${STATE_LABEL[status] || status}` });
  const notRequester = (what) => (crewId !== request.crew_id
    ? { status: 403, error: `Only the crew that made this request can ${what}` }
    : null);

  switch (action) {
    case 'withdraw': {
      const denied = notRequester('withdraw it');
      if (denied) return denied;
      if (!OPEN.has(status)) return wrongState('withdraw it');
      return { ok: { status: 'withdrawn', updated_at: now } };
    }
    case 'acknowledge':
      if (status !== 'pending') return wrongState('acknowledge it');
      return { ok: { status: 'in_review', updated_at: now } };
    case 'release':
      if (status === 'in_review') return { ok: { status: 'pending', updated_at: now } };
      // Reopen: the train made from it was undone or deleted (spec §1).
      if (status === 'accepted' && !trainExists) {
        return { ok: {
          status: 'pending', updated_at: now,
          train_id_created: undefined, assigned_crew_id: undefined, control_note: undefined, cancel_ask: undefined,
        } };
      }
      if (status === 'accepted') return { status: 409, error: "Can't reopen it: its train still exists" };
      return wrongState('return it to the queue');
    case 'decline': {
      const n = requiredNote(note);
      if (n.error) return { status: 400, error: n.error };
      if (!OPEN.has(status)) return wrongState('decline it');
      return { ok: { status: 'declined', control_note: n.value, updated_at: now } };
    }
    case 'cancel-ask': {
      const r = text(reason, MAX_LEN.reason, 'Reason');
      if (r.error) return { status: 400, error: r.error };
      const denied = notRequester('ask to cancel it');
      if (denied) return denied;
      if (status !== 'accepted') return wrongState('ask to cancel it');
      if (request.cancel_ask && request.cancel_ask.status === 'open') {
        return { status: 409, error: 'Already asked to cancel: waiting for Control' };
      }
      // A new ask replaces a rejected one.
      return { ok: { cancel_ask: { at: now, ...(r.value ? { reason: r.value } : {}), status: 'open' }, updated_at: now } };
    }
    case 'cancel-reject': {
      const n = requiredNote(note);
      if (n.error) return { status: 400, error: n.error };
      if (status !== 'accepted') return wrongState('refuse the cancel');
      if (!request.cancel_ask || request.cancel_ask.status !== 'open') return { status: 409, error: 'There is no open ask to cancel' };
      return { ok: { cancel_ask: { ...request.cancel_ask, status: 'rejected', control_note: n.value }, updated_at: now } };
    }
    case 'accept': {
      const n = text(note, MAX_LEN.controlNote, 'Note');
      if (n.error) return { status: 400, error: n.error };
      if (status !== 'in_review') return wrongState('accept it');
      return { ok: {
        status: 'accepted', train_id_created: trainCreated, assigned_crew_id: assignedCrewId || null,
        control_note: n.value || undefined, updated_at: now,
      } };
    }
    case 'cancel-approve': {
      const n = text(note, MAX_LEN.controlNote, 'Note');
      if (n.error) return { status: 400, error: n.error };
      if (status !== 'accepted') return wrongState('approve the cancel');
      if (!request.cancel_ask || request.cancel_ask.status !== 'open') return { status: 409, error: 'There is no open ask to cancel' };
      const { control_note: _old, ...ask } = request.cancel_ask;
      return { ok: {
        status: 'cancelled', cancel_ask: { ...ask, status: 'approved', ...(n.value ? { control_note: n.value } : {}) }, updated_at: now,
      } };
    }
    default:
      return { status: 400, error: `Unknown action: ${action}` };
  }
}

function applyPatch(request, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete request[key];
    else request[key] = value;
  }
  return request;
}

/** Clear closed: declined/withdrawn/cancelled, and accepted unless a cancel ask is open. */
function clearClosed(requests) {
  const closed = (r) => ['declined', 'withdrawn', 'cancelled'].includes(r.status)
    || (r.status === 'accepted' && !(r.cancel_ask && r.cancel_ask.status === 'open'));
  return { kept: requests.filter((r) => !closed(r)), removed: requests.filter(closed) };
}

/** An optional string field: absent/null is fine, anything but a string is an error. */
function optionalString(v, what) {
  return v === undefined || v === null || typeof v === 'string' ? null : `${what} must be text`;
}

/**
 * Checks the train of an accept body (camelCase TrainRequest) against the
 * timetable. Stricter than POST /trains: stations must exist and be unique,
 * times must be HH:MM or null ('' counts as null), at least 2 stops must have a
 * time, and the crew must exist (''/null = unassigned). → { train } (a clean
 * body for trains.newTrain) | { error }.
 */
function validateAcceptTrain(tt, train) {
  if (!isPlainObject(train)) return { error: 'train must be an object' };
  if (typeof train.name !== 'string' || !train.name.trim()) return { error: 'Train name is required' };
  const name = train.name.trim();
  if (name.length > MAX_TRAIN_NAME) return { error: `Train name is longer than ${MAX_TRAIN_NAME} characters` };
  if (train.color !== undefined && train.color !== null && train.color !== ''
    && !(typeof train.color === 'string' && COLOR_RE.test(train.color))) {
    return { error: 'Train colour must be a #hex colour' };
  }
  for (const [key, what] of [['notes', 'Train notes'], ['trainId', 'Train ID'], ['direction', 'Direction']]) {
    const e = optionalString(train[key], what);
    if (e) return { error: e };
  }
  let crewId = null;
  if (train.crewId !== undefined && train.crewId !== null && train.crewId !== '') {
    const crew = typeof train.crewId === 'string' ? (tt.crews || []).find((c) => c.id === train.crewId) : null;
    if (!crew) return { error: 'Unknown crew' };
    crewId = crew.id;
  }

  if (!Array.isArray(train.stops)) return { error: 'train.stops must be an array' };
  const stations = new Map((tt.stations || []).map((s) => [s.id, s]));
  const seen = new Set();
  const stops = [];
  let timed = 0;
  for (let i = 0; i < train.stops.length; i++) {
    const s = train.stops[i];
    const at = `train.stops[${i}]`;
    if (!isPlainObject(s)) return { error: `${at} must be an object` };
    const station = typeof s.stationId === 'string' ? stations.get(s.stationId) : undefined;
    if (!station) return { error: `${at}: unknown station` };
    if (seen.has(station.id)) return { error: `${station.name} appears twice: each station can be visited once` };
    seen.add(station.id);
    const times = {};
    for (const key of ['arrival', 'departure']) {
      const v = s[key];
      if (v === undefined || v === null || v === '') times[key] = null;
      else if (typeof v === 'string' && HHMM_RE.test(v)) times[key] = v;
      else return { error: `${at}: ${key} must be HH:MM or null` };
    }
    if (times.arrival || times.departure) timed++;
    for (const [key, what] of [['specialInstructions', 'special instructions'], ['locationAlias', 'siding']]) {
      const e = optionalString(s[key], `${at} ${what}`);
      if (e) return { error: e };
    }
    stops.push({
      stationId: station.id, ...times,
      specialInstructions: s.specialInstructions, locationAlias: s.locationAlias, guardEvents: s.guardEvents,
    });
  }
  if (timed < 2) return { error: 'The train needs at least 2 stops with a time' };
  const ev = validateStopsEvents(train.stops);
  if (ev.error) return { error: ev.error };

  return { train: {
    name, color: train.color || undefined, notes: train.notes || '', trainId: train.trainId || '',
    direction: train.direction || '', crewId, stops,
  } };
}

/**
 * Everything accept checks, against one timetable, in the 404 → 400 → 409
 * order. → { plan: { request, train (stored), changes, patch } } |
 * { status, error, requestStatus?, conflicts? }. Pure; nothing is changed.
 */
function planAccept(tt, reqId, body, { trainId = randomUUID(), now = new Date().toISOString() } = {}) {
  const request = (tt.path_requests || []).find((r) => r.id === reqId);
  if (!request) return { status: 404, error: 'Request not found' };
  const requestStatus = request.status;
  const bad = (error) => ({ status: 400, error, requestStatus });
  if (!isPlainObject(body)) return bad('Request body must be an object');
  const t = validateAcceptTrain(tt, body.train);
  if (t.error) return bad(t.error);
  if (body.retime !== undefined && body.retime !== null && !Array.isArray(body.retime)) return bad('retime must be an array');
  const changes = body.retime || [];
  const check = changes.length ? validateRetime(tt, changes) : {};
  if (check.error) return bad(`retime: ${check.error}`);
  const r = transition(request, 'accept', { note: body.note, trainCreated: trainId, assignedCrewId: t.train.crewId, now });
  if (!r.ok) return { ...r, requestStatus };
  if (check.conflicts) {
    return { status: 409, error: `Not saved: ${check.conflicts.join('; ')}`, requestStatus, conflicts: check.conflicts };
  }
  const train = newTrain(tt.id, t.train, { request_id: request.id }, trainId);
  return { plan: { request, train, changes, patch: r.ok } };
}

/** Applies a plan from planAccept to the same timetable. → the audit detail. */
function applyAccept(tt, { request, train, changes, patch }) {
  const summary = (tr) => summariseTrain(tr, tt.stations, tt.crews);
  const before = changes.map((c) => summary(tt.trains.find((x) => x.id === c.trainId)));
  tt.trains.push(train);
  applyRetime(tt, changes);
  applyPatch(request, patch);
  const moved = changes.map((c, i) => ({
    name: before[i].name, from: before[i].stops, to: summary(tt.trains.find((x) => x.id === c.trainId)).stops,
  }));
  const detail = { train: summary(train) };
  if (request.assigned_crew_id !== request.crew_id) {
    const crew = (tt.crews || []).find((c) => c.id === request.assigned_crew_id);
    detail.assigned_crew = crew ? crew.name : null;
  }
  detail.note = request.control_note ?? null;
  detail.moved = moved;
  return detail;
}

/** What the audit entry records for a successful transition (spec §4.4). */
function detailFor(action, before, patch) {
  switch (action) {
    case 'withdraw': return { while_plotting: before.status === 'in_review' };
    case 'release': return before.status === 'accepted' ? { reopened: true, train_id: before.train_id_created ?? null } : undefined;
    case 'decline': return { note: patch.control_note };
    case 'cancel-ask': return { reason: patch.cancel_ask.reason ?? null };
    case 'cancel-reject': return { note: patch.cancel_ask.control_note };
    default: return undefined;
  }
}

/** Thrown inside a mutateTimetable callback to abort it, so nothing is written. */
class Refusal extends Error {
  constructor(status, error, requestStatus, extra = {}) {
    super(error);
    this.status = status;
    this.requestStatus = requestStatus;
    this.extra = extra;
  }
}

const ACTIONS = {
  withdraw: 'crew',
  acknowledge: 'control',
  release: 'control',
  decline: 'control',
  'cancel-ask': 'crew',
  'cancel-reject': 'control',
};

function register(app, { readDB, getTimetable, mutateTimetable, normalise, sync, audit }) {
  const base = '/api/timetables/:id/path-requests';

  /** Audit logger for one call; log(outcome, { error?, request_id?, detail? }). */
  function logger(req, { actor, action, tt, crewId = null }) {
    const crew = crewId && tt ? (tt.crews || []).find((c) => c.id === crewId) : null;
    return (outcome, fields = {}) => audit.record(req, {
      actor,
      crew_id: crewId,
      crew_name: crew ? crew.name : null,
      action,
      outcome,
      timetable_id: req.params.id,
      timetable_name: tt ? tt.name ?? null : null,
      request_id: req.params.reqId ?? null,
      ...fields,
    });
  }

  function refuse(res, log, status, error, requestStatus, extra = {}) {
    log('rejected', { error, ...(requestStatus ? { detail: { status: requestStatus } } : {}) });
    return res.status(status).json(status === 409 && requestStatus ? { error, status: requestStatus, ...extra } : { error });
  }

  /**
   * Request-only mutation (or, with notify, one that changes trains too); a
   * Refusal thrown by fn aborts it. → { tt } | { refusal }
   */
  function mutateRequests(id, fn, { notify = false } = {}) {
    try {
      return { tt: mutateTimetable(id, fn, { notify }) };
    } catch (err) {
      if (err instanceof Refusal) return { refusal: err };
      throw err;
    }
  }

  /** Success: broadcast the requests (with rev only for request-only changes) and reply. */
  function done(res, id, updated, code = 200, { requestsOnly = true } = {}) {
    sync.broadcastPathRequests(id, updated, requestsOnly ? { requestsOnly: true } : undefined);
    return res.status(code).json(normalise(updated));
  }

  app.get(base, (req, res) => {
    const tt = getTimetable(req.params.id);
    if (!tt) return res.status(404).json({ error: 'Not found' });
    res.json(normalise(tt).path_requests);
  });

  app.post(base, (req, res) => {
    const { id } = req.params;
    const tt = getTimetable(id);
    const crewId = isPlainObject(req.body) && typeof req.body.crewId === 'string' ? req.body.crewId : null;
    const log = logger(req, { actor: 'crew', action: 'submit', tt, crewId });
    if (!tt) return refuse(res, log, 404, 'Timetable not found');
    if ((readDB().active_timetable_id || null) !== id) return refuse(res, log, 400, 'Requests only go to the running session');
    if (normalise(tt).settings.requests_enabled === false) return refuse(res, log, 400, 'Path requests are turned off for this session');
    const check = validateSubmit(tt, req.body);
    if (check.error) return refuse(res, log, 400, check.error);
    const tooMany = (t) => (t.path_requests || []).filter(isOpen).length >= MAX_OPEN;
    const capError = `Too many open requests (${MAX_OPEN}): wait for Control to clear some`;
    if (tooMany(tt)) return refuse(res, log, 409, capError);

    const { request } = check;
    const result = mutateRequests(id, (t) => {
      if (tooMany(t)) throw new Refusal(409, capError);
      if (!t.path_requests) t.path_requests = [];
      t.path_requests.push(request);
    });
    if (result.refusal) return refuse(res, log, result.refusal.status, result.refusal.message);
    if (!result.tt) return refuse(res, log, 404, 'Timetable not found');
    const { stops, loco = null, ready_at, notes = null } = request;
    log('ok', { request_id: request.id, detail: { stops, loco, ready_at, notes } });
    return done(res, id, result.tt, 201);
  });

  for (const [action, actor] of Object.entries(ACTIONS)) {
    app.post(`${base}/:reqId/${action}`, (req, res) => {
      const { id, reqId } = req.params;
      const body = isPlainObject(req.body) ? req.body : {};
      const tt = getTimetable(id);
      const crewId = actor === 'crew' && typeof body.crewId === 'string' ? body.crewId : null;
      const log = logger(req, { actor, action, tt, crewId });
      if (!tt) return refuse(res, log, 404, 'Timetable not found');

      // Run against a timetable: first the one just read, then again inside the mutation.
      const attempt = (t) => {
        const request = (t.path_requests || []).find((r) => r.id === reqId);
        if (!request) return { request: null, result: { status: 404, error: 'Request not found' } };
        const trainExists = Boolean(request.train_id_created) && (t.trains || []).some((tr) => tr.id === request.train_id_created);
        return { request, result: transition(request, action, { crewId, note: body.note, reason: body.reason, trainExists }) };
      };
      const first = attempt(tt);
      if (!first.result.ok) return refuse(res, log, first.result.status, first.result.error, first.request && first.request.status);

      let detail;
      const result = mutateRequests(id, (t) => {
        const { request, result: r } = attempt(t);
        if (!r.ok) throw new Refusal(r.status, r.error, request && request.status);
        detail = detailFor(action, request, r.ok);
        applyPatch(request, r.ok);
      });
      if (result.refusal) return refuse(res, log, result.refusal.status, result.refusal.message, result.refusal.requestStatus);
      if (!result.tt) return refuse(res, log, 404, 'Timetable not found');
      log('ok', detail ? { detail } : {});
      return done(res, id, result.tt);
    });
  }

  // Accept: create the train, apply the retime, request → accepted. One notifying mutation.
  app.post(`${base}/:reqId/accept`, (req, res) => {
    const { id, reqId } = req.params;
    const tt = getTimetable(id);
    const log = logger(req, { actor: 'control', action: 'accept', tt });
    if (!tt) return refuse(res, log, 404, 'Timetable not found');
    const refuseCheck = (c) => refuse(res, log, c.status, c.error, c.requestStatus, c.conflicts ? { conflicts: c.conflicts } : {});
    const first = planAccept(tt, reqId, req.body);
    if (!first.plan) return refuseCheck(first);

    let detail;
    const result = mutateRequests(id, (t) => {
      const check = planAccept(t, reqId, req.body);
      if (!check.plan) throw new Refusal(check.status, check.error, check.requestStatus, check.conflicts ? { conflicts: check.conflicts } : {});
      detail = applyAccept(t, check.plan);
    }, { notify: true });
    if (result.refusal) {
      const { status, message, requestStatus, extra } = result.refusal;
      return refuse(res, log, status, message, requestStatus, extra);
    }
    if (!result.tt) return refuse(res, log, 404, 'Timetable not found');
    log('ok', { detail });
    return done(res, id, result.tt, 200, { requestsOnly: false });
  });

  // Approve a crew's ask to cancel: delete the train (if still there), request → cancelled.
  app.post(`${base}/:reqId/cancel-approve`, (req, res) => {
    const { id, reqId } = req.params;
    const body = isPlainObject(req.body) ? req.body : {};
    const tt = getTimetable(id);
    const log = logger(req, { actor: 'control', action: 'cancel-approve', tt });
    if (!tt) return refuse(res, log, 404, 'Timetable not found');

    const attempt = (t) => {
      const request = (t.path_requests || []).find((r) => r.id === reqId);
      if (!request) return { request: null, result: { status: 404, error: 'Request not found' } };
      return { request, result: transition(request, 'cancel-approve', { note: body.note }) };
    };
    const first = attempt(tt);
    if (!first.result.ok) return refuse(res, log, first.result.status, first.result.error, first.request && first.request.status);

    let detail;
    const result = mutateRequests(id, (t) => {
      const { request, result: r } = attempt(t);
      if (!r.ok) throw new Refusal(r.status, r.error, request && request.status);
      const train = request.train_id_created ? (t.trains || []).find((tr) => tr.id === request.train_id_created) : null;
      detail = { train: train ? summariseTrain(train, t.stations, t.crews) : null, note: r.ok.cancel_ask.control_note ?? null };
      if (train) t.trains = t.trains.filter((tr) => tr.id !== train.id);
      applyPatch(request, r.ok);
    }, { notify: true });
    if (result.refusal) return refuse(res, log, result.refusal.status, result.refusal.message, result.refusal.requestStatus);
    if (!result.tt) return refuse(res, log, 404, 'Timetable not found');
    log('ok', { detail });
    return done(res, id, result.tt, 200, { requestsOnly: false });
  });

  app.delete(base, (req, res) => {
    const { id } = req.params;
    const tt = getTimetable(id);
    const log = logger(req, { actor: 'control', action: 'clear', tt });
    if (!tt) return refuse(res, log, 404, 'Timetable not found');
    if (!req.query || req.query.closed !== 'true') return refuse(res, log, 400, 'Only ?closed=true is supported');
    // Nothing to clear → no write, no rev bump.
    if (clearClosed(tt.path_requests || []).removed.length === 0) {
      log('ok', { detail: { removed: [] } });
      return res.json(normalise(tt));
    }
    let removed = [];
    const result = mutateRequests(id, (t) => {
      const split = clearClosed(t.path_requests || []);
      t.path_requests = split.kept;
      removed = split.removed.map((r) => r.id);
    });
    if (!result.tt) return refuse(res, log, 404, 'Timetable not found');
    log('ok', { detail: { removed } });
    return done(res, id, result.tt);
  });
}

module.exports = {
  register, validateSubmit, transition, validateAcceptTrain, planAccept, applyAccept, applyPatch, clearClosed, isOpen, MAX_OPEN,
};
