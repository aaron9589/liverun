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
}

export interface TrainStop {
  id: string;
  train_id: string;
  station_id: string;
  arrival: string | null;
  departure: string | null;
  special_instructions?: string;
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
  train_type?: string;
  train_id?: string;
  direction?: string;
  crew_id?: string;
  stops: TrainStop[];
}

export interface TimetableSettings {
  clock_enabled: boolean;
  clock_broker_url: string;
  clock_topic: string;
}

export interface Timetable extends TimetableSummary {
  stations: Station[];
  trains: Train[];
  paths: Path[];
  crews: Crew[];
  settings: TimetableSettings;
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
}

export interface TrainRequest {
  id?: string;
  name: string;
  color: string;
  notes: string;
  trainType?: string;
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
  | { type: 'stationReport'; stationId: string | null };
