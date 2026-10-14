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
}

export interface Crew {
  id: string;
  timetable_id: string;
  name: string;
  color: string;
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
  stops: TrainStop[];
}

export interface TimetableSettings {
  clock_enabled: boolean;
  clock_broker_url: string;
  clock_topic: string;
  auto_assign_min_break: number;
  graph_scale?: number | null;
}

export interface Timetable extends TimetableSummary {
  /** Bumped by the server on every mutation; used to detect missed live updates. */
  rev?: number;
  stations: Station[];
  trains: Train[];
  paths: Path[];
  crews: Crew[];
  settings: TimetableSettings;
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

export interface LayoutConfig {
  jmri: JmriConfig;
  guard: GuardConfig;
  /** Ordered: first matching profile wins. */
  train_profiles: TrainProfile[];
  boarding: BoardingConfig;
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
  | { type: 'active-changed'; activeId: string | null };

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

export interface PathRequest {
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
