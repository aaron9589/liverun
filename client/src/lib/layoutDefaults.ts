import type { BoardingModel, LayoutConfig } from '../types';

// Mirrors LAYOUT_DEFAULTS in server/db.js (neutral values only, spec D13).
// Used when GET /api/layout fails, so the UI still has a complete shape.

const NEUTRAL_BOARDING_MODEL: BoardingModel = {
  max_passengers: 60,
  demand_curve: [['00:00', 1], ['24:00', 1]],
  rules: [],
  position: { origin: 1, intermediate: 1, terminus: 0 },
  spread: 0.15,
};

export const DEFAULT_LAYOUT: LayoutConfig = {
  jmri: { url: '' },
  guard: { event_alert_sound: '' },
  train_profiles: [],
  boarding: {
    ...NEUTRAL_BOARDING_MODEL,
    tick_s: 1,
    jitter: 0.3,
    flow_rate: 3,
    straggler_threshold: 5,
    straggler_rate: 0.5,
    runner_chance: 0.2,
    runner_count: [1, 3],
    runner_delay_s: [2, 6],
    start_delay_s: 4,
    doil_off_delay_s: 8,
    show_alighting: false,
    alighting: { ...NEUTRAL_BOARDING_MODEL, position: { origin: 0, intermediate: 1, terminus: 1.5 } },
  },
  stats: { enabled: false, topic: '', payload: 'count', publish_on: 'door_close' },
  events: { library: [], publish_topic: '' },
};
