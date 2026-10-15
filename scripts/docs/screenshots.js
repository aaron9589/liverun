#!/usr/bin/env node
/**
 * User-guide screenshots, regenerated from demo data (docs/user-guide-spec.md §7).
 *
 *   npm run docs:screenshots                  # every shot → docs/user-guide/images/
 *   npm run docs:screenshots -- guard-*       # only shots whose name matches a glob
 *   npm run docs:screenshots -- --serve       # seed the stack and keep it running (explore / write docs)
 *   npm run docs:screenshots -- --list        # list shot names
 *
 * Starts a throwaway stack — never touches a real instance or server/data/:
 *   - an in-process MQTT broker (aedes): TCP for the server, WebSocket for browsers
 *   - the mock JMRI server (scripts/dev/mock-jmri.js) with docs/user-guide/demo/roster.json
 *   - the LiveRun server on a temp DB, and Vite dev pointed at it (current source, no build needed)
 * then imports docs/user-guide/demo/b-session.json, applies docs/layout.example.json +
 * demo/layout-overrides.json, sets the fast clock and LOA topic values, and drives Chromium.
 *
 * Env: DOCS_PORT_BASE (default 38300; uses base … base+4), HEADED=1 to watch.
 * Needs Playwright's Chromium: npx playwright install chromium
 */
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer, createWebSocketStream } = require('ws');
const mqtt = require('mqtt');

const ROOT = path.resolve(__dirname, '../..');
const DEMO = path.join(ROOT, 'docs/user-guide/demo');
const OUT = path.join(ROOT, 'docs/user-guide/images');

const BASE_PORT = Number(process.env.DOCS_PORT_BASE) || 38300;
const PORTS = { server: BASE_PORT, vite: BASE_PORT + 1, mqtt: BASE_PORT + 2, mqttWs: BASE_PORT + 3, jmri: BASE_PORT + 4 };
const APP = `http://localhost:${PORTS.vite}/`;
const API = `http://localhost:${PORTS.server}/api`;
const BROKER_WS = `ws://localhost:${PORTS.mqttWs}`;
const JMRI_WS = `ws://localhost:${PORTS.jmri}/json/`;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[docs]', ...a);

// ── Stack ────────────────────────────────────────────────────────────────────

const children = [];
let tmpDir;

function startChild(name, cmd, args, opts) {
  const out = fs.openSync(path.join(tmpDir, `${name}.log`), 'a');
  const child = spawn(cmd, args, { stdio: ['ignore', out, out], ...opts });
  child.on('exit', (code) => { if (code && !shuttingDown) log(`${name} exited (${code}); see ${tmpDir}/${name}.log`); });
  children.push(child);
  return child;
}

async function waitFor(url, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`${label} did not start (${url}); logs in ${tmpDir}`);
}

async function startBroker() {
  const { Aedes } = require('aedes');
  const broker = await Aedes.createBroker();
  const tcp = net.createServer(broker.handle);
  await new Promise((r) => tcp.listen(PORTS.mqtt, r));
  const wss = new WebSocketServer({ port: PORTS.mqttWs });
  wss.on('connection', (sock, req) => broker.handle(createWebSocketStream(sock), req));
  return { close: () => { wss.close(); tcp.close(); broker.close(); } };
}

async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Demo data ────────────────────────────────────────────────────────────────

/** Fast clock and LOA topic values, published to the broker. Shots change them via `ctx`. */
function createPublisher() {
  const client = mqtt.connect(`mqtt://localhost:${PORTS.mqtt}`);
  let clock = '12:00';
  let topic = '';
  const tick = () => { if (topic) client.publish(topic, clock, { retain: true }); };
  const timer = setInterval(tick, 2000);
  return {
    ready: new Promise((r) => client.once('connect', r)),
    setClockTopic(t) { topic = t; tick(); },
    setClock(hhmm) { clock = hhmm; tick(); },
    set(t, value) { return new Promise((r) => client.publish(t, value, { retain: true }, r)); },
    close() { clearInterval(timer); client.end(true); },
  };
}

/** Every LOA topic set to a not-clear value: signals at stop, staffs in their instruments. */
function loaStopValues(layout) {
  const values = {};
  const visit = (el) => {
    if (el.type === 'selector') {
      values[el.topic] = el.default;
      Object.values(el.options).forEach(visit);
    } else {
      values[el.topic] = el.type === 'token' ? 'IN' : /signalmast/.test(el.topic) ? 'Stop; Lit; Held' : 'CLOSED';
    }
  };
  layout.loa.sections.forEach((s) => s.elements.forEach(visit));
  return values;
}

async function seed(pub) {
  const overrides = readJson(path.join(DEMO, 'layout-overrides.json'));
  const { placements, ...layoutOverrides } = overrides;

  // Guard-event placements live in the overrides so b-session.json stays a plain export.
  const tt = readJson(path.join(DEMO, 'b-session.json'));
  const stationName = Object.fromEntries(tt.stations.map((s) => [s.id, s.name]));
  for (const [trainName, byStation] of Object.entries(placements || {})) {
    const train = tt.trains.find((t) => t.name === trainName);
    if (!train) throw new Error(`placements: no train ${trainName}`);
    for (const stop of train.stops) {
      const list = byStation[stationName[stop.station_id]];
      if (list) stop.guard_events = list;
    }
  }

  const imported = await api('POST', '/timetables/import', tt);
  await api('PUT', '/active-timetable', { id: imported.id });
  await api('PUT', `/timetables/${imported.id}/settings`, {
    ...imported.settings, clock_enabled: true, clock_broker_url: BROKER_WS,
  });

  const example = readJson(path.join(ROOT, 'docs/layout.example.json'));
  const layout = await api('PUT', '/layout', { ...example, ...layoutOverrides, jmri: { url: JMRI_WS } });

  pub.setClockTopic(imported.settings.clock_topic);
  const loa = loaStopValues(layout);
  await Promise.all(Object.entries(loa).map(([t, v]) => pub.set(t, v)));
  return { timetable: await api('GET', `/timetables/${imported.id}`), layout, loa };
}

// ── Shots ────────────────────────────────────────────────────────────────────
// Each shot gets a fresh browser context (clean localStorage). `ctx` has
// { app, api, pub, timetable, layout, loa, out(name) }.

const DESKTOP = { width: 1440, height: 900 };

const SHOTS = [
  {
    name: 'planner-overview',
    viewport: DESKTOP,
    async run(page, ctx) {
      await page.goto(`${ctx.app}?desktop`, { waitUntil: 'networkidle' });
      await page.getByText(ctx.timetable.name).first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: ctx.out('planner-overview') });
    },
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

let shuttingDown = false;
const cleanups = [];
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanups.reverse().forEach((fn) => { try { fn(); } catch { /* best effort */ } });
  children.forEach((c) => c.kill());
  if (tmpDir && !process.env.KEEP_TMP) fs.rmSync(tmpDir, { recursive: true, force: true });
}

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { SHOTS.forEach((s) => console.log(s.name)); return; }
  const serve = args.includes('--serve');
  const filters = args.filter((a) => !a.startsWith('--')).map(globToRe);
  const selected = SHOTS.filter((s) => !filters.length || filters.some((re) => re.test(s.name)));
  if (!serve && !selected.length) throw new Error('no shots match');

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-docs-'));
  process.on('SIGINT', () => { shutdown(); process.exit(130); });
  process.on('exit', shutdown);

  const broker = await startBroker();
  cleanups.push(broker.close);
  startChild('jmri', process.execPath, [path.join(ROOT, 'scripts/dev/mock-jmri.js')], {
    env: { ...process.env, PORT: String(PORTS.jmri), ROSTER: path.join(DEMO, 'roster.json') },
  });
  startChild('server', process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORTS.server), DB_PATH: path.join(tmpDir, 'train-graph.json') },
  });
  startChild('vite', process.execPath, [path.join(path.dirname(require.resolve('vite/package.json', { paths: [path.join(ROOT, 'client')] })), 'bin/vite.js'), '--port', String(PORTS.vite), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    env: { ...process.env, LIVERUN_API: `http://localhost:${PORTS.server}` },
  });
  await waitFor(`${API}/timetables`, 'server');
  await waitFor(`http://localhost:${PORTS.jmri}/json/roster`, 'mock JMRI');
  await waitFor(APP, 'vite');

  const pub = createPublisher();
  cleanups.push(pub.close);
  await pub.ready;
  const data = await seed(pub);
  log(`seeded "${data.timetable.name}" (${data.timetable.trains.length} trains); logs in ${tmpDir}`);

  if (serve) {
    log(`planner  ${APP}?desktop`);
    log(`crew     ${APP}mobile`);
    log(`guard    ${APP}guard`);
    log(`api      ${API}   broker ${BROKER_WS}   jmri ${JMRI_WS}`);
    log('Ctrl+C to stop');
    await new Promise(() => {});
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  cleanups.push(() => browser.close());
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = { app: APP, api, pub, ...data, out: (name) => path.join(OUT, `${name}.png`) };
  let failed = 0;
  for (const shot of selected) {
    const context = await browser.newContext({ viewport: shot.viewport || DESKTOP, deviceScaleFactor: shot.scale || 1 });
    const page = await context.newPage();
    try {
      await shot.run(page, ctx);
      log(`✓ ${shot.name}`);
    } catch (e) {
      failed++;
      log(`✗ ${shot.name}: ${e.message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
  await browser.close();
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { if (!process.argv.includes('--serve')) shutdown(); });
