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
const { Duplex } = require('stream');
const { WebSocketServer } = require('ws');
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
  child.on('exit', (code) => {
    if (shuttingDown) return;
    log(`${name} exited (${code}); see ${tmpDir}/${name}.log`);
    process.env.KEEP_TMP = '1'; // keep the logs
    shutdown();
    process.exit(1);
  });
  children.push(child);
  return child;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, 'localhost');
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function waitFor(url, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`${label} did not start (${url}); logs in ${tmpDir}`);
}

/**
 * WebSocket → stream for aedes. mqtt.js in Node sends each field of a packet as
 * its own frame, and aedes stalls on a CONNECT split over that many reads, so
 * frames that arrive together are pushed as one buffer.
 */
function wsStream(sock) {
  let pending = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _enc, cb) { sock.send(chunk, { binary: true }, cb); },
    final(cb) { sock.close(); cb(); },
    destroy(err, cb) { sock.terminate(); cb(err); },
  });
  sock.on('message', (data) => {
    if (!pending.length) setImmediate(() => { const buf = Buffer.concat(pending); pending = []; stream.push(buf); });
    pending.push(data);
  });
  sock.on('close', () => stream.destroy());
  sock.on('error', (err) => stream.destroy(err));
  return stream;
}

async function startBroker() {
  const { Aedes } = require('aedes');
  const broker = await Aedes.createBroker();
  const tcp = net.createServer(broker.handle);
  await new Promise((r) => tcp.listen(PORTS.mqtt, r));
  const wss = new WebSocketServer({ port: PORTS.mqttWs });
  wss.on('connection', (sock, req) => broker.handle(wsStream(sock), req));
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
const TABLET = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const byName = (list, name) => {
  const found = list.find((x) => x.name === name);
  if (!found) throw new Error(`demo data has no "${name}"`);
  return found;
};
const crewOf = (ctx, name) => byName(ctx.timetable.crews, name);
const trainOf = (ctx, name) => byName(ctx.timetable.trains, name);
const stationOf = (ctx, name) => byName(ctx.timetable.stations, name);

/** Puts the timetable back as seeded, after a shot that plays Control. */
const restoreTimetable = (ctx) => ctx.api('POST', `/timetables/${ctx.timetable.id}/restore`, ctx.timetable);
/** Every LOA element back to not clear. */
const resetLoa = (ctx) => Promise.all(Object.entries(ctx.loa).map(([t, v]) => ctx.pub.set(t, v)));

/** PUT body for a train (the API takes camelCase), with fields overridden. */
function trainBody(t, patch = {}) {
  return {
    name: t.name, color: t.color, notes: t.notes, trainId: t.train_id, direction: t.direction, crewId: t.crew_id,
    stops: t.stops.map((s) => ({
      stationId: s.station_id, arrival: s.arrival, departure: s.departure,
      specialInstructions: s.special_instructions, locationAlias: s.location_alias, guardEvents: s.guard_events,
    })),
    ...patch,
  };
}

/** Control moves one stop's times through the graph-edit endpoint. */
function retimeStop(ctx, trainName, stationName, times) {
  const t = trainOf(ctx, trainName);
  const stationId = stationOf(ctx, stationName).id;
  const stop = t.stops.find((s) => s.station_id === stationId);
  return ctx.api('POST', `/timetables/${ctx.timetable.id}/trains/retime`, {
    changes: [{ trainId: t.id, times: t.stops.map((s) => (s === stop ? { stationId, ...times } : { stationId: s.station_id, arrival: s.arrival, departure: s.departure })) }],
  });
}

/** Seeds the guard panel's crew and train choice in localStorage before the page loads. */
async function seedGuard(page, ctx, { crew, train }) {
  const items = {};
  if (crew) items['guard:crew'] = crew === '*' ? '*' : crewOf(ctx, crew).id;
  if (train) items[`guard:train:${ctx.timetable.id}`] = trainOf(ctx, train).id;
  await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, items);
}

/** Opens the guard panel on a train at a clock time, past Tap to start, with the throttle acquired. */
async function openGuard(page, ctx, { crew, train, clock, waitThrottle = true }) {
  ctx.pub.setClock(clock);
  await seedGuard(page, ctx, { crew, train });
  await page.goto(`${ctx.app}guard`, { waitUntil: 'networkidle' });
  await page.getByText('Tap to start').click();
  await page.getByRole('heading', { name: train }).waitFor();
  if (waitThrottle) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'DOORS OPEN');
      return b && !b.disabled;
    }, null, { timeout: 15000 });
  }
  await page.waitForTimeout(800);
}

/** Opens the Running board (the mobile view's board) filtered to one crew. */
async function openCrew(page, ctx, { crew, clock }) {
  ctx.pub.setClock(clock);
  await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, {
    'mob:crewFilter': JSON.stringify(crew ? [crewOf(ctx, crew).id] : []),
  });
  await page.goto(`${ctx.app}mobile?view=board`, { waitUntil: 'networkidle' });
  const pick = page.getByRole('button', { name: ctx.timetable.name });
  if (await pick.isVisible().catch(() => false)) await pick.click();
  await page.waitForTimeout(1200);
}

/** Scrolls the element with exactly this text to the top of its scroller. */
async function scrollToText(page, text) {
  await page.getByText(text, { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
}

/** Opens the planner on the demo timetable. `sections` force sidebar sections open. */
async function openPlanner(page, ctx, { clock = '12:05', sections } = {}) {
  ctx.pub.setClock(clock);
  if (sections) {
    await page.addInitScript((v) => localStorage.setItem('tg:openSections', v),
      JSON.stringify({ trains: true, stations: true, paths: false, crews: false, ...sections }));
  }
  await page.goto(`${ctx.app}?desktop`, { waitUntil: 'networkidle' });
  await page.getByText(ctx.timetable.name).first().click();
  await page.waitForTimeout(1000);
}

/** Opens Layout settings at one section. */
async function openLayout(page, ctx, label) {
  await openPlanner(page, ctx); // previews need an open timetable
  await page.getByTitle('Layout settings').click();
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(600);
}

/** Opens Crew jobs (…/mobile?view=jobs) as one crew, with the crew choice stored for this timetable. */
async function openJobs(page, ctx, { crew, clock }) {
  ctx.pub.setClock(clock);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`jobs:crew:${ctx.timetable.id}`, crewOf(ctx, crew).id]);
  await page.goto(`${ctx.app}mobile?view=jobs`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'My jobs' }).waitFor();
  await page.waitForTimeout(1200);
}

// ── Path requests: seeding and cleaning up (import drops requests; restore keeps them) ──

const DEVICE_HEADERS = {
  // What the audit log records for a phone: a device id and a browser.
  'X-LiveRun-Device': 'f3a91c7e2b64',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};

/** API call with extra headers (device, fast clock) so audit rows look like they came from a phone. */
async function apiAs(headers, method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * A crew submits a request. stops: [[station, kind?, minutes?, note?], …] in route order
 * (first and last are plain stops). Returns the new request.
 */
async function submitRequest(ctx, crewName, { stops, loco, readyAt = null, notes, clock = '12:05' }) {
  const body = {
    crewId: crewOf(ctx, crewName).id,
    ...(loco ? { loco } : {}),
    stops: stops.map(([station, kind = 'stop', minutes = 0, note]) => ({
      stationId: stationOf(ctx, station).id, kind, minutes, ...(note ? { note } : {}),
    })),
    readyAt,
    ...(notes ? { notes } : {}),
  };
  const tt = await apiAs({ ...DEVICE_HEADERS, 'X-LiveRun-Clock': clock }, 'POST', `/timetables/${ctx.timetable.id}/path-requests`, body);
  return tt.path_requests[tt.path_requests.length - 1];
}

const reqUrl = (ctx, r, action) => `/timetables/${ctx.timetable.id}/path-requests/${r.id}/${action}`;

/** Control accepts a request with a two-stop train (times fixed, so the shot is repeatable). */
function acceptRequest(ctx, r, { name, crew, from, to, dep, arr, note }) {
  return ctx.api('POST', reqUrl(ctx, r, 'accept'), {
    train: {
      name, color: crewOf(ctx, crew).color, crewId: crewOf(ctx, crew).id,
      stops: [
        { stationId: stationOf(ctx, from).id, arrival: null, departure: dep },
        { stationId: stationOf(ctx, to).id, arrival: arr, departure: null },
      ],
    },
    ...(note ? { note } : {}),
  });
}

/** Back to no requests and the seeded trains: decline what's open, drop closed rows, restore the trains. */
async function cleanRequests(ctx) {
  const tt = await ctx.api('GET', `/timetables/${ctx.timetable.id}`);
  for (const r of tt.path_requests || []) {
    if (['pending', 'in_review'].includes(r.status)) await ctx.api('POST', reqUrl(ctx, r, 'decline'), { note: 'cleanup' });
    else if (r.status === 'accepted' && r.cancel_ask?.status === 'open') await ctx.api('POST', reqUrl(ctx, r, 'cancel-reject'), { note: 'cleanup' });
  }
  await restoreTimetable(ctx);
  await ctx.api('DELETE', `/timetables/${ctx.timetable.id}/path-requests?closed=true`);
}

/** Opens the Requests drawer in the planner. */
async function openRequests(page) {
  await page.getByTitle('Path requests from crews').click();
  await page.getByLabel('Path requests').waitFor();
  await page.waitForTimeout(800);
}

const GUARD_CREW = 'Local Operator 5';
const GUARD_TRAIN = 'KN-6'; // Nowra 12:10 → Berry 12:32/12:50 → Kiama 13:18

const SHOTS = [
  // ── Entry ──
  {
    name: 'mode-picker',
    viewport: DESKTOP,
    async run(page, ctx) {
      await page.goto(`${ctx.app}?choose`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: ctx.out('mode-picker') });
    },
  },

  // ── Planner ──
  {
    name: 'planner-overview',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      await page.screenshot({ path: ctx.out('planner-overview') });
    },
  },
  {
    name: 'planner-train-editor',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      await page.locator('aside').getByText(GUARD_TRAIN, { exact: true }).first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: ctx.out('planner-train-editor') });
      const panel = page.locator('.fixed.top-0.right-0.bottom-0');
      await panel.getByText('Berry', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('planner-train-editor-stops') });
      await panel.getByText('Guard events (1)').first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('planner-train-editor-guard-events') });
    },
  },
  {
    name: 'planner-crews',
    viewport: { width: 1440, height: 1100 },
    async run(page, ctx) {
      await openPlanner(page, ctx, { sections: { trains: false, stations: false, crews: true } });
      const box = await page.locator('aside').first().boundingBox();
      await page.screenshot({ path: ctx.out('planner-crews'), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    },
  },
  {
    name: 'planner-graph-edit',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      for (let i = 0; i < 3; i++) { await page.getByTitle('Zoom in', { exact: true }).click(); await page.waitForTimeout(150); }
      await page.waitForTimeout(500);
      await page.getByText('✎ Edit').click();
      // Drag KN-6 later by a few minutes: grab the middle of its first segment.
      const { x, y } = await page.locator(`[data-train-id="${trainOf(ctx, GUARD_TRAIN).id}"] polyline`).last().evaluate((el) => {
        const [a, b] = [el.points.getItem(0), el.points.getItem(1)];
        const m = el.getScreenCTM();
        return { x: m.a * (a.x + b.x) / 2 + m.c * (a.y + b.y) / 2 + m.e, y: m.b * (a.x + b.x) / 2 + m.d * (a.y + b.y) / 2 + m.f };
      });
      await page.mouse.move(x - 5, y);
      await page.mouse.move(x, y, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(x + 40, y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await page.getByText(/1 train moved/).waitFor({ timeout: 3000 });
      await page.screenshot({ path: ctx.out('planner-graph-edit') });
      await page.getByRole('button', { name: 'Cancel' }).first().click();
    },
  },
  {
    name: 'planner-settings',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      await page.getByTitle('Settings', { exact: true }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: ctx.out('planner-settings') });
    },
  },
  {
    name: 'planner-print',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      await page.getByTitle('Print', { exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: ctx.out('planner-print-menu') });
      await page.getByRole('button', { name: /Station report/ }).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: ctx.out('planner-station-report') });
    },
  },

  // ── Layout settings ──
  ...[
    ['JMRI', 'layout-jmri'],
    ['Guard panel', 'layout-guard'],
    ['Train profiles', 'layout-train-profiles'],
    ['Guard events', 'layout-guard-events'],
    ['Stats', 'layout-stats'],
    ['Limit of authority', 'layout-loa'],
    ['Sound library', 'layout-sound-library'],
  ].map(([label, name]) => ({
    name,
    viewport: DESKTOP,
    async run(page, ctx) {
      await openLayout(page, ctx, label);
      await page.screenshot({ path: ctx.out(name) });
    },
  })),
  {
    name: 'layout-boarding-example',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openLayout(page, ctx, 'Boarding');
      page.once('dialog', (d) => d.accept()); // "Replace the demand curve…?"
      await page.getByRole('button', { name: 'Load example (Illawarra)' }).click(); // not saved
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('layout-boarding-example') });
      await page.getByText('Preview', { exact: true }).last().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('layout-boarding-preview') });
    },
  },
  {
    name: 'layout-loa-section',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openLayout(page, ctx, 'Limit of authority');
      // Expand the third section (Nowra → Berry, the one KN-6 runs first).
      await page.getByRole('button', { name: 'Expand section' }).nth(2).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('layout-loa-section') });
      await page.getByLabel('Preview train').selectOption(trainOf(ctx, GUARD_TRAIN).id);
      await page.getByLabel('Preview train').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: ctx.out('layout-loa-preview') });
    },
  },

  // ── Guard panel ──
  {
    name: 'guard-tap-to-start',
    viewport: TABLET,
    async run(page, ctx) {
      ctx.pub.setClock('12:05');
      await seedGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN });
      await page.goto(`${ctx.app}guard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: ctx.out('guard-tap-to-start') });
    },
  },
  {
    name: 'guard-crew-picker',
    viewport: TABLET,
    async run(page, ctx) {
      await page.goto(`${ctx.app}guard`, { waitUntil: 'networkidle' });
      await page.getByText('Tap to start').click();
      await page.getByText('Who are you?').waitFor();
      await page.screenshot({ path: ctx.out('guard-crew-picker') });
    },
  },
  {
    name: 'guard-overview',
    viewport: TABLET,
    async run(page, ctx) {
      await openGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN, clock: '12:05' });
      await page.screenshot({ path: ctx.out('guard-overview') });
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: ctx.out('guard-menu') });
    },
  },
  {
    name: 'guard-loa-granted',
    viewport: TABLET,
    async run(page, ctx) {
      await openGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN, clock: '12:08' });
      // Control sets up Nowra → Berry: both signals off and the staff out, all at once.
      await Promise.all([
        ctx.pub.set('trains/track/signal/Nowra/1', 'THROWN'),
        ctx.pub.set('trains/staff/nowra-berry', 'CATS'),
        ctx.pub.set('trains/track/signal/Berry/2', 'THROWN'),
      ]);
      await page.locator('[data-testid="loa-strip"][data-tone="granted"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: ctx.out('guard-loa-granted') });
      await resetLoa(ctx);
    },
  },
  {
    name: 'guard-boarding',
    viewport: TABLET,
    async run(page, ctx) {
      await openGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN, clock: '12:33' });
      await page.getByRole('button', { name: 'DOORS OPEN' }).click();
      await page.locator('[data-testid="boarding-remaining"]').waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: ctx.out('guard-boarding') });
      // The demo places a "late passenger" event on KN-6 at Berry, 3–6 s after the doors open.
      await page.locator('[data-testid="event-banner"]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: ctx.out('guard-event-banner') });
      // The mock JMRI keeps function states between shots: leave the doors shut.
      await page.getByRole('button', { name: 'ACK' }).click();
      await page.getByRole('button', { name: 'DOORS CLOSE' }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'guard-control-retime',
    viewport: TABLET,
    async run(page, ctx) {
      await openGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN, clock: '12:05' });
      await retimeStop(ctx, GUARD_TRAIN, 'Berry', { arrival: '12:35', departure: '12:55' });
      await page.getByText(/retimed/i).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: ctx.out('guard-control-retime') });
      await restoreTimetable(ctx);
    },
  },
  {
    name: 'guard-lost-train',
    viewport: TABLET,
    async run(page, ctx) {
      await openGuard(page, ctx, { crew: GUARD_CREW, train: GUARD_TRAIN, clock: '12:05' });
      const t = trainOf(ctx, GUARD_TRAIN);
      await ctx.api('PUT', `/timetables/${ctx.timetable.id}/trains/${t.id}`, trainBody(t, { crewId: crewOf(ctx, 'Local Operator 6').id }));
      await page.getByText(/has reassigned/).waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: ctx.out('guard-lost-train') });
      await restoreTimetable(ctx);
    },
  },
  {
    name: 'guard-doors-sounds-only',
    viewport: TABLET,
    async run(page, ctx) {
      // 9923 is a freight: no profile maps a decoder function, so the doors only play sounds.
      await openGuard(page, ctx, { crew: '*', train: '9923', clock: '12:05', waitThrottle: false });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: ctx.out('guard-doors-sounds-only') });
    },
  },
  {
    name: 'guard-doors-refused',
    viewport: TABLET,
    async run(page, ctx) {
      // K444 runs CityRail 4T: a profile maps its doors, but the demo roster leaves it out, so JMRI refuses the throttle.
      await openGuard(page, ctx, { crew: GUARD_CREW, train: 'K444', clock: '13:35', waitThrottle: false });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: ctx.out('guard-doors-refused') });
    },
  },

  // ── Crew view ──
  {
    name: 'crew-overview',
    viewport: PHONE,
    scale: 2,
    async run(page, ctx) {
      await openCrew(page, ctx, { crew: GUARD_CREW, clock: '12:05' });
      await scrollToText(page, 'KN-5');
      await page.screenshot({ path: ctx.out('crew-overview') });
    },
  },
  {
    name: 'crew-changes',
    viewport: PHONE,
    scale: 2,
    async run(page, ctx) {
      await openCrew(page, ctx, { crew: GUARD_CREW, clock: '12:05' });
      // Control gives this crew another job and retimes one they already have.
      const extra = trainOf(ctx, 'KN-7');
      await ctx.api('PUT', `/timetables/${ctx.timetable.id}/trains/${extra.id}`, trainBody(extra, { crewId: crewOf(ctx, GUARD_CREW).id }));
      await retimeStop(ctx, GUARD_TRAIN, 'Berry', { arrival: '12:35', departure: '12:55' });
      await page.waitForTimeout(1500);
      await page.getByText(GUARD_TRAIN, { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);
      await page.screenshot({ path: ctx.out('crew-changes') });
      await restoreTimetable(ctx);
    },
  },

  // ── Mobile: Crew jobs ──
  {
    name: 'mobile-view-picker',
    viewport: PHONE,
    scale: 2,
    async run(page, ctx) {
      await page.goto(`${ctx.app}mobile`, { waitUntil: 'networkidle' });
      await page.getByText('Which view on this phone?').waitFor();
      await page.screenshot({ path: ctx.out('mobile-view-picker') });
    },
  },
  {
    name: 'jobs-overview',
    viewport: PHONE,
    scale: 2,
    async run(page, ctx) {
      await openJobs(page, ctx, { crew: GUARD_CREW, clock: '12:05' });
      // KN-6 is the next job, so it opens by itself; its Berry stop carries a special instruction.
      await page.getByText('Work with Berry Signaller').first().waitFor();
      await scrollToText(page, 'My jobs');
      await page.getByText('KN-6', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: ctx.out('jobs-overview') });
    },
  },
  {
    name: 'jobs-request-form',
    viewport: { width: 390, height: 1250 },
    scale: 2,
    async run(page, ctx) {
      await openJobs(page, ctx, { crew: GUARD_CREW, clock: '12:05' });
      await page.getByRole('button', { name: '+ Request a path' }).click();
      const form = page.getByRole('dialog', { name: 'Request a path' });
      await form.getByLabel('From (where you are now)').selectOption({ label: 'Kiama' });
      await form.getByRole('button', { name: '+ Add stop' }).click();
      await form.getByLabel('Station', { exact: true }).selectOption({ label: 'Bombo' });
      await form.getByRole('button', { name: 'Shunt' }).click();
      await form.getByLabel('Minutes on site').fill('20');
      await form.getByLabel('Note for this stop').fill('drop 2 wagons');
      await form.getByLabel('To (where you want to go)').selectOption({ label: 'Kembla Heights' });
      await form.getByLabel('Notes for Control').fill('Loco needs to be back at Kiama by 13:30.');
      await page.waitForTimeout(500);
      await page.screenshot({ path: ctx.out('jobs-request-form') });
    },
  },
  {
    name: 'jobs-requests',
    viewport: PHONE,
    scale: 2,
    async run(page, ctx) {
      try {
        // Oldest first: the accepted one, the declined one, then the one still waiting.
        const done = await submitRequest(ctx, GUARD_CREW, { stops: [['Nowra'], ['Berry']], loco: 'CityRail 4T' });
        await ctx.api('POST', reqUrl(ctx, done, 'acknowledge'));
        await acceptRequest(ctx, done, { name: 'PR1', crew: GUARD_CREW, from: 'Nowra', to: 'Berry', dep: '12:40', arr: '13:02', note: 'Clear to run' });
        const no = await submitRequest(ctx, GUARD_CREW, { stops: [['Kiama'], ['Staging (Up)']], readyAt: '12:30' });
        await ctx.api('POST', reqUrl(ctx, no, 'decline'), { note: 'No room at Staging until 13:00' });
        await submitRequest(ctx, GUARD_CREW, {
          stops: [['Kiama'], ['Bombo', 'shunt', 20, 'drop 2 wagons'], ['Kembla Heights']],
          loco: 'CityRail 4T',
        });
        await openJobs(page, ctx, { crew: GUARD_CREW, clock: '12:05' });
        // One list: the requests (collapsed) sit at the top of My jobs, the accepted one is its job below.
        await page.getByText('My jobs').waitFor();
        await page.getByText('My jobs').evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: ctx.out('jobs-requests') });
      } finally { await cleanRequests(ctx); }
    },
  },

  // ── Planner: path requests ──
  {
    name: 'planner-requests-drawer',
    viewport: DESKTOP,
    async run(page, ctx) {
      try {
        // A shunt on one path template, a run worked out from two paths, a run with no path data, and a crew asking to cancel.
        await submitRequest(ctx, 'Local Operator 2', {
          stops: [['Kiama'], ['Bombo', 'shunt', 20, 'drop 2 wagons'], ['Kembla Heights']],
          loco: 'CityRail 4T', notes: 'Back at Kiama by 13:30 if possible.',
        });
        await submitRequest(ctx, 'Local Operator 3', { stops: [['Staging (Down)'], ['Kembla Heights']], readyAt: '12:30' });
        await submitRequest(ctx, 'Local Operator 1', { stops: [['Berry'], ['Kiama Down Siding']] });
        const acc = await submitRequest(ctx, GUARD_CREW, { stops: [['Nowra'], ['Berry']], loco: 'CityRail 4T' });
        await ctx.api('POST', reqUrl(ctx, acc, 'acknowledge'));
        await acceptRequest(ctx, acc, { name: 'PR1', crew: GUARD_CREW, from: 'Nowra', to: 'Berry', dep: '12:40', arr: '13:02' });
        await apiAs(DEVICE_HEADERS, 'POST', reqUrl(ctx, acc, 'cancel-ask'), { crewId: crewOf(ctx, GUARD_CREW).id, reason: 'Loco has failed' });
        await openPlanner(page, ctx);
        await openRequests(page);
        await page.screenshot({ path: ctx.out('planner-requests-drawer') });
      } finally { await cleanRequests(ctx); }
    },
  },
  {
    name: 'planner-plotting',
    viewport: DESKTOP,
    async run(page, ctx) {
      try {
        await submitRequest(ctx, 'Local Operator 2', {
          stops: [['Kiama'], ['Bombo', 'shunt', 20, 'drop 2 wagons'], ['Kembla Heights']],
          loco: 'CityRail 4T',
        });
        await openPlanner(page, ctx, { clock: '12:00' });
        for (let i = 0; i < 2; i++) { await page.getByTitle('Zoom in', { exact: true }).click(); await page.waitForTimeout(150); }
        await openRequests(page);
        await page.getByRole('button', { name: 'Acknowledge & plot' }).click();
        await page.getByText(/^Plotting PR\d+ for/).waitFor();
        await page.waitForTimeout(800);
        await page.screenshot({ path: ctx.out('planner-plotting') });
        await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
        await page.waitForTimeout(400);
      } finally { await cleanRequests(ctx); }
    },
  },
  {
    name: 'planner-audit-log',
    viewport: DESKTOP,
    async run(page, ctx) {
      try {
        ctx.resetAudit();
        const r = await submitRequest(ctx, 'Local Operator 2', {
          stops: [['Kiama'], ['Bombo', 'shunt', 20, 'drop 2 wagons'], ['Kembla Heights']], loco: 'CityRail 4T', clock: '12:03',
        });
        await ctx.api('POST', reqUrl(ctx, r, 'acknowledge'));
        await acceptRequest(ctx, r, { name: 'PR1', crew: 'Local Operator 2', from: 'Kiama', to: 'Kembla Heights', dep: '12:40', arr: '13:22' });
        // A late withdraw from the crew's phone is refused, and the refusal is logged too.
        await apiAs({ ...DEVICE_HEADERS, 'X-LiveRun-Clock': '12:09' }, 'POST', reqUrl(ctx, r, 'withdraw'), { crewId: crewOf(ctx, 'Local Operator 2').id }).catch(() => {});
        await openPlanner(page, ctx);
        await openRequests(page);
        await page.getByRole('tab', { name: 'Audit log' }).click();
        await page.getByText(/shown/).waitFor();
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: 'Detail' }).first().click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: ctx.out('planner-audit-log') });
      } finally { await cleanRequests(ctx); }
    },
  },
  {
    name: 'settings-path-requests',
    viewport: DESKTOP,
    async run(page, ctx) {
      await openPlanner(page, ctx);
      await page.getByTitle('Settings', { exact: true }).click();
      await page.waitForTimeout(500);
      const group = page.getByText('Path requests', { exact: true }).first();
      await group.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: ctx.out('settings-path-requests') });
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

  // A leftover stack (e.g. a killed --serve) would silently answer instead of ours.
  for (const [name, port] of Object.entries(PORTS)) {
    if (await portInUse(port)) throw new Error(`port ${port} (${name}) is in use; stop the other stack or set DOCS_PORT_BASE`);
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liverun-docs-'));
  process.on('SIGINT', () => { shutdown(); process.exit(130); });
  process.on('SIGTERM', () => { shutdown(); process.exit(143); });
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
  const ctx = {
    app: APP, api, pub, ...data,
    resetAudit: () => { for (const f of ['audit.jsonl', 'audit.1.jsonl']) fs.rmSync(path.join(tmpDir, f), { force: true }); },
    out: (name) => path.join(OUT, `${name}.png`) };
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
