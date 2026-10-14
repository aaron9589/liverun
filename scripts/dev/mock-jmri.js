#!/usr/bin/env node
/**
 * Mock JMRI web server for developing the guard panel without a layout.
 *
 *   npm run mock:jmri                       # ws://localhost:12080/json/
 *   PORT=12090 ROSTER=./roster.json npm run mock:jmri
 *
 * Env:
 *   PORT       listen port (default 12080)
 *   ROSTER     path to a JSON roster: array of {name,address,road?,number?,functionKeys:[{name:'F6',label,lockable}]}
 *              (bare or wrapped as {type:'rosterEntry',data:{…}}); default: built-in roster below
 *   HEARTBEAT  ms advertised in hello (default 13500); a client silent for longer is disconnected, like JMRI
 *
 * Endpoints:
 *   GET  /json/roster                         roster (CORS *)
 *   WS   /json/  (or /json)                   JMRI JSON protocol subset: hello, ping/pong, throttle acquire/F-set/release
 *   POST /mock/set?address=3001&fn=6&on=true  simulate a driver's handheld changing a function
 *   GET  /mock/state                          function states per address + connected throttles
 *
 * Every received command and every broadcast is logged on one timestamped line.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 12080;
const HEARTBEAT = Number(process.env.HEARTBEAT) || 13500;
const MAX_FN = 28;

const fk = (labels) =>
  Object.entries(labels).map(([n, label]) => ({ name: `F${n}`, label, lockable: !/horn|whistle|bell/i.test(label) }));

const DEFAULT_ROSTER = [
  { name: 'CityRail 4V-1', address: '3001', road: 'CityRail', number: 'V1',
    functionKeys: fk({ 0: 'Headlight', 1: 'Bell', 2: 'Horn', 6: 'Door Open/Close' }) },
  { name: 'CityRail 4T-12', address: '3012', road: 'CityRail', number: 'T12',
    functionKeys: fk({ 0: 'Headlight', 1: 'Sound', 2: 'Horn', 9: 'Door Open/Close', 10: 'Door Buzzer' }) },
  { name: 'CityRail 8H-3', address: '3103', road: 'CityRail', number: 'H3',
    functionKeys: fk({ 0: 'Headlight', 2: 'Horn', 4: 'Door Open/Close', 8: 'Brake Squeal' }) },
  { name: 'Endeavour 2N-5', address: '2505', road: 'CityRail', number: '2N5',
    functionKeys: fk({ 0: 'Headlight', 1: 'Bell', 12: 'Door Open/Close' }) },
  { name: 'NSWGR 4401', address: '4401', road: 'NSWGR', number: '4401',
    functionKeys: fk({ 0: 'Headlight', 1: 'Bell', 2: 'Horn', 8: 'Dynamic Brake' }) },
];

function loadRoster() {
  if (!process.env.ROSTER) return DEFAULT_ROSTER;
  const raw = JSON.parse(fs.readFileSync(process.env.ROSTER, 'utf8'));
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.roster) ? raw.roster : Object.values(raw);
  return items.map((e) => (e && e.data ? e.data : e)).filter((e) => e && e.name)
    .map((e) => ({ ...e, address: String(e.address ?? ''), functionKeys: e.functionKeys || [] }));
}
const roster = loadRoster();

// ── Logging ─────────────────────────────────────────────────────────────────
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

// ── State ───────────────────────────────────────────────────────────────────
/** address → { speed, forward, F: boolean[] } — persists across connections like a real decoder. */
const locos = new Map();
const locoState = (address) => {
  if (!locos.has(address)) locos.set(address, { speed: 0, forward: true, F: Array(MAX_FN + 1).fill(false) });
  return locos.get(address);
};
let nextConn = 1;
/** All live connections: { id, ws, throttles: Map<name, {address, rosterEntry}> } */
const conns = new Set();

const send = (conn, msg) => {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
};
const clientsOn = (address) => {
  let n = 0;
  for (const c of conns) for (const t of c.throttles.values()) if (t.address === address) n++;
  return n;
};
const fullStatus = (name, t) => {
  const s = locoState(t.address);
  const data = { name, throttle: name, address: t.address, speed: s.speed, forward: s.forward };
  s.F.forEach((v, i) => { data[`F${i}`] = v; });
  data.speedSteps = 126;
  data.clients = clientsOn(t.address);
  if (t.rosterEntry) data.rosterEntry = t.rosterEntry;
  return { type: 'throttle', data };
};

/** Sends a change to every throttle (on every connection) holding `address` — JMRI shared control. */
function broadcast(address, change, source) {
  const targets = [];
  for (const c of conns) {
    for (const [name, t] of c.throttles) {
      if (t.address !== address) continue;
      send(c, { type: 'throttle', data: { name, throttle: name, ...change } });
      targets.push(`c${c.id}:${name}`);
    }
  }
  log(`BROADCAST addr=${address} ${fmt(change)} from=${source} -> ${targets.join(', ') || '(no throttles)'}`);
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');

/** Applies speed/forward/Fn fields to an address; broadcasts only what changed (as JMRI's property listeners do). */
function applyFields(address, data, source) {
  const s = locoState(address);
  const change = {};
  for (const [k, v] of Object.entries(data)) {
    const m = /^F(\d+)$/.exec(k);
    if (m) {
      const fn = Number(m[1]);
      if (fn > MAX_FN || typeof v !== 'boolean') continue;
      if (s.F[fn] !== v) { s.F[fn] = v; change[k] = v; }
    } else if (k === 'speed' && typeof v === 'number' && s.speed !== v) { s.speed = v; change.speed = v; }
    else if (k === 'forward' && typeof v === 'boolean' && s.forward !== v) { s.forward = v; change.forward = v; }
  }
  if (Object.keys(change).length) broadcast(address, change, source);
  return change;
}

const errorMsg = (code, message) => ({ type: 'error', data: { code, message } });

function handleThrottle(conn, data) {
  let name = typeof data.name === 'string' ? data.name : '';
  if (!name && typeof data.throttle === 'string') {
    name = data.throttle;
    log(`WARN c${conn.id} used legacy "throttle" key instead of "name"`);
  }
  if (!name) { send(conn, errorMsg(400, 'Throttle id (name) is required')); log(`ERROR -> c${conn.id} missing throttle name`); return; }

  let t = conn.throttles.get(name);
  if (!t) {
    // Acquire (JMRI: address wins over rosterEntry).
    let address = null;
    let rosterEntry = null;
    if (Number.isInteger(data.address)) {
      address = data.address;
      const hit = roster.find((r) => Number(r.address) === address);
      if (hit) rosterEntry = hit.name;
    } else if (typeof data.rosterEntry === 'string' && data.rosterEntry) {
      const hit = roster.find((r) => r.name === data.rosterEntry);
      if (!hit) {
        send(conn, errorMsg(404, `Unable to find roster entry "${data.rosterEntry}"`));
        log(`ERROR -> c${conn.id}:${name} roster entry not found: ${data.rosterEntry}`);
        return;
      }
      address = Number(hit.address);
      rosterEntry = hit.name;
    } else {
      send(conn, errorMsg(400, 'Throttle request needs an address or rosterEntry'));
      log(`ERROR -> c${conn.id}:${name} no address or rosterEntry`);
      return;
    }
    t = { address, rosterEntry };
    conn.throttles.set(name, t);
    const status = fullStatus(name, t);
    send(conn, status);
    const on = Object.entries(status.data).filter(([k, v]) => /^F\d+$/.test(k) && v).map(([k]) => k);
    log(`ACQUIRED c${conn.id}:${name} addr=${address} roster="${rosterEntry ?? ''}" clients=${status.data.clients} on=[${on.join(',')}]`);
  }

  if ('release' in data) {
    conn.throttles.delete(name);
    send(conn, { type: 'throttle', data: { name, throttle: name, release: null, clients: clientsOn(t.address) } });
    log(`RELEASED c${conn.id}:${name} addr=${t.address}`);
    return;
  }
  const change = applyFields(t.address, data, `c${conn.id}:${name}`);
  const fields = Object.keys(data).filter((k) => /^F\d+$|^speed$|^forward$/.test(k));
  if (fields.length && !Object.keys(change).length) log(`NO-CHANGE c${conn.id}:${name} addr=${t.address} ${fmt(Object.fromEntries(fields.map((k) => [k, data[k]])))}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && /^\/json\/roster\/?$/.test(url.pathname)) {
    log(`HTTP GET ${url.pathname} (${roster.length} entries)`);
    json(200, roster.map((data) => ({ type: 'rosterEntry', data })));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/mock/set') {
    const address = Number(url.searchParams.get('address'));
    const fn = Number(url.searchParams.get('fn'));
    const on = url.searchParams.get('on') === 'true';
    if (!Number.isInteger(address) || !Number.isInteger(fn) || fn < 0 || fn > MAX_FN) {
      json(400, { error: 'need address, fn (0-28), on=true|false' });
      return;
    }
    log(`HANDHELD addr=${address} F${fn}=${on}`);
    const change = applyFields(address, { [`F${fn}`]: on }, 'handheld');
    json(200, { address, fn, on, changed: Object.keys(change).length > 0 });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/mock/state') {
    const state = {};
    for (const [a, s] of locos) state[a] = { ...s, on: s.F.map((v, i) => (v ? `F${i}` : null)).filter(Boolean) };
    const throttles = [];
    for (const c of conns) for (const [name, t] of c.throttles) throttles.push({ conn: c.id, name, ...t });
    json(200, { locos: state, throttles });
    return;
  }
  json(404, { error: 'not found' });
});

// ── WebSocket ───────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path !== '/json/' && path !== '/json') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const conn = { id: nextConn++, ws, throttles: new Map() };
  conns.add(conn);
  log(`CONNECT c${conn.id} from ${req.socket.remoteAddress} (origin ${req.headers.origin || '-'})`);
  send(conn, { type: 'hello', data: { JMRI: '5.9.0-mock', json: '5.0', version: 'v5', heartbeat: HEARTBEAT, railroad: 'Mock Railroad', node: 'mock-jmri', activeProfile: 'Mock' } });

  // Like JMRI: drop clients that go quiet for longer than the heartbeat.
  let idle = null;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { log(`TIMEOUT c${conn.id} no message for ${HEARTBEAT} ms — closing`); ws.close(); }, HEARTBEAT);
  };
  armIdle();

  ws.on('message', (buf) => {
    armIdle();
    const text = buf.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { log(`RX c${conn.id} (invalid JSON) ${text}`); send(conn, errorMsg(400, 'Invalid JSON')); return; }
    log(`RX c${conn.id} ${text}`);
    if (!msg || typeof msg.type !== 'string') { send(conn, errorMsg(400, 'Missing type')); return; }
    if (msg.type === 'ping') { send(conn, { type: 'pong' }); return; }
    if (msg.type === 'throttle') { handleThrottle(conn, msg.data || {}); return; }
    send(conn, errorMsg(400, `mock-jmri does not implement type "${msg.type}"`));
  });

  ws.on('close', () => {
    clearTimeout(idle);
    conns.delete(conn);
    const names = [...conn.throttles.keys()];
    log(`DISCONNECT c${conn.id}${names.length ? ` (dropped throttles: ${names.join(', ')})` : ''}`);
  });
});

server.listen(PORT, () => {
  log(`mock JMRI listening: ws://localhost:${PORT}/json/  roster: http://localhost:${PORT}/json/roster  (${roster.length} locos, heartbeat ${HEARTBEAT} ms)`);
});
