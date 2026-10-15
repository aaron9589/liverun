const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { validatePlacement, validateStopsEvents, validateEventsConfig } = require('../events');
const { validateLayout } = require('../layout');

const station = (over = {}) => ({ id: 'p1', kind: 'station', messages: ['Hi'], probability: 0.5, trigger: 'door_open', delay_s: [0, 20], ...over });
const enroute = (over = {}) => ({ id: 'p1', kind: 'enroute', messages: ['Hi'], probability: 1, at: [0.2, 0.8], ...over });
const err = (p) => validatePlacement(p, 'x', new Set());

test('valid placements pass', () => {
  assert.strictEqual(err(station()), null);
  assert.strictEqual(err(enroute()), null);
  assert.strictEqual(err({ id: 'a', event: 'lib', probability: 0.3, trigger: 'door_close', delay_s: [0, 20] }), null);
  assert.strictEqual(err({ id: 'a', event: 'lib', messages: null, probability: 0.3, at: [0, 1] }), null);
});

test('invalid placements fail', () => {
  for (const p of [
    null, station({ id: '' }), station({ id: 5 }), station({ kind: 'x' }), station({ messages: [] }), station({ messages: [''] }),
    station({ messages: ['a'.repeat(501)] }), station({ probability: 1.1 }), station({ probability: -1 }), station({ probability: '1' }),
    station({ trigger: 'nope' }), station({ delay_s: [5, 1] }), station({ delay_s: [0, 601] }), station({ delay_s: [0] }),
    station({ at: [0, 1] }), enroute({ trigger: 'door_open' }), enroute({ delay_s: [0, 1] }),
    enroute({ at: [0.8, 0.2] }), enroute({ at: [0, 1.5] }), { id: 'a', event: '', probability: 1 },
    { id: 'a', event: 'lib', kind: 'station', probability: 1 }, { id: 'a', event: 'lib', messages: [], probability: 1 },
  ]) assert.ok(err(p), JSON.stringify(p));
});

test('placement ids must be unique within a stop', () => {
  assert.ok(validateStopsEvents([{ guardEvents: [station(), enroute()] }]).error);
  assert.ok(validateStopsEvents([{ guardEvents: [station(), enroute({ id: 'p2' })] }]).ok);
  assert.ok(validateStopsEvents([{}, { guardEvents: 'x' }]).error);
});

test('events config validation', () => {
  const soundError = (v) => (v && v.includes('/') ? 'bad' : null);
  const re = /^[a-z0-9_]{1,40}$/;
  const def = (o = {}) => ({ id: 'brakes', name: 'Brakes', kind: 'enroute', messages: ['x'], sound: '', ...o });
  assert.strictEqual(validateEventsConfig({ library: [def(), def({ id: 'b-2', action: 'brake_squeal' })], publish_topic: 'a/b' }, soundError, re), null);
  for (const bad of [
    { library: 'x' }, { library: [def({ id: 'Bad Id' })] }, { library: [def({ id: '' })] }, { library: [def(), def()] },
    { library: [def({ name: ' ' })] }, { library: [def({ kind: 'z' })] }, { library: [def({ messages: [] })] },
    { library: [def({ sound: 'a/b.mp3' })] }, { library: [def({ action: 'Bad Action' })] },
    { publish_topic: 'a/#' }, { publish_topic: 'a/+/b' }, { publish_topic: 'x'.repeat(201) }, { publish_topic: 5 },
  ]) assert.ok(validateEventsConfig(bad, soundError, re), JSON.stringify(bad));
  assert.ok(validateLayout({ events: { library: [{ id: 'x', name: 'X', kind: 'station', messages: ['m'], sound: '../x.mp3' }] } }).error);
  assert.ok(validateLayout({ events: { library: [{ id: 'x', name: 'X', kind: 'station', messages: ['m'], sound: 'a.mp3' }], publish_topic: '' } }).layout);
});

// ── Route-level: real server process on a temp DB ──

const PORT = 3026;
const base = `http://localhost:${PORT}`;
const j = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
};

test('routes: validation, hiding', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-events-'));
  const now = new Date().toISOString();
  const stn = (id, name, pos) => ({ id, timetable_id: 'tt', name, short_code: name.slice(0, 3), distance: null, graph_pos: pos, sort_order: pos, branch_name: null });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ active_timetable_id: 'tt', timetables: [{
    id: 'tt', name: 'T', description: '', start_time: '06:00', end_time: '12:00', created_at: now, updated_at: now,
    stations: [stn('s1', 'Kiama', 0), stn('s2', 'Berry', 10), stn('s3', 'Nowra', 20)], crews: [], paths: [], trains: [],
    settings: { clock_enabled: false, clock_broker_url: '', clock_topic: 'x', auto_assign_min_break: 0, graph_scale: null },
  }] }));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'db.json'), NODE_ENV: 'test' }, stdio: 'ignore',
  });
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/api/timetables'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const stops = (extra) => [
    { stationId: 's1', departure: '07:00' },
    { stationId: 's2', arrival: '07:20', departure: '07:21', specialInstructions: 'Mind the gap', guardEvents: extra },
    { stationId: 's3', arrival: '07:40' },
  ];
  const bad = await j('POST', '/api/timetables/tt/trains', { name: 'SL21', stops: stops([station({ probability: 3 })]) });
  assert.strictEqual(bad.status, 400);
  const good = await j('POST', '/api/timetables/tt/trains', { name: 'SL21', stops: stops([station(), enroute({ id: 'p2' })]) });
  assert.strictEqual(good.status, 201);
  const train = JSON.parse(good.text).trains[0];
  assert.strictEqual(train.stops[1].guard_events.length, 2);
  assert.strictEqual(train.stops[0].guard_events, undefined);
  const putBad = await j('PUT', `/api/timetables/tt/trains/${train.id}`, { name: 'SL21', stops: stops([station(), station()]) });
  assert.strictEqual(putBad.status, 400);

  // Hidden from the live endpoints
  for (const u of ['/api/timetables/tt/live/stations/Berry', '/api/timetables/tt/live/trains/SL21', '/api/timetables/tt/live/trains']) {
    const r = await j('GET', u);
    assert.strictEqual(r.status, 200, u);
    if (!u.endsWith('/live/trains')) assert.ok(r.text.includes('Mind the gap'), u + ' should still show special instructions');
    assert.ok(!/guard/i.test(r.text), u + ' leaks guard_events');
  }

  // special_instructions is untouched alongside guard_events
  const got = JSON.parse((await j('GET', '/api/timetables/tt')).text).trains[0].stops[1];
  assert.strictEqual(got.special_instructions, 'Mind the gap');
  assert.strictEqual(got.guard_events.length, 2);

  // Duplicate keeps guard_events
  const dup = JSON.parse((await j('POST', '/api/timetables/tt/duplicate')).text);
  assert.strictEqual(dup.trains[0].stops[1].guard_events.length, 2);
});
