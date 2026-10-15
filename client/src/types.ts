// ─── Domain types ──────────────────────────────────────────────────────────────

export interface TimetableSummary {
  id: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
  active?: boolean;
}

export interface Station {
  id: string;
  timetable_id: string;
  name: string;
  short_code: string;
  /** Display-only km label. null = blank → graph shows short_code instead. */
  distance: number | null;
  /** Y-axis position on the graph (layout units, independent of real km). */
  graph_pos: number;
  sort_order: number;
  /** Optional branch name. Stations sharing a branch_name are grouped and
   *  shown indented on the graph with a collapse/expand toggle. */
  branch_name: string | null;
  /** When true, the per-train location alias field is shown in the train editor. */
  alias_enabled?: boolean;
  /** Name formatting flags — applied in graph labels and printouts. */
  bold_name?: boolean;
  italic_name?: boolean;
  underline_name?: boolean;
  /** Boarding demand weight for the guard panel (0–2, default 1). */
  boarding_weight?: number;
}

export interface TrainStop {
  id: string;
  train_id: string;
  station_id: string;
  arrival: string | null;
  departure: string | null;
  special_instructions?: string;
  location_alias?: string | null;
  /** Hidden scripted events, read only by the guard panel (spec §10). En-route placements describe the section from this stop to the next. */
  guard_events?: GuardEventPlacement[];
}

// ── Guard events (spec §10) ──

export type GuardEventKind = 'station' | 'enroute';
/** Door events at a stop that can trigger a station event. */
export type StationTrigger = 'door_open' | 'boarding_done' | 'door_close';

/** Reusable event definition in layout.events.library. */
export interface GuardEventDef {
  id: string;
  name: string;
  kind: GuardEventKind;
  /** Alternative wordings; one is picked at random when the event is rolled. */
  messages: string[];
  /** Sound library file ('' = layout.guard.event_alert_sound). */
  sound: string;
  /** Optional train-profile action run when the event fires (e.g. 'brake_squeal'). */
  action?: string;
}

/** An event placed on a train stop: a library reference, or inline (kind + messages set). */
export interface GuardEventPlacement {
  /** Stable id for this placement (rolled state is keyed by it). */
  id: string;
  /** Library event id; omit for an inline event. */
  event?: string;
  /** Inline events only (library events take their kind from the definition). */
  kind?: GuardEventKind;
  /** Inline wording, or an override of the library wording; null/absent = use the library's. */
  messages?: string[] | null;
  /** 0–1 chance the event happens this run. */
  probability: number;
  /** Station events: which door event at this stop starts the delay. */
  trigger?: StationTrigger;
  /** Station events: random delay in real seconds [min, max] after the trigger. */
  delay_s?: [number, number];
  /** En-route events: fire at a random fraction [min, max] of the section's scheduled running time. */
  at?: [number, number];
}

export interface EventsConfig {
  library: GuardEventDef[];
  /** MQTT topic to publish fired events to ('' = off). Blind push, like stats. */
  publish_topic: string;
}

export interface Crew {
  id: string;
  timetable_id: string;
  name: string;
  color: string;
  /** Offered in the guard panel's crew picker. Opt-in per crew; default false. */
  guard_visible?: boolean;
}

export interface Train {
  id: string;
  timetable_id: string;
  name: string;
  color: string;
  notes: string;
  train_id?: string;
  direction?: string;
  crew_id?: string;
  status?: 'running' | 'completed';
  /** Set on trains created by accepting a path request (docs/path-requests-spec.md §2). */
  request_id?: string;
  stops: TrainStop[];
}

export interface TimetableSettings {
  clock_enabled: boolean;
  clock_broker_url: string;
  clock_topic: string;
  auto_assign_min_break: number;
  graph_scale?: number | null;
  /** Path requests (docs/path-requests-spec.md §7). Server fills defaults. */
  requests_enabled?: boolean;        // default true
  request_train_prefix?: string;     // default 'PR'
  request_default_leg_min?: number;  // default 5
  request_lead_min?: number;         // default 2
}

export interface Timetable extends TimetableSummary {
  /** Bumped by the server on every mutation; used to detect missed live updates. */
  rev?: number;
  stations: Station[];
  trains: Train[];
  paths: Path[];
  crews: Crew[];
  settings: TimetableSettings;
  /** Path requests, active timetable only; the server always sends an array. Not part of undo (spec P2). */
  path_requests?: PathRequest[];
}

// ─── Path requests (docs/path-requests-spec.md §1–2) ──────────────────────────

export type PathRequestStatus = 'pending' | 'in_review' | 'accepted' | 'declined' | 'withdrawn' | 'cancelled';
export type PathWorkKind = 'stop' | 'shunt' | 'work';

export const PATH_REQUEST_OPEN: readonly PathRequestStatus[] = ['pending', 'in_review'];

export interface PathRequestStop {
  station_id: string;
  /** Siding/road; only where the station has alias_enabled. */
  location_alias?: string | null;
  /** Origin and destination are always 'stop'. */
  kind: PathWorkKind;
  /** Requested time on site, integer 0–240; origin/destination 0. */
  minutes: number;
  /** ≤ 200 chars; becomes special_instructions on accept. */
  note?: string;
}

export interface PathCancelAsk {
  at: string;
  reason?: string;
  status: 'open' | 'rejected' | 'approved';
  control_note?: string;
}

export interface PathRequest {
  id: string;
  timetable_id: string;
  /** Requesting crew; default assignee. */
  crew_id: string;
  /** JMRI roster name / free text → Train.train_id. */
  loco?: string;
  /** Running order: [current, …intermediate, proposed]; 2–20, unique stations. */
  stops: PathRequestStop[];
  /** HH:MM fast-clock time; null = as soon as possible. */
  ready_at?: string | null;
  /** ≤ 500 chars, for Control (copied to Train.notes on accept). */
  notes?: string;
  status: PathRequestStatus;
  created_at: string;
  updated_at: string;
  /** ≤ 300 chars, Control → crew. Required on decline. */
  control_note?: string;
  /** Train.id once accepted. */
  train_id_created?: string;
  /** Crew the train was given to (may differ from crew_id). */
  assigned_crew_id?: string;
  cancel_ask?: PathCancelAsk;
}

/** POST /api/timetables/:id/path-requests body (camelCase like other bodies). */
export interface PathRequestSubmit {
  crewId: string;
  loco?: string;
  stops: { stationId: string; locationAlias?: string | null; kind: PathWorkKind; minutes: number; note?: string }[];
  readyAt?: string | null;
  notes?: string;
}

/**
 * POST /api/timetables/:id/path-requests/:reqId/accept body (spec §4.2). `train` is the
 * draft as a normal train body (same rules as POST /trains; the server adds request_id).
 * `retime`: other trains moved while plotting, same shape as /trains/retime changes.
 */
export interface PathAcceptBody {
  train: Omit<TrainRequest, 'id'>;
  retime?: { trainId: string; times: { stationId: string; arrival: string | null; departure: string | null }[] }[];
  note?: string;
}

// ─── Audit log (docs/path-requests-spec.md §4.4) ──────────────────────────────

export type AuditAction =
  | 'submit' | 'withdraw' | 'acknowledge' | 'release' | 'decline' | 'accept'
  | 'cancel-ask' | 'cancel-approve' | 'cancel-reject' | 'clear';

export interface AuditEntry {
  /** ISO wall-clock time. */
  at: string;
  /** Fast-clock HH:MM if the client sent one (X-LiveRun-Clock). */
  clock?: string | null;
  ip: string;
  /** X-LiveRun-Device header ('' if absent). */
  device: string;
  /** Shortened user agent, e.g. "Safari iOS 18". */
  ua: string;
  actor: 'crew' | 'control';
  crew_id?: string | null;
  crew_name?: string | null;
  action: AuditAction;
  outcome: 'ok' | 'rejected';
  error?: string;
  timetable_id: string;
  timetable_name?: string | null;
  request_id?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditQuery {
  timetableId?: string;
  requestId?: string;
  crewId?: string;
  ip?: string;
  device?: string;
  action?: AuditAction;
  /** ISO time: only entries strictly before it (paging). */
  before?: string;
  /** Default 200, max 1000. */
  limit?: number;
}

// ─── Layout-wide configuration (GET/PUT /api/layout) ──────────────────────────
// Stored and sent in snake_case, like TimetableSettings. Sections are added
// phase by phase (see docs/guard-panel-spec.md §4.1).

export interface JmriConfig {
  /** JMRI JSON WebSocket URL, e.g. wss://jmri.example.net/json/ ('' = not configured). */
  url: string;
}

// ── Train profiles (spec §7.3): tablet sounds + decoder functions per train_id glob ──

/** How a guard action drives its decoder function. */
export type FunctionMode = 'on' | 'off' | 'toggle' | 'pulse' | 'hold' | 'on_for';

/** Which decoder function: an explicit number, or a label looked up in the loco's roster functionKeys. Exactly one is set. */
export type FunctionKeyRef = { fn: number } | { label: string };

export interface ProfileFunction {
  key: FunctionKeyRef;
  mode: FunctionMode;
  /** 'pulse': how long the function stays on. */
  pulse_ms?: number;
  /** 'on_for': how long the function stays on. */
  duration_s?: number;
}

/** Built-in guard actions; profiles may also define custom action names (e.g. 'brake_squeal'). */
export type GuardAction = 'door_open' | 'door_close' | 'bell';

export interface ProfileSounds {
  /** Sound library file names ('' = silent). */
  door_open: string;
  door_close: string;
  bell: string;
}

export interface TrainProfile {
  id: string;
  name: string;
  /** Case-insensitive globs on Train.train_id (* any run, ? one char). Empty = fallback profile. */
  match: string[];
  sounds: ProfileSounds;
  /** Keyed by action name (GuardAction or custom). Unmapped actions send nothing. */
  functions: Record<string, ProfileFunction>;
}

export interface GuardConfig {
  /** Sound library file played for guard events, Control banners and new-job toasts ('' = silent). */
  event_alert_sound: string;
}

// ── Boarding model (spec §8) — all layout-specific values are config (D13) ──

export interface BoardingRule {
  name: string;
  /** All keys optional; text keys are case-insensitive globs; from/to is a clock window (may cross midnight). */
  when: { direction?: string; train_id?: string; train_name?: string; from?: string; to?: string };
  factor: number;
}

export interface BoardingModel {
  max_passengers: number;
  /** [["HH:MM", factor], …] piecewise-linear over the fast clock. */
  demand_curve: [string, number][];
  rules: BoardingRule[];
  position: { origin: number; intermediate: number; terminus: number };
  /** Extra randomness as a fraction of expected. */
  spread: number;
}

export interface BoardingConfig extends BoardingModel {
  tick_s: number;
  jitter: number;
  flow_rate: number;
  straggler_threshold: number;
  straggler_rate: number;
  runner_chance: number;
  runner_count: [number, number];
  runner_delay_s: [number, number];
  /** Used when the profile has no door_open sound to time against. */
  start_delay_s: number;
  /** Used when the profile has no door_close sound to time against. */
  doil_off_delay_s: number;
  show_alighting: boolean;
  alighting: BoardingModel;
}

// ── Stats published to MQTT (spec §9): blind push, QoS 0, not retained ──

export interface StatsConfig {
  enabled: boolean;
  /** Topic template; placeholders {train} {trainId} {station} (sanitised: / + # → _). */
  topic: string;
  /** 'count' = plain integer (as the original panel sent); 'json' = full record. */
  payload: 'count' | 'json';
  /** 'boarding_start' = initial count when boarding starts (original behaviour); 'door_close' = final result. */
  publish_on: 'boarding_start' | 'door_close';
}

// ── Limit of Authority (spec §11) ──

/** One watched MQTT topic. A payload in `clear` (globs) is clear, in `caution` is clear-but-amber, anything else is stop. */
export interface LoaCondition {
  type: 'signal' | 'token' | 'condition';
  label: string;
  topic: string;
  clear: string[];
  caution?: string[];
  /** Must be clear (with every other granting element, at the same moment) for the section to be granted. Default: true. */
  grants?: boolean;
  /** Going back to not clear releases the authority (e.g. the staff returned). Default: true for tokens, false otherwise. */
  revokes?: boolean;
}

/** Picks which condition applies from another topic's value (e.g. a turnout choosing the departure signal). */
export interface LoaSelector {
  type: 'selector';
  label: string;
  topic: string;
  /** Payload value → the condition that applies. */
  options: Record<string, LoaCondition>;
  /** Option used until the selector topic has a value. */
  default: string;
}

export type LoaElement = LoaCondition | LoaSelector;

/** Directional section between two stations (matched by name, case-insensitive). */
export interface LoaSection {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Optional globs on train_id / train name: when non-empty, only matching trains get this section. */
  only: string[];
  /** Optional globs on train_id / train name: matching trains never get this section. */
  except: string[];
  elements: LoaElement[];
}

export interface LoaConfig {
  sections: LoaSection[];
}

/** Last known value of an LOA topic, from the server-side topic cache. */
export interface LoaValue {
  value: string;
  /** ISO time the server received it. */
  at: string;
}

export interface LayoutConfig {
  jmri: JmriConfig;
  guard: GuardConfig;
  /** Ordered: first matching profile wins. */
  train_profiles: TrainProfile[];
  boarding: BoardingConfig;
  stats: StatsConfig;
  events: EventsConfig;
  loa: LoaConfig;
}

// ─── Live sync WebSocket (/api/live/sync?id=) ──────────────────────────────────
// Server → client messages. Notices carry no timetable data; clients re-fetch.

export type SyncMessage =
  /** Sent once on connect: current rev of the subscribed timetable + active timetable id. */
  | { type: 'hello'; timetableId: string; rev: number; activeId: string | null }
  /** rev is present only when the mutation changed nothing but run status, so it can be adopted without a re-fetch. */
  | { type: 'completions'; timetableId: string; statuses: Record<string, 'running' | 'completed'>; rev?: number }
  /** Coalesced (~300 ms) after any mutation of the timetable. */
  | { type: 'timetable-updated'; timetableId: string; rev: number }
  | { type: 'timetable-deleted'; timetableId: string }
  | { type: 'active-changed'; activeId: string | null }
  /** LOA topic values from the server cache, sent to every client: full snapshot after hello, then coalesced deltas. */
  | { type: 'loa-values'; values: Record<string, LoaValue>; full: boolean }
  /**
   * Full request list of the timetable (docs/path-requests-spec.md §4.3): after hello and on every
   * request change. Like completions, rev is present only when the mutation changed nothing but
   * requests (no timetable-updated follows), so a client exactly one rev behind adopts it in place.
   * Accept / cancel-approve (which also create/delete a train) send it without rev.
   */
  | { type: 'path-requests'; timetableId: string; requests: PathRequest[]; rev?: number };

// ─── JMRI roster (fetched by the browser directly from JMRI) ───────────────────

export interface JmriFunctionKey {
  /** Function name as JMRI reports it, e.g. "F6". */
  name: string;
  label: string;
  lockable?: boolean;
}

export interface JmriRosterEntry {
  /** Roster entry name — this is what Train.train_id stores. */
  name: string;
  address: string;
  road?: string;
  number?: string;
  functionKeys: JmriFunctionKey[];
}

// ─── Path types ───────────────────────────────────────────────────────────────

export interface PathStop {
  id: string;
  path_id: string;
  station_id: string;
  sort_order: number;
  travel_time_from_prev: number; // minutes from previous stop's departure
  dwell_time: number;             // minutes between arrival and departure
}

export interface Path {
  id: string;
  timetable_id: string;
  name: string;
  stops: PathStop[];
}

// ─── API request shapes ──────────────────────────────────────────────────────────

/** Stop data sent to/from the API (camelCase stationId to match server expectations) */
export interface StopRequest {
  stationId: string;
  arrival: string | null;
  departure: string | null;
  specialInstructions?: string;
  locationAlias?: string;
  guardEvents?: GuardEventPlacement[];
}

export interface TrainRequest {
  id?: string;
  name: string;
  color: string;
  notes: string;
  trainId?: string;
  direction?: string;
  crewId?: string;
  stops: StopRequest[];
}

export interface PathStopRequest {
  stationId: string;
  travelTimeFromPrev: number;
  dwellTime: number;
}

export interface PathSaveRequest {
  id?: string;
  name: string;
  stops: PathStopRequest[];
}

// ─── Form / editor state ───────────────────────────────────────────────────────

export type ModalState =
  | { type: 'none' }
  | { type: 'newTimetable' }
  | { type: 'editTimetable'; timetable: TimetableSummary }
  | { type: 'newTrain' }
  | { type: 'editTrain'; train: Train }
  | { type: 'newPath' }
  | { type: 'editPath'; path: Path }
  | { type: 'stationReport'; stationId: string | null }
  | { type: 'layoutSettings' };
