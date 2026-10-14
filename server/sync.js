/**
 * Live sync WebSocket: /api/live/sync?id=<timetableId>.
 *
 * Pushes small notices to every client holding a timetable (CrewMobile, guard
 * panel, planner) so they can re-fetch instead of asking crews to refresh.
 * See docs/guard-panel-spec.md §6.5. Messages match SyncMessage in
 * client/src/types.ts:
 *
 *   hello              on connect: current rev + active timetable id
 *   completions        train run statuses (on connect and on status changes)
 *   timetable-updated  coalesced notice after any mutation (carries no data)
 *   timetable-deleted  the subscribed timetable is gone; socket then closes
 *   active-changed     Control switched the active timetable (all clients)
 */

const { WebSocketServer } = require('ws');

const WS_SYNC_PATH = '/api/live/sync';
const COALESCE_MS = 300;
// Ping idle sockets so reverse proxies don't time them out and dead tablets get dropped.
const HEARTBEAT_MS = 25_000;

/**
 * Per-key trailing coalescer: the first push for a key starts a timer; pushes
 * before it fires only replace the value. flush(key, latestValue) runs once
 * per window, so a burst of edits produces one notice within delayMs.
 */
function createCoalescer(delayMs, flush) {
  const pending = new Map(); // key → { value, timer }
  return {
    push(key, value) {
      const entry = pending.get(key);
      if (entry) { entry.value = value; return; }
      const fresh = { value, timer: null };
      fresh.timer = setTimeout(() => {
        pending.delete(key);
        flush(key, fresh.value);
      }, delayMs);
      pending.set(key, fresh);
    },
    cancel(key) {
      const entry = pending.get(key);
      if (entry) { clearTimeout(entry.timer); pending.delete(key); }
    },
    cancelAll() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}

/** trainId → status for every train that has one. */
function completionStatuses(tt) {
  const statuses = {};
  for (const train of (tt.trains || [])) {
    if (train.status) statuses[train.id] = train.status;
  }
  return statuses;
}

/**
 * Creates the sync socket server.
 * deps: getTimetable(id), getActiveId(), onTimetableChange(listener) (db.js).
 */
function createSync({ getTimetable, getActiveId, onTimetableChange, coalesceMs = COALESCE_MS }) {
  const wss = new WebSocketServer({ noServer: true });
  // timetableId → Set<WebSocket>
  const clients = new Map();

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Sends msg to the subscribers of one timetable, or to every client when timetableId is null. */
  function broadcast(timetableId, msg) {
    const payload = JSON.stringify(msg);
    const targets = timetableId === null ? [...clients.values()] : [clients.get(timetableId)];
    for (const set of targets) {
      if (!set) continue;
      for (const ws of set) send(ws, payload);
    }
  }

  const updates = createCoalescer(coalesceMs, (timetableId, rev) => {
    broadcast(timetableId, { type: 'timetable-updated', timetableId, rev });
  });

  const unsubscribe = onTimetableChange((event) => {
    if (event.type === 'updated' && event.notify) updates.push(event.timetableId, event.rev);
  });

  /**
   * Pushes run statuses. statusOnly: the mutation changed nothing but run
   * status, so the message carries the new rev and clients can adopt it
   * without re-fetching. Other callers rely on the 'timetable-updated' that follows.
   */
  function broadcastCompletions(timetableId, tt, { statusOnly = false } = {}) {
    const msg = { type: 'completions', timetableId, statuses: completionStatuses(tt) };
    if (statusOnly) msg.rev = tt.rev || 0;
    broadcast(timetableId, msg);
  }

  /**
   * The timetable was deleted: tell its subscribers, then close their sockets.
   * activeCleared: it was the active timetable, so every client (its own
   * subscribers included, before they close) also gets active-changed → null.
   */
  function timetableDeleted(timetableId, { activeCleared = false } = {}) {
    updates.cancel(timetableId);
    broadcast(timetableId, { type: 'timetable-deleted', timetableId });
    if (activeCleared) activeChanged(null);
    for (const ws of clients.get(timetableId) || []) ws.close(1000, 'Timetable deleted');
    clients.delete(timetableId);
  }

  function activeChanged(activeId) {
    broadcast(null, { type: 'active-changed', activeId });
  }

  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const timetableId = String(reqUrl.searchParams.get('id') || '').trim();
    if (!timetableId) { ws.close(1008, 'id query param required'); return; }

    const tt = getTimetable(timetableId);
    if (!tt) {
      // Same notice as a live delete, so a client that slept through it reacts the same way.
      send(ws, { type: 'timetable-deleted', timetableId });
      ws.close(1008, 'Timetable not found');
      return;
    }

    if (!clients.has(timetableId)) clients.set(timetableId, new Set());
    clients.get(timetableId).add(ws);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    send(ws, { type: 'hello', timetableId, rev: tt.rev || 0, activeId: getActiveId() });
    send(ws, { type: 'completions', timetableId, statuses: completionStatuses(tt) });

    ws.on('close', () => {
      const set = clients.get(timetableId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(timetableId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  /** Stops timers and closes every socket (tests / shutdown). */
  function close() {
    clearInterval(heartbeat);
    updates.cancelAll();
    unsubscribe();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }

  return { handleUpgrade, broadcast, broadcastCompletions, timetableDeleted, activeChanged, close };
}

module.exports = { WS_SYNC_PATH, createSync, createCoalescer, completionStatuses };
