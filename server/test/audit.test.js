const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register, entry, shortUa, summariseTrain, matches, toCsv } = require('../audit');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-')); }
function fakeApp() {
  const routes = {};
  return { routes, get: (p, h) => { routes[p] = h; } };
}
function call(app, query) {
  const out = { headers: {} };
  const res = {
    set: (k, v) => { out.headers[k] = v; },
    send: (b) => { out.body = b; },
    json: (b) => { out.body = b; },
    status: (c) => { out.status = c; return res; },
  };
  app.routes['/api/audit']({ query }, res);
  return out;
}
const req = (extra = {}) => ({ ip: '10.0.0.5', headers: { 'user-agent': 'x', ...extra } });
const base = { actor: 'crew', action: 'submit', outcome: 'ok', timetable_id: 't1' };

test('shortUa', () => {
  assert.strictEqual(shortUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'Safari iOS 18');
  assert.strictEqual(shortUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'), 'Chrome Android 14');
  assert.strictEqual(shortUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Firefox macOS');
  assert.strictEqual(shortUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'), 'Edge Windows');
  assert.strictEqual(shortUa('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117 Mobile Safari/537.36'), 'Samsung Internet Android 13');
  assert.strictEqual(shortUa('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126 Safari/537.36'), 'Chrome ChromeOS');
  assert.strictEqual(shortUa('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0'), 'Firefox Linux');
  assert.strictEqual(shortUa(''), 'unknown');
  assert.strictEqual(shortUa(undefined), 'unknown');
  assert.strictEqual(shortUa('curl/8'), 'unknown');
});

test('entry fills and sanitises headers', () => {
  const now = new Date('2026-01-02T03:04:05.000Z');
  const e = entry({ ip: '1.2.3.4', headers: { 'x-liverun-device': 'ab c/<d>-1_' + 'z'.repeat(100), 'x-liverun-clock': '07:45' } }, { ...base, crew_id: 'c1' }, now);
  assert.strictEqual(e.at, '2026-01-02T03:04:05.000Z');
  assert.strictEqual(e.ip, '1.2.3.4');
  assert.match(e.device, /^abcd-1_z+$/);
  assert.strictEqual(e.device.length, 64);
  assert.strictEqual(e.clock, '07:45');
  assert.strictEqual(e.crew_id, 'c1');
  assert.strictEqual(e.error, undefined);
  assert.strictEqual(entry({ ip: '', headers: { 'x-liverun-clock': '7:45pm' } }, base).clock, null);
  assert.strictEqual(entry({ ip: '', headers: {} }, base).device, '');
  assert.strictEqual(entry({ ip: '', headers: {} }, { ...base, error: 'nope' }).error, 'nope');
});

test('summariseTrain keeps stored order and resolves names', () => {
  const s = summariseTrain(
    { name: '9A', crew_id: 'c1', train_id: 'XPT', stops: [{ station_id: 's2', arrival: null, departure: '08:00' }, { station_id: 's1', arrival: '08:30', departure: null }] },
    [{ id: 's1', name: 'Kiama' }, { id: 's2', name: 'Bombo' }],
    [{ id: 'c1', name: 'Alex' }],
  );
  assert.deepStrictEqual(s, { name: '9A', crew: 'Alex', loco: 'XPT', stops: [{ station: 'Bombo', arr: null, dep: '08:00' }, { station: 'Kiama', arr: '08:30', dep: null }] });
  const n = summariseTrain({ name: 'x', stops: [] }, [], []);
  assert.strictEqual(n.crew, null);
  assert.strictEqual(n.loco, null);
});

test('matches filters', () => {
  const e = { at: '2026-01-01T00:00:10.000Z', ip: 'a', device: 'd', crew_id: 'c', request_id: 'r', timetable_id: 't', action: 'submit' };
  assert.ok(matches(e, {}));
  assert.ok(matches(e, { timetableId: 't', requestId: 'r', crewId: 'c', ip: 'a', device: 'd', action: 'submit' }));
  assert.ok(!matches(e, { crewId: 'x' }));
  assert.ok(!matches(e, { action: 'withdraw' }));
  assert.ok(matches(e, { before: '2026-01-01T00:00:11.000Z' }));
  assert.ok(!matches(e, { before: e.at })); // strictly earlier
});

test('toCsv escapes and neutralises formulas', () => {
  const csv = toCsv([{ at: 'A', crew_name: '=HYPERLINK("x")', error: 'a,b\n"c"', detail: { text: '+1' }, device: '-x', ip: '@y' }]);
  const [head, row] = csv.split('\r\n');
  assert.ok(head.startsWith('at,clock,ip,device'));
  assert.ok(row.includes("'@y"));
  assert.ok(row.includes("'-x"));
  assert.ok(row.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(row.includes('"a,b\n""c"""'));
  assert.ok(row.includes('"{""text"":""+1""}"')); // JSON starts with {, no prefix
});

test('record appends, GET filters, orders and limits', () => {
  const dir = tmpDir();
  const app = fakeApp();
  const audit = register(app, { dataDir: () => dir });
  for (let i = 0; i < 5; i++) audit.record(req(), { ...base, timetable_id: i % 2 ? 't2' : 't1', request_id: 'r' + i });
  fs.appendFileSync(path.join(dir, 'audit.jsonl'), 'not json\n');
  const all = call(app, {}).body;
  assert.deepStrictEqual(all.map((e) => e.request_id), ['r4', 'r3', 'r2', 'r1', 'r0']);
  assert.strictEqual(call(app, { timetableId: 't2' }).body.length, 2);
  assert.strictEqual(call(app, { limit: '2' }).body.length, 2);
  assert.strictEqual(call(app, { limit: 'abc' }).body.length, 5);
  assert.strictEqual(call(app, { limit: '0' }).body.length, 5);
  assert.strictEqual(call(app, { requestId: 'r3' }).body[0].ip, '10.0.0.5');
  const csv = call(app, { format: 'csv' });
  assert.strictEqual(csv.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.strictEqual(csv.headers['Content-Disposition'], 'attachment; filename="liverun-audit.csv"');
  fs.rmSync(dir, { recursive: true });
});

test('rotates at the size limit and GET reads both files', () => {
  const dir = tmpDir();
  const app = fakeApp();
  const audit = register(app, { dataDir: () => dir, maxBytes: 600 });
  for (let i = 0; i < 12; i++) audit.record(req(), { ...base, request_id: 'r' + i });
  assert.ok(fs.existsSync(path.join(dir, 'audit.1.jsonl')));
  assert.ok(fs.statSync(path.join(dir, 'audit.jsonl')).size < 1200);
  const ids = call(app, {}).body.map((e) => e.request_id);
  assert.strictEqual(ids[0], 'r11');
  assert.ok(ids.length >= 6 && ids.length <= 12);
  assert.deepStrictEqual(ids, [...ids].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))));
  fs.rmSync(dir, { recursive: true });
});

test('record never throws on an unwritable dir', () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const audit = register(fakeApp(), { dataDir: () => '/nonexistent-liverun-dir/x' });
    assert.strictEqual(audit.record(req(), base).action, 'submit');
    const audit2 = register(fakeApp(), { dataDir: () => { throw new Error('boom'); } });
    assert.ok(audit2.record(req(), base));
  } finally { console.error = orig; }
});
