const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createLoaCache, loaTopics, register } = require('../loa-cache');

/** Fake mqtt client: records calls; tests drive 'connect' / 'message'. */
function fakeMqtt() {
  const clients = [];
  function connect(url, opts) {
    const c = new EventEmitter();
    Object.assign(c, {
      url, opts, connected: false, ended: false, subs: [], unsubs: [],
      subscribe(topics, _o, cb) { c.subs.push([...topics]); if (cb) cb(null); },
      unsubscribe(topics, cb) { c.unsubs.push([...topics]); if (cb) cb(null); },
      end() { c.ended = true; c.connected = false; },
      up() { c.connected = true; c.emit('connect'); },
      msg(topic, value) { c.emit('message', topic, Buffer.from(value)); },
    });
    clients.push(c);
    return c;
  }
  return { connect, clients, last: () => clients[clients.length - 1] };
}

const quiet = { log() {}, warn() {}, error() {} };

const cond = (topic) => ({ type: 'signal', label: topic, topic, clear: ['THROWN'] });
const layoutWith = (...elements) => ({ loa: { sections: [{ id: 's', name: 'S', from: 'A', to: 'B', only: [], except: [], elements }] } });

function setup({ layout, active = { id: 'tt', brokerUrl: 'ws://b1' } }) {
  const state = { layout, active };
  const mq = fakeMqtt();
  let n = 0;
  const changeListeners = new Set();
  const cache = createLoaCache({
    getLayout: () => state.layout,
    getActive: () => state.active,
    onTimetableChange: (l) => { changeListeners.add(l); return () => changeListeners.delete(l); },
    connect: mq.connect,
    log: quiet,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)),
  });
  const events = [];
  cache.onChange((e) => events.push(e));
  const fireChange = (timetableId) => { for (const l of changeListeners) l({ type: 'updated', timetableId, rev: 1, notify: true }); };
  return { state, mq, cache, events, fireChange };
}

test('loaTopics collects element, selector and option topics; skips blanks and wildcards', () => {
  const layout = layoutWith(
    cond('a'),
    { type: 'selector', label: 'sel', topic: 'sel', default: 'X', options: { X: cond('x'), Y: cond('a') } },
    cond(''), cond('w/+'), cond('w/#'),
  );
  assert.deepStrictEqual([...loaTopics(layout)].sort(), ['a', 'sel', 'x']);
  assert.deepStrictEqual([...loaTopics({})], []);
  assert.deepStrictEqual([...loaTopics({ loa: { sections: [null, { elements: [null] }] } })], []);
});

test('no active timetable, no broker or no topics → no connection', () => {
  for (const [layout, active] of [
    [layoutWith(cond('a')), { id: null, brokerUrl: 'ws://b1' }],
    [layoutWith(cond('a')), { id: 'tt', brokerUrl: '' }],
    [{ loa: { sections: [] } }, { id: 'tt', brokerUrl: 'ws://b1' }],
  ]) {
    const { cache, mq } = setup({ layout, active });
    cache.refresh();
    assert.strictEqual(mq.clients.length, 0);
    assert.deepStrictEqual(cache.snapshot(), {});
    cache.close();
  }
});

test('connects once, subscribes on connect, caches values and emits deltas', () => {
  const { cache, mq, events } = setup({ layout: layoutWith(cond('a'), cond('b')) });
  cache.refresh();
  cache.refresh(); // idempotent
  assert.strictEqual(mq.clients.length, 1);
  const c = mq.last();
  assert.strictEqual(c.url, 'ws://b1');
  assert.strictEqual(c.opts.resubscribe, false);
  c.up();
  assert.deepStrictEqual(c.subs, [['a', 'b']]);
  c.msg('a', 'THROWN');
  c.msg('zzz', 'ignored'); // not referenced
  assert.deepStrictEqual(cache.snapshot(), { a: { value: 'THROWN', at: '2026-01-01T00:00:00.000Z' } });
  assert.deepStrictEqual(events, [{ values: { a: { value: 'THROWN', at: '2026-01-01T00:00:00.000Z' } }, full: false }]);
  // A reconnect of the same client resubscribes everything and keeps values
  c.connected = false;
  c.up();
  assert.deepStrictEqual(c.subs, [['a', 'b'], ['a', 'b']]);
  assert.strictEqual(cache.snapshot().a.value, 'THROWN');
  cache.close();
  assert.ok(c.ended);
});

test('topic set changes subscribe/unsubscribe the difference and drop stale values', () => {
  const { cache, mq, events, state } = setup({ layout: layoutWith(cond('a'), cond('b')) });
  cache.refresh();
  const c = mq.last();
  c.up();
  c.msg('a', '1');
  c.msg('b', '2');
  events.length = 0;

  state.layout = layoutWith(cond('b'), cond('c'));
  cache.refresh();
  assert.strictEqual(mq.clients.length, 1, 'same broker: no reconnect');
  assert.deepStrictEqual(c.subs.slice(1), [['c']]);
  assert.deepStrictEqual(c.unsubs, [['a']]);
  assert.deepStrictEqual(Object.keys(cache.snapshot()), ['b']);
  assert.deepStrictEqual(events, [{ values: { b: cache.snapshot().b }, full: true }]);

  // Adding only: no full snapshot needed
  events.length = 0;
  state.layout = layoutWith(cond('b'), cond('c'), cond('d'));
  cache.refresh();
  assert.deepStrictEqual(events, []);
  cache.close();
});

test('while disconnected, topic changes wait for the next connect', () => {
  const { cache, mq, state } = setup({ layout: layoutWith(cond('a')) });
  cache.refresh();
  const c = mq.last();
  state.layout = layoutWith(cond('a'), cond('b'));
  cache.refresh();
  assert.deepStrictEqual(c.subs, []);
  c.up();
  assert.deepStrictEqual(c.subs, [['a', 'b']]);
  cache.close();
});

test('broker change reconnects and clears values; broker removed disconnects', () => {
  const { cache, mq, events, state } = setup({ layout: layoutWith(cond('a')) });
  cache.refresh();
  const c1 = mq.last();
  c1.up();
  c1.msg('a', 'x');
  events.length = 0;

  state.active = { id: 'tt', brokerUrl: 'ws://b2' };
  cache.refresh();
  assert.ok(c1.ended);
  assert.strictEqual(mq.clients.length, 2);
  assert.deepStrictEqual(cache.snapshot(), {});
  assert.deepStrictEqual(events, [{ values: {}, full: true }]);
  // Late messages from the old client are ignored
  c1.emit('message', 'a', Buffer.from('stale'));
  assert.deepStrictEqual(cache.snapshot(), {});

  const c2 = mq.last();
  c2.up();
  c2.msg('a', 'y');
  events.length = 0;
  state.active = { id: null, brokerUrl: '' };
  cache.refresh();
  assert.ok(c2.ended);
  assert.deepStrictEqual(cache.snapshot(), {});
  assert.deepStrictEqual(events, [{ values: {}, full: true }]);
  cache.close();
});

test('a change to the active timetable refreshes; other timetables do not', () => {
  const { cache, mq, state, fireChange } = setup({ layout: layoutWith(cond('a')) });
  cache.refresh();
  state.active = { id: 'tt', brokerUrl: 'ws://b2' };
  fireChange('other');
  assert.strictEqual(mq.clients.length, 1);
  fireChange('tt');
  assert.strictEqual(mq.clients.length, 2);
  assert.strictEqual(mq.last().url, 'ws://b2');
  cache.close();
});

test('connect errors are contained; refresh retries a failed connect', () => {
  let fail = true;
  const mq = fakeMqtt();
  const cache = createLoaCache({
    getLayout: () => layoutWith(cond('a')),
    getActive: () => ({ id: 'tt', brokerUrl: 'ws://b1' }),
    connect: (url, opts) => { if (fail) throw new Error('bad url'); return mq.connect(url, opts); },
    log: quiet,
  });
  cache.refresh();
  assert.strictEqual(mq.clients.length, 0);
  fail = false;
  cache.refresh();
  assert.strictEqual(mq.clients.length, 1);
  mq.last().emit('error', new Error('refused')); // logged, not thrown
  cache.close();
});

test('register: GET /api/loa/values serves the snapshot; active timetable comes from the DB', () => {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const mq = fakeMqtt();
  const db = {
    active_timetable_id: 'tt',
    timetables: [{ id: 'tt', settings: { clock_broker_url: 'ws://b9' } }],
  };
  const cache = register(app, {
    getLayout: () => layoutWith(cond('a')),
    readDB: () => db,
    onTimetableChange: () => () => {},
    connect: mq.connect,
  });
  assert.strictEqual(mq.last().url, 'ws://b9');
  mq.last().up();
  mq.last().msg('a', 'CATS');
  let body;
  routes['/api/loa/values']({}, { json: (b) => { body = b; } });
  assert.strictEqual(body.a.value, 'CATS');

  // Active id pointing at a deleted timetable counts as none
  db.timetables = [];
  cache.refresh();
  assert.ok(mq.last().ended);
  cache.close();
});
