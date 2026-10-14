const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-test-')), 'db.json');
const { getLayout, setLayout, LAYOUT_DEFAULTS } = require('../db');

test('getLayout returns defaults when nothing is stored', () => {
  assert.deepStrictEqual(getLayout(), LAYOUT_DEFAULTS);
});

test('setLayout merges over defaults and drops unknown keys', () => {
  const saved = setLayout({ jmri: { url: 'wss://jmri.example/json/', bogus: 1 }, nope: true });
  assert.deepStrictEqual(saved.jmri, { url: 'wss://jmri.example/json/' });
  assert.strictEqual(saved.nope, undefined);
  assert.deepStrictEqual(saved.train_profiles, []);
  assert.deepStrictEqual(getLayout(), saved);
});
