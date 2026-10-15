// Draft train for a path request, timed from the layout's path templates
// (docs/path-requests-spec.md §5.2). Pure: no React, no API.
import type { PathRequest, PathRequestStop, Path, Station, Timetable, Train, TrainStop } from '../types';
import { minutesToTime, timeToMinutes } from '../utils';

/** Where one leg (consecutive pair of requested points) got its running time. */
export type LegSource =
  /** All requested points lie on one path template, in order (forwards or reversed). */
  | 'path'
  /** Fastest route through the graph of every path's legs (median minutes where paths share a leg). */
  | 'inferred'
  /** No route in the path data, or it would visit a station twice: the two points only, request_default_leg_min. */
  | 'none';

export interface PlanLeg {
  fromStationId: string;
  toStationId: string;
  /** Passing stations between the two points, in running order (timing points, no dwell). */
  viaStationIds: string[];
  /** Running minutes from departing `from` to arriving at `to` (whole minutes, ≥ 0). */
  minutes: number;
  source: LegSource;
}

/** Summary for the drawer's "times from" line and the edit bar. */
export type PlanSource =
  | { kind: 'path'; pathId: string; pathName: string }
  /** Legs chained from these paths (deduplicated, sorted by name). Some legs may still be 'none'. */
  | { kind: 'inferred'; pathNames: string[] }
  /** No leg had path data. */
  | { kind: 'none' };

export interface PlanResult {
  /**
   * The draft train. Not in timetable.trains: id = pendingTrainId(request.id),
   * stop ids `${id}:${n}` with n the stop's 0-based position in running order,
   * timetable_id, request_id = request.id.
   * Stops are in STATION ORDER (timetable.stations order, as the planner stores
   * every train), terminal rule applied (first no arrival, last no departure).
   * name = `${settings.request_train_prefix ?? 'PR'}${n}` with n the lowest
   * positive integer not used by an existing train of that prefix (name exactly prefix + digits);
   * crew_id = request.crew_id; color = that crew's colour (fallback '#3b82f6');
   * train_id = request.loco ?? ''; notes = request.notes ?? '';
   * direction = 'Down' if graph_pos rises from first to last stop in running order, else 'Up'.
   * Requested points: location_alias from the request; dwell = minutes (at least 1 for
   * intermediate kind 'stop'); shunt/work → special_instructions "Shunt 20 min" / "Work 5 min"
   * plus ": <note>" if any; a 'stop' with a note → the note. Passing stations: arrival = departure, nothing else.
   * A leg's minutes are split across its passing stations in proportion to the underlying
   * path legs (whole minutes, cumulative times monotonic, leg total exact).
   */
  train: Train;
  source: PlanSource;
  legs: PlanLeg[];
  /** Non-blocking, human-readable, e.g. "Bombo → Dunmore: no path data, 5 min used". */
  warnings: string[];
  /** Minutes (may be ≥ 1440 past midnight) the first stop departs. */
  startMinutes: number;
}

export const pendingTrainId = (requestId: string): string => `pending:${requestId}`;

const DEFAULT_LEG_MIN = 5;
const DEFAULT_LEAD_MIN = 2;
const DEFAULT_PREFIX = 'PR';
const FALLBACK_COLOR = '#3b82f6';

/** A non-negative finite number, else the fallback. */
const nonNeg = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

const fmt = (t: number): string => minutesToTime(((t % 1440) + 1440) % 1440);

// ── Path data ────────────────────────────────────────────────────────────────

/** A path as a station sequence; legs[i] = minutes stations[i] → stations[i+1], NaN when unusable. */
interface PathSeq {
  path: Path;
  stations: string[];
  legs: number[];
}

/**
 * The path's stops by sort_order (stable), as legs. Stops at stations not in the
 * timetable are dropped and their legs merged into the next one. Non-finite or
 * negative leg minutes make that leg unusable (NaN).
 */
function pathSeq(path: Path, known: Set<string>): PathSeq {
  const stops = (path.stops ?? []).map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.sort_order - b.s.sort_order) || (a.i - b.i))
    .map((x) => x.s);
  const stations: string[] = [];
  const legs: number[] = [];
  let carry = 0;
  for (const ps of stops) {
    const m = typeof ps.travel_time_from_prev === 'number' && Number.isFinite(ps.travel_time_from_prev) && ps.travel_time_from_prev >= 0
      ? ps.travel_time_from_prev : NaN;
    if (stations.length > 0) carry += m;
    if (!known.has(ps.station_id)) continue;
    if (stations.length > 0) legs.push(carry);
    stations.push(ps.station_id);
    carry = 0;
  }
  return { path, stations, legs };
}

/** Internal leg: PlanLeg plus the weights of its sub-legs (vias + 1), for the time split. */
interface RouteLeg extends PlanLeg { sub: number[] }

interface Route {
  source: PlanSource;
  legs: RouteLeg[];
  warnings: string[];
}

/**
 * Smallest span of `seq` holding `points` in order (subsequence), with unique
 * stations and usable legs over the span. Returns the matched indices.
 */
function fitIn(stations: string[], legs: number[], points: string[]): number[] | null {
  let best: number[] | null = null;
  for (let s = 0; s < stations.length; s++) {
    if (stations[s] !== points[0]) continue;
    const idx = [s];
    let j = s;
    for (let k = 1; k < points.length; k++) {
      let n = j + 1;
      while (n < stations.length && stations[n] !== points[k]) n++;
      if (n >= stations.length) { j = -1; break; }
      idx.push(n);
      j = n;
    }
    if (j < 0) break; // later starts can't match either
    const span = stations.slice(s, j + 1);
    if (new Set(span).size !== span.length) continue;
    if (legs.slice(s, j).some((m) => Number.isNaN(m))) continue;
    if (!best || j - s < best[best.length - 1] - best[0]) best = idx;
  }
  return best;
}

/** §5.2 step 1: the most direct path holding every requested point in order, forwards or reversed. */
function singlePath(seqs: PathSeq[], points: string[]): Route | null {
  let best: { seq: PathSeq; stations: string[]; legs: number[]; idx: number[] } | null = null;
  const span = (idx: number[]): number => idx[idx.length - 1] - idx[0] + 1;
  for (const seq of seqs) {
    const fwd = { stations: seq.stations, legs: seq.legs };
    const rev = { stations: [...seq.stations].reverse(), legs: [...seq.legs].reverse() };
    for (const o of [fwd, rev]) {
      const idx = fitIn(o.stations, o.legs, points);
      if (!idx) continue;
      const better = !best
        || span(idx) < span(best.idx)
        || (span(idx) === span(best.idx) && best.seq !== seq && (
          seq.path.name.localeCompare(best.seq.path.name) < 0
          || (seq.path.name.localeCompare(best.seq.path.name) === 0 && seq.path.id < best.seq.path.id)));
      if (better) best = { seq, ...o, idx };
    }
  }
  if (!best) return null;
  const { stations, legs, idx } = best;
  const out: RouteLeg[] = [];
  for (let k = 1; k < idx.length; k++) {
    const a = idx[k - 1];
    const b = idx[k];
    const sub = legs.slice(a, b);
    out.push({
      fromStationId: stations[a], toStationId: stations[b],
      viaStationIds: stations.slice(a + 1, b),
      minutes: Math.max(0, Math.round(sub.reduce((x, y) => x + y, 0))),
      source: 'path', sub,
    });
  }
  return { source: { kind: 'path', pathId: best.seq.path.id, pathName: best.seq.path.name }, legs: out, warnings: [] };
}

interface Edge { minutes: number; pathNames: Set<string> }
type Graph = Map<string, Map<string, Edge>>;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Undirected graph of every usable path leg; an edge's minutes = median over the paths having it. */
function buildGraph(seqs: PathSeq[]): Graph {
  const raw = new Map<string, { a: string; b: string; values: number[]; names: Set<string> }>();
  for (const seq of seqs) {
    for (let i = 0; i < seq.legs.length; i++) {
      const m = seq.legs[i];
      const a = seq.stations[i];
      const b = seq.stations[i + 1];
      if (Number.isNaN(m) || a === b) continue;
      const [x, y] = a < b ? [a, b] : [b, a];
      const key = `${x}\u0000${y}`;
      const e = raw.get(key) ?? { a: x, b: y, values: [], names: new Set<string>() };
      e.values.push(m);
      e.names.add(seq.path.name);
      raw.set(key, e);
    }
  }
  const g: Graph = new Map();
  const link = (from: string, to: string, edge: Edge) => {
    if (!g.has(from)) g.set(from, new Map());
    g.get(from)!.set(to, edge);
  };
  for (const e of raw.values()) {
    const edge = { minutes: median(e.values), pathNames: e.names };
    link(e.a, e.b, edge);
    link(e.b, e.a, edge);
  }
  return g;
}

interface Label { cost: number; path: string[] }

/** Lower cost, then fewer hops, then lexicographic station-id path. */
function better(a: Label, b: Label): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.path.length !== b.path.length) return a.path.length < b.path.length;
  for (let i = 0; i < a.path.length; i++) {
    if (a.path[i] !== b.path[i]) return a.path[i] < b.path[i];
  }
  return false;
}

/** Dijkstra on edge minutes; deterministic ties (see better). Null when unreachable. */
function shortest(g: Graph, from: string, to: string): string[] | null {
  if (!g.has(from) || !g.has(to)) return null;
  const labels = new Map<string, Label>([[from, { cost: 0, path: [from] }]]);
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    for (const [node, l] of labels) {
      if (done.has(node)) continue;
      if (cur === null || better(l, labels.get(cur)!)) cur = node;
    }
    if (cur === null) return null;
    if (cur === to) return labels.get(cur)!.path;
    done.add(cur);
    const base = labels.get(cur)!;
    for (const [next, edge] of g.get(cur)!) {
      if (done.has(next)) continue;
      const cand = { cost: base.cost + edge.minutes, path: [...base.path, next] };
      const old = labels.get(next);
      if (!old || better(cand, old)) labels.set(next, cand);
    }
  }
}

/** The requested points' station ids, first occurrence kept (the server enforces uniqueness; guarded anyway). */
function uniquePoints(request: PathRequest, name: (id: string) => string, warnings: string[]): PathRequestStop[] {
  const seen = new Set<string>();
  const out: PathRequestStop[] = [];
  for (const s of request.stops ?? []) {
    if (seen.has(s.station_id)) { warnings.push(`${name(s.station_id)} requested twice, ignored`); continue; }
    seen.add(s.station_id);
    out.push(s);
  }
  return out;
}

function stationNamer(stations: Station[]): (id: string) => string {
  const byId = new Map(stations.map((s) => [s.id, s.name]));
  return (id) => byId.get(id) ?? id;
}

function route(request: PathRequest, timetable: Timetable): Route & { points: PathRequestStop[] } {
  const stations = timetable.stations ?? [];
  const name = stationNamer(stations);
  const warnings: string[] = [];
  const points = uniquePoints(request, name, warnings);
  const ids = points.map((p) => p.station_id);
  if (ids.length < 2) return { source: { kind: 'none' }, legs: [], warnings, points };

  const known = new Set(stations.map((s) => s.id));
  const seqs = (timetable.paths ?? []).map((p) => pathSeq(p, known));

  const single = singlePath(seqs, ids);
  if (single) return { ...single, warnings: [...warnings, ...single.warnings], points };

  const g = buildGraph(seqs);
  const fallback = nonNeg(timetable.settings?.request_default_leg_min, DEFAULT_LEG_MIN);
  const fallbackMin = Math.round(fallback);
  const inTrain = new Set(ids);
  const used = new Set<string>();
  const legs: RouteLeg[] = [];
  for (let k = 1; k < ids.length; k++) {
    const from = ids[k - 1];
    const to = ids[k];
    const none = (why: string): RouteLeg => {
      warnings.push(`${name(from)} → ${name(to)}: ${why}, ${fallbackMin} min used`);
      return { fromStationId: from, toStationId: to, viaStationIds: [], minutes: fallbackMin, source: 'none', sub: [fallbackMin] };
    };
    const p = shortest(g, from, to);
    if (!p) { legs.push(none('no path data')); continue; }
    const vias = p.slice(1, -1);
    const dup = vias.find((v) => inTrain.has(v));
    if (dup !== undefined) { legs.push(none(`route would pass ${name(dup)} twice`)); continue; }
    const sub: number[] = [];
    for (let i = 1; i < p.length; i++) {
      const edge = g.get(p[i - 1])!.get(p[i])!;
      sub.push(edge.minutes);
      for (const n of edge.pathNames) used.add(n);
    }
    vias.forEach((v) => inTrain.add(v));
    legs.push({
      fromStationId: from, toStationId: to, viaStationIds: vias,
      minutes: Math.max(0, Math.round(sub.reduce((x, y) => x + y, 0))),
      source: 'inferred', sub,
    });
  }
  const source: PlanSource = legs.some((l) => l.source === 'inferred')
    ? { kind: 'inferred', pathNames: [...used].sort((a, b) => a.localeCompare(b)) }
    : { kind: 'none' };
  return { source, legs, warnings, points };
}

const publicLeg = ({ sub: _sub, ...leg }: RouteLeg): PlanLeg => leg;

// ── Draft ────────────────────────────────────────────────────────────────────

/** Start minutes per §5.2; see planDraft. */
function startMinutes(request: PathRequest, timetable: Timetable, clockMinutes: number | null): number {
  const clock = typeof clockMinutes === 'number' && Number.isFinite(clockMinutes) ? clockMinutes : null;
  const ready = request.ready_at ? timeToMinutes(request.ready_at) : null;
  const readyOk = ready !== null && Number.isFinite(ready);
  if (readyOk && clock === null) return ready;
  if (clock !== null) {
    const now = Math.ceil(clock);
    if (readyOk) {
      // Midnight-safe "not before the clock": up to 12 h ahead counts as the future.
      const ahead = ((((ready - now) % 1440) + 1440) % 1440);
      if (ahead < 720) return now + ahead;
    }
    return now + Math.round(nonNeg(timetable.settings?.request_lead_min, DEFAULT_LEAD_MIN));
  }
  return timeToMinutes(timetable.start_time);
}

/** Dwell at a requested intermediate point: 'stop' at least 1 min, shunt/work as requested (may be 0). */
function dwellOf(p: PathRequestStop): number {
  const m = Math.round(nonNeg(p.minutes, 0));
  return p.kind === 'stop' ? Math.max(1, m) : m;
}

function instructionsOf(p: PathRequestStop): string | undefined {
  const note = (p.note ?? '').trim();
  if (p.kind === 'shunt' || p.kind === 'work') {
    const label = `${p.kind === 'shunt' ? 'Shunt' : 'Work'} ${Math.round(nonNeg(p.minutes, 0))} min`;
    return note ? `${label}: ${note}` : label;
  }
  return note || undefined;
}

function nextName(prefix: string, trains: Train[]): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(\\d+)$`);
  const used = new Set<number>();
  for (const t of trains) {
    const m = re.exec((t.name ?? '').trim());
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${n}`;
}

/**
 * Builds the draft. Start time (§5.2): request.ready_at if set and not before the
 * clock (or if the clock is unknown); else with the clock running, the clock
 * rounded up to the next whole minute + settings.request_lead_min (default 2); else
 * timetable.start_time. "Not before the clock" is midnight-safe: a ready_at up to
 * 12 h ahead of the clock is in the future (23:50 clock, 00:10 ready → 1450).
 * clockMinutes is null when the fast clock isn't running.
 */
export function planDraft(request: PathRequest, timetable: Timetable, clockMinutes: number | null): PlanResult {
  const r = route(request, timetable);
  const id = pendingTrainId(request.id);
  const start = startMinutes(request, timetable, clockMinutes);

  // Running order with unwrapped times.
  interface Point { stationId: string; arr: number | null; dep: number | null; req?: PathRequestStop }
  const run: Point[] = [];
  const points = r.points;
  let t = start;
  if (points.length > 0) run.push({ stationId: points[0].station_id, arr: null, dep: t, req: points[0] });
  r.legs.forEach((leg, k) => {
    const total = leg.sub.reduce((x, y) => x + y, 0);
    let cum = 0;
    leg.viaStationIds.forEach((v, j) => {
      cum += leg.sub[j];
      const at = t + (total > 0 ? Math.round((leg.minutes * cum) / total) : 0);
      run.push({ stationId: v, arr: at, dep: at });
    });
    const req = points[k + 1];
    const arr = t + leg.minutes;
    const last = k === r.legs.length - 1;
    const dep = last ? null : arr + dwellOf(req);
    run.push({ stationId: leg.toStationId, arr, dep, req });
    if (dep !== null) t = dep;
  });

  const stops: TrainStop[] = run.map((p, n) => {
    const stop: TrainStop = {
      id: `${id}:${n}`, train_id: id, station_id: p.stationId,
      arrival: p.arr === null ? null : fmt(p.arr),
      departure: p.dep === null ? null : fmt(p.dep),
    };
    if (p.req) {
      if (p.req.location_alias) stop.location_alias = p.req.location_alias;
      const si = instructionsOf(p.req);
      if (si) stop.special_instructions = si;
    }
    return stop;
  });

  const stations = timetable.stations ?? [];
  const order = new Map(stations.map((s, i) => [s.id, i]));
  const pos = new Map(stations.map((s) => [s.id, s.graph_pos]));
  const stored = stops.map((s, i) => ({ s, i }))
    .sort((a, b) => ((order.get(a.s.station_id) ?? Infinity) - (order.get(b.s.station_id) ?? Infinity)) || (a.i - b.i))
    .map((x) => x.s);

  const first = run.length ? pos.get(run[0].stationId) ?? 0 : 0;
  const lastPos = run.length ? pos.get(run[run.length - 1].stationId) ?? 0 : 0;
  const crew = (timetable.crews ?? []).find((c) => c.id === request.crew_id);
  const prefix = timetable.settings?.request_train_prefix ?? DEFAULT_PREFIX;

  const train: Train = {
    id,
    timetable_id: timetable.id,
    name: nextName(prefix, (timetable.trains ?? []).filter((tr) => tr.id !== id)),
    color: crew?.color || FALLBACK_COLOR,
    notes: request.notes ?? '',
    train_id: request.loco ?? '',
    direction: lastPos > first ? 'Down' : 'Up',
    crew_id: request.crew_id,
    request_id: request.id,
    stops: stored,
  };

  return { train, source: r.source, legs: r.legs.map(publicLeg), warnings: r.warnings, startMinutes: start };
}

/** Route + leg minutes only (no train, no times), cheap enough for every drawer row. */
export function planRoute(request: PathRequest, timetable: Timetable): { source: PlanSource; legs: PlanLeg[]; warnings: string[] } {
  const r = route(request, timetable);
  return { source: r.source, legs: r.legs.map(publicLeg), warnings: r.warnings };
}

/**
 * Drawer line: "Path Kiama–Bombo", "Inferred from 2 paths", "No path data", plus
 * " · ⚠ Bombo → Dunmore: no path data" per 'none' leg when the source isn't 'none'.
 */
export function describeSource(source: PlanSource, legs: PlanLeg[], stationName: (id: string) => string): string {
  if (source.kind === 'none') return 'No path data';
  const head = source.kind === 'path'
    ? `Path ${source.pathName}`
    : `Inferred from ${source.pathNames.length} path${source.pathNames.length === 1 ? '' : 's'}`;
  const flags = legs
    .filter((l) => l.source === 'none')
    .map((l) => ` · ⚠ ${stationName(l.fromStationId)} → ${stationName(l.toStationId)}: no path data`);
  return head + flags.join('');
}
