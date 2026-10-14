const { test } = require('node:test');
const assert = require('node:assert');
const { validateLayout } = require('../layout');

test('accepts an empty object and an empty JMRI URL', () => {
  assert.deepStrictEqual(validateLayout({}), { layout: {} });
  assert.deepStrictEqual(validateLayout({ jmri: { url: '' } }), { layout: { jmri: { url: '' } } });
});

test('accepts and trims ws:// and wss:// JMRI URLs', () => {
  assert.strictEqual(validateLayout({ jmri: { url: ' wss://jmri.example/json/ ' } }).layout.jmri.url, 'wss://jmri.example/json/');
  assert.ok(validateLayout({ jmri: { url: 'ws://10.0.0.5:12080/json/' } }).layout);
});

test('rejects non-object bodies and bad JMRI values', () => {
  assert.ok(validateLayout(null).error);
  assert.ok(validateLayout([]).error);
  assert.ok(validateLayout({ jmri: 'x' }).error);
  assert.ok(validateLayout({ jmri: { url: 5 } }).error);
  assert.ok(validateLayout({ jmri: { url: 'https://jmri.example/json/' } }).error);
  assert.ok(validateLayout({ jmri: { url: 'not a url' } }).error);
});

const profile = (over = {}) => ({
  id: 'p1', name: 'P', match: ['A*'],
  sounds: { door_open: '', door_close: 's.mp3', bell: 'bell.mp3' },
  functions: { door_open: { key: { fn: 6 }, mode: 'on' }, bell: { key: { label: 'Bell' }, mode: 'pulse', pulse_ms: 600 } },
  ...over,
});

test('accepts valid guard sound and train profiles', () => {
  assert.ok(validateLayout({ guard: { event_alert_sound: '' } }).layout);
  assert.ok(validateLayout({ guard: { event_alert_sound: 'bell_alert_4.mp3' } }).layout);
  assert.ok(validateLayout({ train_profiles: [profile(), profile({ id: 'p2', match: [], functions: {} })] }).layout);
  assert.ok(validateLayout({ train_profiles: [profile({ functions: { brake_squeal: { key: { fn: 0 }, mode: 'on_for', duration_s: 12 } } })] }).layout);
});

test('rejects bad guard sound', () => {
  assert.ok(validateLayout({ guard: [] }).error);
  assert.ok(validateLayout({ guard: { event_alert_sound: 5 } }).error);
  assert.ok(validateLayout({ guard: { event_alert_sound: '../x.mp3' } }).error);
  assert.ok(validateLayout({ guard: { event_alert_sound: 'x.txt' } }).error);
});

test('rejects bad train profiles', () => {
  const bad = (p) => assert.ok(validateLayout({ train_profiles: p }).error, JSON.stringify(p));
  bad('x');
  bad([null]);
  bad([profile({ id: '' })]);
  bad([profile(), profile()]);
  bad([profile({ name: ' ' })]);
  bad([profile({ match: 'A*' })]);
  bad([profile({ match: [1] })]);
  bad([profile({ sounds: { door_open: '', door_close: '', bell: '/etc/x.mp3' } })]);
  bad([profile({ sounds: { door_open: '', door_close: '' } })]);
  bad([profile({ functions: { 'Bad Name': { key: { fn: 1 }, mode: 'on' } } })]);
  bad([profile({ functions: { ['a'.repeat(41)]: { key: { fn: 1 }, mode: 'on' } } })]);
  bad([profile({ functions: { x: { key: { fn: 69 }, mode: 'on' } } })]);
  bad([profile({ functions: { x: { key: { fn: 1.5 }, mode: 'on' } } })]);
  bad([profile({ functions: { x: { key: { label: ' ' }, mode: 'on' } } })]);
  bad([profile({ functions: { x: { key: {}, mode: 'on' } } })]);
  bad([profile({ functions: { x: { key: { fn: 1 }, mode: 'blink' } } })]);
  bad([profile({ functions: { x: { key: { fn: 1 }, mode: 'pulse', pulse_ms: 10 } } })]);
  bad([profile({ functions: { x: { key: { fn: 1 }, mode: 'on_for', duration_s: 301 } } })]);
  bad([profile({ functions: { x: { key: { fn: 1 }, mode: 'on_for', duration_s: 0 } } })]);
});
