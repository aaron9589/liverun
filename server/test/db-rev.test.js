const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// db.js resolves DB_PATH at load time, so point it at a temp file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-db-'));
process.env.DB_PATH = path.join(dir, 'db.json');
const { writeDB, getTimetable, mutateTimetable, onTimetableChange } = require('../db');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function seed() {
  writeDB({ timetables: [{ id: 'tt', name: 'A', trains: [] }] });
}

test('mutateTimetable bumps rev from missing to 1, then increments', () => {
  seed();
  assert.strictEqual(mutateTimetable('tt', (tt) => { tt.name = 'B'; }).rev, 1);
  assert.strictEqual(mutateTimetable('tt', (tt) => { tt.name = 'C'; }).rev, 2);
  assert.strictEqual(getTimetable('tt').rev, 2);
});

test('listeners receive updated events with rev and notify flag', () => {
  seed();
  const events = [];
  const off = onTimetableChange((e) => events.push(e));
  mutateTimetable('tt', () => {});
  mutateTimetable('tt', () => {}, { notify: false });
  off();
  mutateTimetable('tt', () => {});
  assert.deepStrictEqual(events, [
    { type: 'updated', timetableId: 'tt', rev: 1, notify: true },
    { type: 'updated', timetableId: 'tt', rev: 2, notify: false },
  ]);
  assert.strictEqual(getTimetable('tt').rev, 3);
});

test('unknown timetable: no write, no event', () => {
  seed();
  const events = [];
  const off = onTimetableChange((e) => events.push(e));
  assert.strictEqual(mutateTimetable('nope', () => {}), null);
  off();
  assert.deepStrictEqual(events, []);
});

test('a throwing listener does not break the mutation or other listeners', () => {
  seed();
  const seen = [];
  const errLog = console.error;
  console.error = () => {};
  const offA = onTimetableChange(() => { throw new Error('boom'); });
  const offB = onTimetableChange((e) => seen.push(e.rev));
  try {
    assert.strictEqual(mutateTimetable('tt', () => {}).rev, 1);
  } finally {
    offA(); offB();
    console.error = errLog;
  }
  assert.deepStrictEqual(seen, [1]);
});
