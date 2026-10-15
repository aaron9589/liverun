const { test } = require('node:test');
const assert = require('node:assert');
const { parseRequestSettings } = require('../request-settings');

test('only sent keys are returned', () => {
  assert.deepStrictEqual(parseRequestSettings({}).values, {});
  assert.deepStrictEqual(parseRequestSettings({ requests_enabled: false }).values, { requests_enabled: false });
});

test('accepts valid values and trims the prefix', () => {
  const r = parseRequestSettings({ request_train_prefix: ' PR-1 ', request_default_leg_min: 120, request_lead_min: 0 });
  assert.deepStrictEqual(r.values, { request_train_prefix: 'PR-1', request_default_leg_min: 120, request_lead_min: 0 });
});

test('rejects a bad prefix', () => {
  for (const v of ['', '   ', 'TOOLONGPFX', 'a b', 'x_y', 5, null]) {
    assert.ok(parseRequestSettings({ request_train_prefix: v }).error, String(v));
  }
});

test('rejects out-of-range or non-integer minutes', () => {
  for (const v of [0, 121, 1.5, '5', null, NaN]) assert.ok(parseRequestSettings({ request_default_leg_min: v }).error, String(v));
  for (const v of [-1, 61, 2.5, '2']) assert.ok(parseRequestSettings({ request_lead_min: v }).error, String(v));
});
