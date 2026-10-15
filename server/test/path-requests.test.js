const { test } = require('node:test');
const assert = require('node:assert');
const { validateSubmit, transition, applyPatch, clearClosed, register, MAX_OPEN } = require('../path-requests');

const NOW = '2026-10-15T04:00:00.000Z';

const timetable = (over = {}) => ({
  id: 'tt',
  name: 'Session 1',
  rev: 1,
  settings: {},
  crews: [{ id: 'c1', name: 'Crew 1' }, { id: 'c2', name: 'Crew 2' }],
  stations: [
    { id: 'kia', name: 'Kiama', alias_enabled: true },
    { id: 'bom', name: 'Bombo' },
    { id: 'dun', name: 'Dunmore', alias_enabled: true },
    { id: 'mtk', name: 'Minnamurra' },
  ],
  trains: [{ id: 't1', name: 'PR1', stops: [] }],
  path_requests: [],
  ...over,
});

const submit = (over = {}) => ({
  crewId: 'c1',
  loco: ' 3001 ',
  stops: [
    { stationId: 'kia', locationAlias: ' Rd 2 ', kind: 'shunt', minutes: 30 },
    { stationId: 'bom', locationAlias: 'ignored', kind: 'shunt', minutes: 20, note: ' drop 2 wagons ' },
    { stationId: 'dun', locationAlias: '  ', kind: 'stop', minutes: 0 },
  ],
  readyAt: '14:20',
  notes: ' after 23L ',
  ...over,
});

const request = (over = {}) => ({
  id: 'r1', timetable_id: 'tt', crew_id: 'c1', stops: [], ready_at: null,
  status: 'pending', created_at: NOW, updated_at: NOW, ...over,
});

// ── validateSubmit ───────────────────────────────────────────────────────────

test('validateSubmit builds the stored request: trimmed, terminals forced to stop/0, aliases where enabled', () => {
  const { request: r, error } = validateSubmit(timetable(), submit(), { id: 'new', now: NOW });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(r, {
    id: 'new', timetable_id: 'tt', crew_id: 'c1', loco: '3001',
    stops: [
      { station_id: 'kia', location_alias: 'Rd 2', kind: 'stop', minutes: 0 },
      { station_id: 'bom', location_alias: null, kind: 'shunt', minutes: 20, note: 'drop 2 wagons' },
      { station_id: 'dun', location_alias: null, kind: 'stop', minutes: 0 },
    ],
    ready_at: '14:20', notes: 'after 23L', status: 'pending', created_at: NOW, updated_at: NOW,
  });
});

test('validateSubmit: optional fields absent or empty', () => {
  const body = { crewId: 'c2', stops: [{ stationId: 'kia' }, { stationId: 'bom' }] };
  const { request: r } = validateSubmit(timetable(), body);
  assert.ok(r.id && r.created_at === r.updated_at);
  assert.strictEqual(r.ready_at, null);
  assert.ok(!('loco' in r) && !('notes' in r));
  assert.strictEqual(validateSubmit(timetable(), { ...body, readyAt: null, loco: '', notes: '  ' }).request.ready_at, null);
  assert.strictEqual(validateSubmit(timetable(), { ...body, readyAt: '' }).request.ready_at, null, "'' = as soon as possible");
  // Boundaries that pass
  const twenty = Array.from({ length: 20 }, (_, i) => ({ stationId: `s${i}`, kind: 'work', minutes: 240 }));
  const big = timetable({ stations: twenty.map((s) => ({ id: s.stationId, name: s.stationId })) });
  assert.ok(validateSubmit(big, { crewId: 'c1', stops: twenty, readyAt: '23:59', notes: 'x'.repeat(500), loco: 'l'.repeat(60) }).request);
});

test('validateSubmit rejects malformed bodies cleanly', () => {
  const tt = timetable();
  const bad = (body, why) => assert.ok(validateSubmit(tt, body).error, why || JSON.stringify(body));
  const stops = submit().stops;
  const mid = (patch) => submit({ stops: [stops[0], { ...stops[1], ...patch }, stops[2]] });
  bad(undefined); bad(null); bad([]); bad('x');
  bad(submit({ crewId: 'nobody' })); bad(submit({ crewId: 5 })); bad(submit({ crewId: undefined }));
  bad(submit({ stops: 'x' })); bad(submit({ stops: [stops[0]] }), 'one stop');
  bad(submit({ stops: Array.from({ length: 21 }, () => stops[0]) }), '21 stops');
  bad(submit({ stops: [stops[0], null] })); bad(submit({ stops: [stops[0], 'bom'] }));
  bad(submit({ stops: [stops[0], { stationId: 'gone' }] }));
  bad(submit({ stops: [stops[0], { stationId: 5 }] }));
  bad(submit({ stops: [stops[0], stops[1], { stationId: 'kia' }] }), 'duplicate station');
  bad(mid({ kind: 'drive' })); bad(mid({ kind: undefined }));
  bad(mid({ minutes: -1 })); bad(mid({ minutes: 241 })); bad(mid({ minutes: 2.5 })); bad(mid({ minutes: '20' })); bad(mid({ minutes: NaN }));
  bad(mid({ note: 'x'.repeat(201) })); bad(mid({ note: 7 }));
  bad(submit({ stops: [{ ...stops[0], locationAlias: 'x'.repeat(61) }, stops[1]] }));
  bad(submit({ stops: [{ ...stops[0], locationAlias: {} }, stops[1]] }));
  bad(submit({ readyAt: '24:00' })); bad(submit({ readyAt: '9:05' })); bad(submit({ readyAt: 905 })); bad(submit({ readyAt: '14:60' }));
  bad(submit({ loco: 'x'.repeat(61) })); bad(submit({ loco: 3001 }));
  bad(submit({ notes: 'x'.repeat(501) })); bad(submit({ notes: ['a'] }));
});

test('validateSubmit ignores kind and minutes on the origin and destination', () => {
  const body = submit({ stops: [{ stationId: 'kia', kind: 'nonsense', minutes: 999 }, { stationId: 'bom', kind: 'work', minutes: -5 }] });
  const { request: r } = validateSubmit(timetable(), body);
  assert.deepStrictEqual(r.stops.map((s) => [s.kind, s.minutes]), [['stop', 0], ['stop', 0]]);
});

// ── transition ───────────────────────────────────────────────────────────────

test('transition: withdraw (crew) from pending or in_review only', () => {
  assert.deepStrictEqual(transition(request(), 'withdraw', { crewId: 'c1', now: NOW }), { ok: { status: 'withdrawn', updated_at: NOW } });
  assert.ok(transition(request({ status: 'in_review' }), 'withdraw', { crewId: 'c1' }).ok);
  for (const status of ['accepted', 'declined', 'withdrawn', 'cancelled']) {
    assert.strictEqual(transition(request({ status }), 'withdraw', { crewId: 'c1' }).status, 409, status);
  }
  assert.strictEqual(transition(request(), 'withdraw', { crewId: 'c2' }).status, 403);
  assert.strictEqual(transition(request(), 'withdraw', {}).status, 403, 'no crew given');
  assert.strictEqual(transition(request({ status: 'accepted' }), 'withdraw', { crewId: 'c2' }).status, 403, '403 before 409');
});

test('transition: acknowledge pending → in_review only', () => {
  assert.deepStrictEqual(transition(request(), 'acknowledge', { now: NOW }).ok, { status: 'in_review', updated_at: NOW });
  for (const status of ['in_review', 'accepted', 'declined', 'withdrawn', 'cancelled']) {
    const r = transition(request({ status }), 'acknowledge');
    assert.strictEqual(r.status, 409, status);
    assert.ok(r.error);
  }
  assert.match(transition(request({ status: 'withdrawn' }), 'acknowledge').error, /withdrawn/);
});

test('transition: release in_review → pending; reopen only an accept whose train is gone', () => {
  assert.deepStrictEqual(transition(request({ status: 'in_review' }), 'release', { now: NOW }).ok, { status: 'pending', updated_at: NOW });
  assert.strictEqual(transition(request(), 'release').status, 409);
  assert.strictEqual(transition(request({ status: 'declined' }), 'release', { trainExists: false }).status, 409);
  const accepted = request({ status: 'accepted', train_id_created: 't9', assigned_crew_id: 'c2', control_note: 'n', cancel_ask: { at: NOW, status: 'open' } });
  assert.strictEqual(transition(accepted, 'release', { trainExists: true }).status, 409);
  const reopened = applyPatch({ ...accepted }, transition(accepted, 'release', { trainExists: false, now: NOW }).ok);
  assert.deepStrictEqual(reopened, request({ status: 'pending' }));
});

test('transition: decline needs a note and an open request', () => {
  assert.deepStrictEqual(transition(request({ status: 'in_review' }), 'decline', { note: ' Line blocked ', now: NOW }).ok,
    { status: 'declined', control_note: 'Line blocked', updated_at: NOW });
  for (const note of [undefined, '', '   ', 5, 'x'.repeat(301)]) {
    assert.strictEqual(transition(request(), 'decline', { note }).status, 400, String(note));
  }
  assert.ok(transition(request(), 'decline', { note: 'x'.repeat(300) }).ok);
  assert.strictEqual(transition(request({ status: 'accepted' }), 'decline', { note: 'n' }).status, 409);
});

test('transition: cancel-ask and cancel-reject, and asking again after a rejection', () => {
  const accepted = request({ status: 'accepted', train_id_created: 't1' });
  assert.strictEqual(transition(request(), 'cancel-ask', { crewId: 'c1' }).status, 409, 'not accepted yet');
  assert.strictEqual(transition(accepted, 'cancel-ask', { crewId: 'c2' }).status, 403);
  assert.strictEqual(transition(accepted, 'cancel-ask', { crewId: 'c1', reason: 'x'.repeat(301) }).status, 400);
  assert.strictEqual(transition(accepted, 'cancel-ask', { crewId: 'c1', reason: 5 }).status, 400);
  assert.deepStrictEqual(transition(accepted, 'cancel-ask', { crewId: 'c1', now: NOW }).ok.cancel_ask, { at: NOW, status: 'open' });
  const asked = applyPatch({ ...accepted }, transition(accepted, 'cancel-ask', { crewId: 'c1', reason: ' loco failed ', now: NOW }).ok);
  assert.deepStrictEqual(asked.cancel_ask, { at: NOW, reason: 'loco failed', status: 'open' });
  assert.strictEqual(transition(asked, 'cancel-ask', { crewId: 'c1' }).status, 409, 'one open ask at a time');

  assert.strictEqual(transition(asked, 'cancel-reject', { note: '' }).status, 400);
  assert.strictEqual(transition(accepted, 'cancel-reject', { note: 'n' }).status, 409, 'no ask');
  assert.strictEqual(transition(request(), 'cancel-reject', { note: 'n' }).status, 409);
  const refused = applyPatch({ ...asked }, transition(asked, 'cancel-reject', { note: 'Needed for 23L', now: NOW }).ok);
  assert.strictEqual(refused.status, 'accepted');
  assert.deepStrictEqual(refused.cancel_ask, { at: NOW, reason: 'loco failed', status: 'rejected', control_note: 'Needed for 23L' });
  assert.strictEqual(transition(refused, 'cancel-reject', { note: 'n' }).status, 409, 'already rejected');
  const again = transition(refused, 'cancel-ask', { crewId: 'c1', now: 'later' }).ok;
  assert.deepStrictEqual(again.cancel_ask, { at: 'later', status: 'open' }, 'a new ask replaces the rejected one');
});

test('transition: unknown action → 400', () => {
  assert.strictEqual(transition(request(), 'accept').status, 400);
});

test('clearClosed keeps open requests and accepted ones with an open cancel ask', () => {
  const rs = [
    request({ id: 'p' }), request({ id: 'i', status: 'in_review' }),
    request({ id: 'a', status: 'accepted' }), request({ id: 'ar', status: 'accepted', cancel_ask: { status: 'rejected' } }),
    request({ id: 'ao', status: 'accepted', cancel_ask: { status: 'open' } }),
    request({ id: 'd', status: 'declined' }), request({ id: 'w', status: 'withdrawn' }), request({ id: 'c', status: 'cancelled' }),
  ];
  const { kept, removed } = clearClosed(rs);
  assert.deepStrictEqual(kept.map((r) => r.id), ['p', 'i', 'ao']);
  assert.deepStrictEqual(removed.map((r) => r.id), ['a', 'ar', 'd', 'w', 'c']);
});

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * register() against a fake app and fake deps. mutateTimetable works like
 * db.js: the callback mutates a fresh copy and a throw leaves the store as it was.
 */
function harness({ active = 'tt', tt = timetable() } = {}) {
  const h = { store: tt, staleRead: null, audits: [], broadcasts: [], mutations: [] };
  const routes = {};
  const app = {};
  for (const m of ['get', 'post', 'delete']) app[m] = (p, fn) => { routes[`${m.toUpperCase()} ${p}`] = fn; };
  register(app, {
    readDB: () => ({ active_timetable_id: active }),
    getTimetable: (id) => {
      if (id !== 'tt') return null;
      const read = h.staleRead || h.store;
      h.staleRead = null;
      return structuredClone(read);
    },
    mutateTimetable: (id, fn, opts) => {
      h.mutations.push(opts);
      if (id !== 'tt') return null;
      const copy = structuredClone(h.store);
      fn(copy);
      copy.rev += 1;
      h.store = copy;
      return copy;
    },
    normalise: (t) => ({ ...t, path_requests: t.path_requests ?? [], settings: { requests_enabled: true, ...(t.settings ?? {}) } }),
    sync: { broadcastPathRequests: (id, t, o) => h.broadcasts.push({ id, rev: t.rev, opts: o, requests: t.path_requests }) },
    audit: { record: (req, fields) => { h.audits.push(fields); return fields; } },
  });
  h.call = (key, { params = {}, body, query = {} } = {}) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const handler = routes[key];
    assert.ok(handler, `no route ${key}`);
    handler({ params: { id: 'tt', ...params }, body, query, ip: '10.0.0.2', headers: {} }, res);
    return res;
  };
  h.submit = (body, id = 'tt') => h.call('POST /api/timetables/:id/path-requests', { params: { id }, body });
  h.act = (action, reqId, body) => h.call(`POST /api/timetables/:id/path-requests/:reqId/${action}`, { params: { reqId }, body });
  h.lastAudit = () => h.audits[h.audits.length - 1];
  h.find = (id) => h.store.path_requests.find((r) => r.id === id);
  return h;
}

test('submit: 201, stored pending, notify:false, broadcast with rev, audited as the crew', () => {
  const h = harness();
  const res = h.submit(submit());
  assert.strictEqual(res.code, 201);
  assert.strictEqual(res.body.path_requests.length, 1);
  const stored = h.store.path_requests[0];
  assert.strictEqual(stored.status, 'pending');
  assert.strictEqual(stored.crew_id, 'c1');
  assert.deepStrictEqual(h.mutations, [{ notify: false }]);
  assert.deepStrictEqual(h.broadcasts, [{ id: 'tt', rev: 2, opts: { requestsOnly: true }, requests: h.store.path_requests }]);
  const a = h.lastAudit();
  assert.deepStrictEqual({ ...a, detail: undefined }, {
    actor: 'crew', crew_id: 'c1', crew_name: 'Crew 1', action: 'submit', outcome: 'ok',
    timetable_id: 'tt', timetable_name: 'Session 1', request_id: stored.id, detail: undefined,
  });
  assert.deepStrictEqual(a.detail, { stops: stored.stops, loco: '3001', ready_at: '14:20', notes: 'after 23L' });
});

test('submit: only to the active timetable, only when enabled; rejections audited, nothing written', () => {
  const inactive = harness({ active: 'other' });
  let res = inactive.submit(submit());
  assert.strictEqual(res.code, 400);
  assert.match(res.body.error, /running session/);
  assert.strictEqual(inactive.mutations.length, 0);
  assert.deepStrictEqual(
    [inactive.lastAudit().outcome, inactive.lastAudit().error, inactive.lastAudit().request_id],
    ['rejected', res.body.error, null],
  );
  assert.strictEqual(harness({ active: null }).submit(submit()).code, 400);

  const off = harness({ tt: timetable({ settings: { requests_enabled: false } }) });
  assert.strictEqual(off.submit(submit()).code, 400);
  assert.strictEqual(off.mutations.length, 0);

  const h = harness();
  res = h.submit(submit(), 'gone');
  assert.strictEqual(res.code, 404);
  assert.deepStrictEqual([h.lastAudit().outcome, h.lastAudit().timetable_id, h.lastAudit().timetable_name], ['rejected', 'gone', null]);
  for (const body of [undefined, null, [], 'x', 5, { crewId: 'c1', stops: [{}, {}] }]) {
    assert.strictEqual(h.submit(body).code, 400, JSON.stringify(body));
  }
  const bad = h.submit(submit({ crewId: 'c2', stops: [] }));
  assert.strictEqual(bad.code, 400);
  assert.deepStrictEqual([h.lastAudit().crew_id, h.lastAudit().crew_name], ['c2', 'Crew 2']);
  assert.strictEqual(h.mutations.length, 0);
  assert.strictEqual(h.broadcasts.length, 0);
  assert.strictEqual(h.audits.length, 8);
});

test(`submit: at most ${MAX_OPEN} open requests per timetable (closed ones don't count)`, () => {
  const open = Array.from({ length: MAX_OPEN - 1 }, (_, i) => request({ id: `o${i}`, status: i % 2 ? 'pending' : 'in_review' }));
  const closed = ['accepted', 'declined', 'withdrawn', 'cancelled'].map((status, i) => request({ id: `c${i}`, status }));
  const h = harness({ tt: timetable({ path_requests: [...open, ...closed] }) });
  assert.strictEqual(h.submit(submit()).code, 201, `${MAX_OPEN}th open request`);
  const res = h.submit(submit());
  assert.strictEqual(res.code, 409);
  assert.match(res.body.error, /Too many open requests/);
  assert.strictEqual(h.lastAudit().outcome, 'rejected');
  assert.strictEqual(h.mutations.length, 1);
});

test('withdraw-then-acknowledge race: the acknowledge gets 409 with the current status', () => {
  const h = harness({ tt: timetable({ path_requests: [request()] }) });
  assert.strictEqual(h.act('withdraw', 'r1', { crewId: 'c1' }).code, 200);
  assert.strictEqual(h.find('r1').status, 'withdrawn');
  const res = h.act('acknowledge', 'r1');
  assert.strictEqual(res.code, 409);
  assert.deepStrictEqual(res.body, { error: res.body.error, status: 'withdrawn' });
  assert.strictEqual(h.mutations.length, 1);
  assert.deepStrictEqual(
    [h.lastAudit().actor, h.lastAudit().action, h.lastAudit().outcome, h.lastAudit().request_id, h.lastAudit().detail],
    ['control', 'acknowledge', 'rejected', 'r1', { status: 'withdrawn' }],
  );
});

test('state is re-checked inside the mutation: a stale read still gets 409 and nothing is written', () => {
  const h = harness({ tt: timetable({ path_requests: [request({ status: 'withdrawn' })] }) });
  h.staleRead = timetable({ path_requests: [request()] }); // the handler's first read saw it pending
  const res = h.act('acknowledge', 'r1');
  assert.strictEqual(res.code, 409);
  assert.strictEqual(res.body.status, 'withdrawn');
  assert.strictEqual(h.mutations.length, 1, 'the mutation ran');
  assert.strictEqual(h.store.rev, 1, 'but aborted: no write, no rev bump');
  assert.strictEqual(h.find('r1').status, 'withdrawn');
  assert.strictEqual(h.broadcasts.length, 0);
  assert.strictEqual(h.lastAudit().outcome, 'rejected');
});

test('withdraw while plotting is noted; another crew gets 403', () => {
  const h = harness({ tt: timetable({ path_requests: [request({ status: 'in_review' })] }) });
  let res = h.act('withdraw', 'r1', { crewId: 'c2' });
  assert.strictEqual(res.code, 403);
  assert.deepStrictEqual([h.lastAudit().actor, h.lastAudit().crew_id, h.lastAudit().crew_name, h.lastAudit().outcome], ['crew', 'c2', 'Crew 2', 'rejected']);
  assert.strictEqual(h.act('withdraw', 'r1', {}).code, 403);
  assert.strictEqual(h.act('withdraw', 'r1').code, 403, 'no body');
  assert.strictEqual(h.mutations.length, 0);
  res = h.act('withdraw', 'r1', { crewId: 'c1' });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.path_requests[0].status, 'withdrawn');
  assert.deepStrictEqual(h.lastAudit().detail, { while_plotting: true });
  assert.deepStrictEqual(h.mutations, [{ notify: false }]);
  assert.deepStrictEqual(h.broadcasts.map((b) => b.opts), [{ requestsOnly: true }]);
  assert.notStrictEqual(h.find('r1').updated_at, NOW, 'updated_at moves');
});

test('acknowledge, release and decline as Control', () => {
  const h = harness({ tt: timetable({ path_requests: [request()] }) });
  assert.strictEqual(h.act('acknowledge', 'r1').code, 200);
  assert.deepStrictEqual([h.lastAudit().actor, h.lastAudit().crew_id, h.lastAudit().crew_name, h.lastAudit().outcome], ['control', null, null, 'ok']);
  assert.ok(!('detail' in h.lastAudit()));
  assert.strictEqual(h.find('r1').status, 'in_review');
  assert.strictEqual(h.act('release', 'r1').code, 200);
  assert.strictEqual(h.find('r1').status, 'pending');
  assert.strictEqual(h.act('release', 'r1').code, 409);

  assert.strictEqual(h.act('decline', 'r1', { note: '  ' }).code, 400);
  assert.strictEqual(h.lastAudit().outcome, 'rejected');
  const res = h.act('decline', 'r1', { note: ' Main line blocked ' });
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual([h.find('r1').status, h.find('r1').control_note], ['declined', 'Main line blocked']);
  assert.deepStrictEqual(h.lastAudit().detail, { note: 'Main line blocked' });
  assert.strictEqual(h.act('decline', 'r1', { note: 'again' }).code, 409);
  assert.strictEqual(h.mutations.length, 3, 'failed calls never reach the store');
  assert.ok(h.mutations.every((m) => m.notify === false));
  assert.deepStrictEqual(h.broadcasts.map((b) => b.rev), [2, 3, 4]);
});

test('unknown request → 404, audited with its id', () => {
  const h = harness();
  const res = h.act('acknowledge', 'nope');
  assert.strictEqual(res.code, 404);
  assert.deepStrictEqual([h.lastAudit().outcome, h.lastAudit().request_id], ['rejected', 'nope']);
  assert.strictEqual(h.call('POST /api/timetables/:id/path-requests/:reqId/withdraw', { params: { id: 'gone', reqId: 'r1' }, body: { crewId: 'c1' } }).code, 404);
});

test('ask to cancel → reject → ask again', () => {
  const h = harness({ tt: timetable({ path_requests: [request({ status: 'accepted', train_id_created: 't1' })] }) });
  assert.strictEqual(h.act('cancel-ask', 'r1', { crewId: 'c2' }).code, 403);
  assert.strictEqual(h.act('cancel-ask', 'r1', { crewId: 'c1', reason: 'Loco failed' }).code, 200);
  assert.deepStrictEqual([h.lastAudit().actor, h.lastAudit().crew_name, h.lastAudit().detail], ['crew', 'Crew 1', { reason: 'Loco failed' }]);
  assert.strictEqual(h.find('r1').cancel_ask.status, 'open');
  const twice = h.act('cancel-ask', 'r1', { crewId: 'c1' });
  assert.deepStrictEqual([twice.code, twice.body.status], [409, 'accepted']);

  assert.strictEqual(h.act('cancel-reject', 'r1', {}).code, 400);
  assert.strictEqual(h.act('cancel-reject', 'r1', { note: 'Needed for 23L' }).code, 200);
  assert.deepStrictEqual(h.lastAudit().detail, { note: 'Needed for 23L' });
  assert.deepStrictEqual([h.find('r1').status, h.find('r1').cancel_ask.status, h.find('r1').cancel_ask.control_note], ['accepted', 'rejected', 'Needed for 23L']);

  assert.strictEqual(h.act('cancel-ask', 'r1', { crewId: 'c1' }).code, 200);
  assert.deepStrictEqual(h.lastAudit().detail, { reason: null });
  assert.strictEqual(h.find('r1').cancel_ask.status, 'open');
  assert.ok(!('reason' in h.find('r1').cancel_ask));
});

test('release reopens an accepted request whose train is gone, not one whose train exists', () => {
  const accepted = { status: 'accepted', assigned_crew_id: 'c2', control_note: 'go', cancel_ask: { at: NOW, status: 'rejected' } };
  const h = harness({ tt: timetable({ path_requests: [
    request({ ...accepted, train_id_created: 't1' }),
    request({ ...accepted, id: 'r2', train_id_created: 'undone' }),
  ] }) });
  const kept = h.act('release', 'r1');
  assert.deepStrictEqual([kept.code, kept.body.status], [409, 'accepted']);
  assert.strictEqual(h.act('release', 'r2').code, 200);
  assert.deepStrictEqual(h.find('r2'), { ...request({ id: 'r2', status: 'pending' }), updated_at: h.find('r2').updated_at });
  assert.deepStrictEqual(h.lastAudit().detail, { reopened: true, train_id: 'undone' });
});

test('clear closed: removes closed ones, keeps open asks; no-op makes no write; needs ?closed=true', () => {
  const h = harness({ tt: timetable({ path_requests: [
    request({ id: 'p' }),
    request({ id: 'a', status: 'accepted' }),
    request({ id: 'ao', status: 'accepted', cancel_ask: { at: NOW, status: 'open' } }),
    request({ id: 'd', status: 'declined' }),
  ] }) });
  const clear = (query) => h.call('DELETE /api/timetables/:id/path-requests', { query });
  assert.strictEqual(clear({}).code, 400);
  assert.deepStrictEqual([h.lastAudit().action, h.lastAudit().actor, h.lastAudit().outcome], ['clear', 'control', 'rejected']);
  const res = clear({ closed: 'true' });
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.body.path_requests.map((r) => r.id), ['p', 'ao']);
  assert.deepStrictEqual(h.lastAudit().detail, { removed: ['a', 'd'] });
  assert.deepStrictEqual(h.mutations, [{ notify: false }]);
  assert.strictEqual(h.broadcasts.length, 1);
  assert.strictEqual(clear({ closed: 'true' }).code, 200);
  assert.deepStrictEqual(h.lastAudit().detail, { removed: [] });
  assert.strictEqual(h.mutations.length, 1, 'nothing to clear → no write');
});

test('GET list: the requests, not audited; 404 for a missing timetable', () => {
  const h = harness({ tt: timetable({ path_requests: [request()] }) });
  const res = h.call('GET /api/timetables/:id/path-requests');
  assert.deepStrictEqual(res.body.map((r) => r.id), ['r1']);
  assert.deepStrictEqual(harness({ tt: { ...timetable(), path_requests: undefined } }).call('GET /api/timetables/:id/path-requests').body, []);
  assert.strictEqual(h.call('GET /api/timetables/:id/path-requests', { params: { id: 'gone' } }).code, 404);
  assert.strictEqual(h.audits.length, 0);
});
