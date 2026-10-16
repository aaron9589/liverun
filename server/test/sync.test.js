const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

// db.js resolves DB_PATH at load time, so point it at a temp file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-sync-'));
process.env.DB_PATH = path.join(dir, 'db.json');
const db = require('../db');
const { createSync, createCoalescer } = require('../sync');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('coalescer sends one trailing flush per key with the latest value', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const flushed = [];
    const c = createCoalescer(300, (key, value) => flushed.push([key, value]));
    c.push('a', 1);
    mock.timers.tick(100);
    c.push('a', 2);
    c.push('b', 7);
    mock.timers.tick(150);
    c.push('a', 3);
    assert.deepStrictEqual(flushed, []);
    mock.timers.tick(50); // 300 ms after the first 'a' push
    assert.deepStrictEqual(flushed, [['a', 3]]);
    mock.timers.tick(100); // 300 ms after 'b'
    assert.deepStrictEqual(flushed, [['a', 3], ['b', 7]]);
    c.push('a', 4); // a new window starts after a flush
    mock.timers.tick(300);
    assert.deepStrictEqual(flushed, [['a', 3], ['b', 7], ['a', 4]]);
  } finally {
    mock.timers.reset();
  }
});

test('coalescer cancel drops a pending flush', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const flushed = [];
    const c = createCoalescer(300, (key, value) => flushed.push([key, value]));
    c.push('a', 1);
    c.cancel('a');
    mock.timers.tick(1000);
    assert.deepStrictEqual(flushed, []);
  } finally {
    mock.timers.reset();
  }
});

/** Connects a sync client and collects its parsed messages. */
function connect(port, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/sync?id=${id}`);
  const messages = [];
  const waiters = new Set();
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const w of [...waiters]) w();
  });
  /** Resolves with the first message matching pred (already received or yet to come). */
  function next(pred) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error('timed out; got ' + JSON.stringify(messages)));
      }, 2000);
      function check() {
        const m = messages.find(pred);
        if (!m) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(m);
      }
      waiters.add(check);
      check();
    });
  }
  return { ws, messages, next };
}

test('sync socket: hello, coalesced updates, status-only completions, delete, active-changed', async () => {
  db.writeDB({
    active_timetable_id: 'tt',
    timetables: [
      { id: 'tt', name: 'A', rev: 4, trains: [{ id: 't1', status: 'running', stops: [] }] },
      { id: 'other', name: 'B', trains: [] },
    ],
  });
  const sync = createSync({
    getTimetable: db.getTimetable,
    getActiveId: () => db.readDB().active_timetable_id || null,
    onTimetableChange: db.onTimetableChange,
    coalesceMs: 40,
  });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => sync.handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const a = connect(port, 'tt');
    const b = connect(port, 'other');
    await a.next((m) => m.type === 'completions');
    await b.next((m) => m.type === 'completions');
    assert.deepStrictEqual(a.messages[0], { type: 'hello', timetableId: 'tt', rev: 4, activeId: 'tt' });
    assert.deepStrictEqual(a.messages[1], { type: 'completions', timetableId: 'tt', statuses: { t1: 'running' } });

    // A burst of edits → one notice carrying the latest rev, only to that timetable's clients
    db.mutateTimetable('tt', (tt) => { tt.name = 'A1'; });
    db.mutateTimetable('tt', (tt) => { tt.name = 'A2'; });
    const upd = await a.next((m) => m.type === 'timetable-updated');
    assert.deepStrictEqual(upd, { type: 'timetable-updated', timetableId: 'tt', rev: 6 });

    // Status-only change: no update notice; the rev rides on completions
    const updated = db.mutateTimetable('tt', (tt) => { tt.trains[0].status = 'completed'; }, { notify: false });
    sync.broadcastCompletions('tt', updated, { statusOnly: true });
    const comp = await a.next((m) => m.type === 'completions' && m.rev === 7);
    assert.deepStrictEqual(comp.statuses, { t1: 'completed' });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(a.messages.filter((m) => m.type === 'timetable-updated').length, 1);
    assert.ok(!b.messages.some((m) => m.type === 'timetable-updated' || m.rev === 7));

    // Active change reaches every client
    sync.activeChanged('other');
    await a.next((m) => m.type === 'active-changed' && m.activeId === 'other');
    await b.next((m) => m.type === 'active-changed' && m.activeId === 'other');

    // Delete the active timetable: notice, then active-changed → null, then the socket closes
    const closed = new Promise((r) => a.ws.on('close', r));
    sync.timetableDeleted('tt', { activeCleared: true });
    await closed;
    assert.deepStrictEqual(a.messages.slice(-2), [
      { type: 'timetable-deleted', timetableId: 'tt' },
      { type: 'active-changed', activeId: null },
    ]);
    await b.next((m) => m.type === 'active-changed' && m.activeId === null);
    assert.ok(!b.messages.some((m) => m.type === 'timetable-deleted'));

    // Connecting to a missing timetable reports it deleted
    const c = connect(port, 'gone');
    await c.next((m) => m.type === 'timetable-deleted' && m.timetableId === 'gone');
    b.ws.close();
  } finally {
    sync.close();
    await new Promise((r) => server.close(r));
  }
});

test('sync socket: LOA snapshot after hello, coalesced deltas to every client, full resets', async () => {
  db.writeDB({ timetables: [{ id: 'tt', name: 'A', trains: [] }, { id: 'other', name: 'B', trains: [] }] });
  let cache = { sig: { value: 'THROWN', at: 't0' } };
  const listeners = new Set();
  const emit = (e) => { for (const l of listeners) l(e); };
  const sync = createSync({
    getTimetable: db.getTimetable,
    getActiveId: () => null,
    onTimetableChange: db.onTimetableChange,
    getLoaSnapshot: () => ({ ...cache }),
    onLoaChange: (l) => { listeners.add(l); return () => listeners.delete(l); },
    loaCoalesceMs: 40,
  });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => sync.handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const a = connect(port, 'tt');
    const b = connect(port, 'other');
    await a.next((m) => m.type === 'loa-values');
    await b.next((m) => m.type === 'loa-values');
    assert.deepStrictEqual(a.messages.map((m) => m.type), ['hello', 'completions', 'path-requests', 'loa-values']);
    assert.deepStrictEqual(a.messages[3], { type: 'loa-values', values: { sig: { value: 'THROWN', at: 't0' } }, full: true });

    // A burst of changes → one delta with the latest value per topic, to every timetable's clients
    emit({ values: { sig: { value: 'CLOSED', at: 't1' } }, full: false });
    emit({ values: { staff: { value: 'CATS', at: 't2' } }, full: false });
    emit({ values: { sig: { value: 'THROWN', at: 't3' } }, full: false });
    const delta = await a.next((m) => m.type === 'loa-values' && !m.full);
    assert.deepStrictEqual(delta.values, { sig: { value: 'THROWN', at: 't3' }, staff: { value: 'CATS', at: 't2' } });
    await b.next((m) => m.type === 'loa-values' && !m.full);
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(a.messages.filter((m) => m.type === 'loa-values' && !m.full).length, 1);

    // A full reset replaces any pending delta and is sent at once
    emit({ values: { x: { value: '1', at: 't4' } }, full: false });
    cache = {};
    emit({ values: {}, full: true });
    await a.next((m) => m.type === 'loa-values' && m.full && Object.keys(m.values).length === 0);
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!a.messages.some((m) => m.type === 'loa-values' && m.values.x), 'pending delta dropped');
    a.ws.close();
    b.ws.close();
  } finally {
    sync.close();
    await new Promise((r) => server.close(r));
  }
  assert.strictEqual(listeners.size, 0, 'close unsubscribes');
});

test('sync socket: path-request list after hello (no rev), requests-only changes carry rev', async () => {
  const pr = { id: 'r1', timetable_id: 'tt', crew_id: 'c1', status: 'pending', stops: [] };
  db.writeDB({ timetables: [
    { id: 'tt', name: 'A', rev: 2, trains: [], path_requests: [pr] },
    { id: 'other', name: 'B', trains: [] },
  ] });
  const sync = createSync({ getTimetable: db.getTimetable, getActiveId: () => 'tt', onTimetableChange: db.onTimetableChange, coalesceMs: 40 });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => sync.handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const a = connect(port, 'tt');
    const b = connect(port, 'other');
    const first = await a.next((m) => m.type === 'path-requests');
    assert.deepStrictEqual(first, { type: 'path-requests', timetableId: 'tt', requests: [pr] });
    assert.deepStrictEqual(a.messages.slice(0, 3).map((m) => m.type), ['hello', 'completions', 'path-requests']);
    const none = await b.next((m) => m.type === 'path-requests');
    assert.deepStrictEqual(none.requests, [], 'a timetable without requests sends an empty list');

    // Request-only mutation: no update notice; the rev rides on the request list
    const updated = db.mutateTimetable('tt', (tt) => { tt.path_requests[0].status = 'in_review'; }, { notify: false });
    sync.broadcastPathRequests('tt', updated, { requestsOnly: true });
    const msg = await a.next((m) => m.type === 'path-requests' && m.rev === 3);
    assert.strictEqual(msg.requests[0].status, 'in_review');

    // Without requestsOnly (accept / cancel-approve) there is no rev
    sync.broadcastPathRequests('tt', updated);
    await new Promise((r) => setTimeout(r, 80));
    const lists = a.messages.filter((m) => m.type === 'path-requests');
    assert.strictEqual(lists.length, 3);
    assert.ok(!('rev' in lists[2]));
    assert.ok(!a.messages.some((m) => m.type === 'timetable-updated'));
    assert.strictEqual(b.messages.filter((m) => m.type === 'path-requests').length, 1, 'other timetables are not told');
    a.ws.close();
    b.ws.close();
  } finally {
    sync.close();
    await new Promise((r) => server.close(r));
  }
});
