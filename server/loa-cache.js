/**
 * LOA topic cache (docs/guard-panel-spec.md §11.5): GET /api/loa/values.
 *
 * One server-side MQTT client on the active timetable's broker
 * (settings.clock_broker_url, spec D2), subscribed to every topic referenced
 * in layout.loa. It keeps the last payload and receive time per topic, so a
 * guard panel that reloads after a signal cleared still sees it. The sync
 * socket (server/sync.js) sends a snapshot on connect and coalesced deltas
 * after that. Latching stays client-side; only raw values live here.
 *
 * Lifecycle: refresh() re-reads the layout and the active timetable. No active
 * timetable, no broker URL or no LOA topics → no connection and an empty cache.
 * A different broker → reconnect and drop every cached value (values from
 * another broker mean nothing). Same broker → subscribe/unsubscribe only the
 * difference; values survive the mqtt library's own reconnects, and topics no
 * longer referenced are dropped. Errors are logged, never thrown.
 *
 * Listeners get { values, full }: full = true means "this is the whole cache,
 * forget anything else" (sent whenever topics are dropped or the cache is
 * cleared), full = false carries only the topics that just received a message.
 */

const mqtt = require('mqtt');

/** Topics referenced by an LOA element (selector topic + every option topic). */
function elementTopics(el) {
  if (!el || typeof el !== 'object') return [];
  if (el.type === 'selector') {
    const opts = el.options && typeof el.options === 'object' ? Object.values(el.options) : [];
    return [el.topic, ...opts.map((o) => o && o.topic)];
  }
  return [el.topic];
}

/**
 * Every concrete topic in layout.loa. Blank topics and MQTT wildcards are
 * skipped: values are keyed by the exact topic an element names.
 */
function loaTopics(layout) {
  const topics = new Set();
  const sections = layout && layout.loa && Array.isArray(layout.loa.sections) ? layout.loa.sections : [];
  for (const section of sections) {
    for (const el of (section && Array.isArray(section.elements) ? section.elements : [])) {
      for (const t of elementTopics(el)) {
        if (typeof t === 'string' && t.trim() !== '' && !/[+#]/.test(t)) topics.add(t);
      }
    }
  }
  return topics;
}

/**
 * deps:
 *   getLayout()          layout config (db.js)
 *   getActive()          { id, brokerUrl } of the active timetable ('' / null when none)
 *   onTimetableChange    optional (db.js); a change to the active timetable triggers refresh()
 *   connect(url, opts)   mqtt.connect by default; injectable for tests
 */
function createLoaCache({ getLayout, getActive, onTimetableChange, connect = mqtt.connect, log = console, now = () => new Date() }) {
  const values = new Map(); // topic → { value, at }
  const listeners = new Set();
  let topics = new Set();
  let brokerUrl = '';
  let activeId = null;
  let client = null;
  let erroring = false; // log the first error of each outage only

  function emit(changed, full) {
    for (const listener of listeners) {
      try { listener({ values: changed, full }); } catch (err) { log.error('LOA cache listener failed:', err); }
    }
  }

  function snapshot() {
    return Object.fromEntries(values);
  }

  function disconnect() {
    if (!client) return;
    const c = client;
    client = null;
    c.removeAllListeners();
    c.on('error', () => {}); // errors during shutdown must not become uncaught
    try { c.end(true); } catch { /* already closed */ }
  }

  // Errors from a client already replaced or closed (pending acks failing on end) aren't worth logging.
  function subscribe(c, list) {
    if (!list.length) return;
    c.subscribe(list, { qos: 0 }, (err) => {
      if (err && client === c) log.warn(`LOA cache: subscribe failed: ${err.message}`);
    });
  }

  function open(url) {
    let c;
    try {
      c = connect(url, {
        reconnectPeriod: 5000,
        protocolVersion: 4,
        clean: true,
        // Subscriptions are sent on every 'connect' from the current topic set instead.
        resubscribe: false,
        clientId: `liverun_loa_${Math.random().toString(16).slice(2, 10)}`,
      });
    } catch (err) {
      log.warn(`LOA cache: cannot connect to ${url}: ${err.message}`);
      return;
    }
    client = c;
    erroring = false;
    c.on('connect', () => {
      if (client !== c) return;
      if (erroring) log.log(`LOA cache: connected to ${url}`);
      erroring = false;
      subscribe(c, [...topics]);
    });
    c.on('message', (topic, payload) => {
      if (client !== c || !topics.has(topic)) return;
      const entry = { value: payload.toString(), at: now().toISOString() };
      values.set(topic, entry);
      emit({ [topic]: entry }, false);
    });
    c.on('error', (err) => {
      if (client !== c || erroring) return;
      erroring = true;
      log.warn(`LOA cache: MQTT error on ${url}: ${err.message}`);
    });
  }

  /** Re-reads layout + active timetable and brings the connection and cache in line. */
  function refresh() {
    let nextTopics;
    let nextBroker;
    try {
      nextTopics = loaTopics(getLayout());
      const active = getActive() || {};
      activeId = active.id || null;
      nextBroker = activeId ? String(active.brokerUrl || '').trim() : '';
    } catch (err) {
      log.error('LOA cache: refresh failed:', err);
      return;
    }
    if (!nextBroker || nextTopics.size === 0) {
      disconnect();
      brokerUrl = '';
      topics = new Set();
      if (values.size) { values.clear(); emit({}, true); }
      return;
    }

    if (nextBroker !== brokerUrl || !client) {
      disconnect();
      const hadValues = values.size > 0;
      values.clear();
      brokerUrl = nextBroker;
      topics = nextTopics;
      if (hadValues) emit({}, true);
      open(brokerUrl);
      return;
    }

    const added = [...nextTopics].filter((t) => !topics.has(t));
    const removed = [...topics].filter((t) => !nextTopics.has(t));
    topics = nextTopics;
    // While disconnected the next 'connect' subscribes the whole (new) set.
    if (client.connected) {
      const c = client;
      subscribe(c, added);
      if (removed.length) c.unsubscribe(removed, (err) => { if (err && client === c) log.warn(`LOA cache: unsubscribe failed: ${err.message}`); });
    }
    let dropped = false;
    for (const t of removed) dropped = values.delete(t) || dropped;
    if (dropped) emit(snapshot(), true);
  }

  const unsubscribeChanges = onTimetableChange
    ? onTimetableChange((event) => { if (event.timetableId === activeId) refresh(); })
    : () => {};

  return {
    refresh,
    snapshot,
    /** Registers a listener for { values, full }. Returns a function that unregisters it. */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Current broker URL and topics (diagnostics / tests). */
    status: () => ({ brokerUrl, topics: [...topics], connected: Boolean(client && client.connected) }),
    close() {
      unsubscribeChanges();
      disconnect();
      listeners.clear();
    },
  };
}

/**
 * Creates the cache for the active timetable and registers GET /api/loa/values.
 * deps: getLayout, readDB, onTimetableChange (db.js); connect optional.
 * Returns the cache: call refresh() after the layout or the active timetable changes.
 */
function register(app, { getLayout, readDB, onTimetableChange, connect }) {
  const cache = createLoaCache({
    getLayout,
    getActive: () => {
      const db = readDB();
      const id = db.active_timetable_id || null;
      const tt = id ? (db.timetables || []).find((t) => t.id === id) : null;
      return { id: tt ? id : null, brokerUrl: (tt && tt.settings && tt.settings.clock_broker_url) || '' };
    },
    onTimetableChange,
    connect,
  });

  app.get('/api/loa/values', (_req, res) => {
    res.json(cache.snapshot());
  });

  cache.refresh();
  return cache;
}

module.exports = { register, createLoaCache, loaTopics };
