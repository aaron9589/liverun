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
