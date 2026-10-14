const test = require('node:test');
const assert = require('node:assert');
const { stripTrainType } = require('../migrations');

test('stripTrainType removes train_type and counts changed trains', () => {
  const db = {
    timetables: [
      { id: 't1', trains: [{ id: 'a', train_type: 'L' }, { id: 'b', train_type: '' }, { id: 'c' }] },
      { id: 't2', trains: [{ id: 'd', train_type: 'X' }] },
    ],
  };
  assert.strictEqual(stripTrainType(db), 3);
  for (const tt of db.timetables) {
    for (const tr of tt.trains) assert.ok(!('train_type' in tr));
  }
});

test('stripTrainType leaves other fields intact', () => {
  const train = { id: 'a', name: '9X', train_id: 'ID1', train_type: 'L', stops: [{ id: 's' }] };
  const db = { timetables: [{ id: 't1', trains: [train] }] };
  stripTrainType(db);
  assert.deepStrictEqual(db.timetables[0].trains[0], { id: 'a', name: '9X', train_id: 'ID1', stops: [{ id: 's' }] });
});

test('stripTrainType is idempotent', () => {
  const db = { timetables: [{ id: 't1', trains: [{ id: 'a', train_type: 'L' }] }] };
  assert.strictEqual(stripTrainType(db), 1);
  assert.strictEqual(stripTrainType(db), 0);
});

test('stripTrainType handles timetables without a trains key', () => {
  const db = { timetables: [{ id: 't1' }, { id: 't2', trains: [] }] };
  assert.strictEqual(stripTrainType(db), 0);
});
