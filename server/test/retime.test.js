const { test } = require('node:test');
const assert = require('node:assert');
const { validateRetime, applyRetime, register } = require('../retime');

const tt = () => ({
  trains: [
    { id: 'kn6', name: 'KN-6', stops: [
      { id: 'a', station_id: 'kia', arrival: '13:18', departure: null, special_instructions: 'keep me', guard_events: [{ id: 'g' }] },
      { id: 'b', station_id: 'bry', arrival: '12:32', departure: '12:50', location_alias: 'Berry Loop' },
      { id: 'c', station_id: 'now', arrival: null, departure: '12:10' },
    ] },
    { id: 'c402', name: 'C402', stops: [{ id: 'd', station_id: 'kia', arrival: null, departure: '05:19' }, { id: 'e', station_id: 'sta', arrival: '06:03', departure: null }] },
  ],
});
const moveKn6 = { trainId: 'kn6', times: [
  { stationId: 'now', arrival: null, departure: '12:15' },
  { stationId: 'bry', arrival: '12:37', departure: '12:55' },
  { stationId: 'kia', arrival: '13:23', departure: null },
] };

test('applies times only, matched by station; other fields untouched', () => {
  const t = tt();
  assert.deepStrictEqual(validateRetime(t, [moveKn6]), {});
  applyRetime(t, [moveKn6]);
  const s = t.trains[0].stops;
  assert.deepStrictEqual(s.map((x) => [x.id, x.arrival, x.departure]), [['a', '13:23', null], ['b', '12:37', '12:55'], ['c', null, '12:15']]);
  assert.strictEqual(s[0].special_instructions, 'keep me');
  assert.deepStrictEqual(s[0].guard_events, [{ id: 'g' }]);
  assert.strictEqual(s[1].location_alias, 'Berry Loop');
});

test('stops changed since the drag → conflict, nothing applied', () => {
  const t = tt();
  t.trains[0].stops.pop(); // Control removed Nowra after the drag
  const r = validateRetime(t, [moveKn6]);
  assert.deepStrictEqual(r.conflicts, ["KN-6's stops were changed after it was moved"]);
  assert.ok(validateRetime(tt(), [{ trainId: 'gone', times: [] }]).conflicts[0].includes('no longer exists'));
});

test('malformed requests are rejected', () => {
  const t = tt();
  assert.ok(validateRetime(t, []).error);
  assert.ok(validateRetime(t, 'x').error);
  assert.ok(validateRetime(t, [{ trainId: 'kn6' }]).error);
  assert.ok(validateRetime(t, [{ ...moveKn6, times: [{ stationId: 'now', arrival: null, departure: '25:00' }] }]).error);
  assert.ok(validateRetime(t, [moveKn6, moveKn6]).error);
});

test('route: all-or-nothing, 409 on conflict, one mutation for the batch', () => {
  let routes = {};
  let mutations = 0;
  const db = tt();
  register({ post: (p, h) => { routes[p] = h; } }, {
    getTimetable: () => db,
    mutateTimetable: (_id, fn) => { mutations++; fn(db); return db; },
    normalise: (x) => x,
  });
  const call = (body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    routes['/api/timetables/:id/trains/retime']({ params: { id: 'x' }, body }, res);
    return res;
  };
  const c402 = { trainId: 'c402', times: [{ stationId: 'kia', arrival: null, departure: '05:00' }, { stationId: 'sta', arrival: '05:44', departure: null }] };
  const bad = { trainId: 'kn6', times: moveKn6.times.slice(1) };
  assert.strictEqual(call({ changes: [c402, bad] }).code, 409);
  assert.strictEqual(mutations, 0);
  assert.strictEqual(db.trains[1].stops[0].departure, '05:19');
  assert.strictEqual(call({ changes: [c402, moveKn6] }).code, 200);
  assert.strictEqual(mutations, 1);
  assert.strictEqual(db.trains[1].stops[0].departure, '05:00');
});
