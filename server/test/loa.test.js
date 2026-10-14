const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the DB at a temp file before db.js loads (each test file runs in its own process).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-loa-'));
process.env.DB_PATH = path.join(dir, 'db.json');

const { validateLoaConfig } = require('../loa');
const { validateLayout } = require('../layout');
const { getLayout, setLayout } = require('../db');

const sig = (over = {}) => ({ type: 'signal', label: 'Sig 1', topic: 'a/b/1', clear: ['THROWN'], ...over });
const sel = (over = {}) => ({
  type: 'selector', label: 'Turnout', topic: 't/1',
  options: { CLOSED: sig({ topic: 'a/c' }), THROWN: sig({ topic: 'a/t' }) }, default: 'CLOSED', ...over,
});
const sec = (over = {}) => ({ id: 's1', name: 'A to B', from: 'A', to: 'B', only: [], except: [], elements: [sig()], ...over });
const loa = (sections, over = {}) => ({ sections, warn_on_depart: true, ...over });

test('valid configs pass', () => {
  assert.strictEqual(validateLoaConfig({ sections: [], warn_on_depart: true }), null);
  assert.strictEqual(validateLoaConfig(loa([sec(), sec({ id: 's2', elements: [sel(), sig({ type: 'token', grants: false, revokes: false, caution: ['X'] })] })])), null);
});

test('rejects bad top-level shapes', () => {
  for (const v of [null, [], 'x', 5]) assert.ok(validateLoaConfig(v));
  assert.ok(validateLoaConfig({ sections: {} }));
  assert.ok(validateLoaConfig({ sections: [], warn_on_depart: 'yes' }));
  assert.ok(validateLoaConfig(loa(Array.from({ length: 201 }, (_, i) => sec({ id: `s${i}` })))));
});

test('rejects bad sections', () => {
  const bad = (over) => assert.ok(validateLoaConfig(loa([sec(over)])), JSON.stringify(over));
  bad({ id: '' }); bad({ id: 5 }); bad({ name: ' ' }); bad({ from: '' }); bad({ to: 5 });
  bad({ from: 'Kiama', to: 'KIAMA' }); bad({ only: 'x' }); bad({ except: [1] }); bad({ only: undefined });
  bad({ elements: 'x' }); bad({ elements: Array.from({ length: 51 }, () => sig()) });
  assert.ok(validateLoaConfig(loa([sec(), sec()])), 'duplicate ids');
});

test('rejects bad elements', () => {
  const bad = (el) => assert.ok(validateLoaConfig(loa([sec({ elements: [el] })])), JSON.stringify(el));
  bad(null); bad(sig({ type: 'lamp' })); bad(sig({ label: '' })); bad(sig({ topic: '' })); bad(sig({ topic: 'a/+/b' }));
  bad(sig({ topic: 'a/#' })); bad(sig({ clear: [] })); bad(sig({ clear: ['  '] })); bad(sig({ clear: 'THROWN' }));
  bad(sig({ clear: [1] })); bad(sig({ caution: 'x' })); bad(sig({ revokes: 'yes' })); bad(sig({ grants: 'no' })); bad(sig({ label: 'x'.repeat(201) }));
});

test('rejects bad selectors', () => {
  const bad = (el) => assert.ok(validateLoaConfig(loa([sec({ elements: [el] })])), JSON.stringify(el));
  bad(sel({ options: {} })); bad(sel({ options: [] })); bad(sel({ default: 'OPEN' })); bad(sel({ default: undefined }));
  bad(sel({ topic: 'a/#' })); bad(sel({ options: { CLOSED: sel() }, default: 'CLOSED' }));
  bad(sel({ options: { CLOSED: sig({ clear: [] }) } }));
  bad(sel({ options: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`K${i}`, sig()])), default: 'K0' }));
});

test('validateLayout runs LOA validation', () => {
  assert.ok(validateLayout({ loa: loa([sec()]) }).layout);
  assert.ok(validateLayout({ loa: loa([sec({ from: 'A', to: 'a' })]) }).error);
});

test('GET/PUT layout storage round-trips loa', () => {
  const body = loa([sec({ elements: [sel(), sig({ caution: ['WARN'], revokes: true })] })], { warn_on_depart: false });
  setLayout(validateLayout({ loa: body }).layout);
  assert.deepStrictEqual(getLayout().loa, body);
});

test('docs/layout.example.json passes validation and round-trips', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'layout.example.json'), 'utf8'));
  assert.strictEqual(validateLoaConfig(example.loa), null);
  assert.strictEqual(validateLayout(example).error, undefined);
  assert.deepStrictEqual(example.loa.sections.map((s) => [s.from, s.to]),
    [['Kiama', 'Berry'], ['Berry', 'Nowra'], ['Nowra', 'Berry'], ['Berry', 'Kiama']]);
  assert.strictEqual(example.loa.sections[0].elements[0].type, 'selector');
  assert.strictEqual(example.loa.sections[0].elements[1].type, 'token');
  setLayout(example);
  assert.deepStrictEqual(getLayout().loa, example.loa);
});
