import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoaConfig, LoaValue, Station, Train } from '../types';
import {
  initialLoaState, parseLoaState, sectionsForTrain, stepLoa,
  type LoaTrainState, type SectionMatch, type SectionView,
} from '../lib/loa';

const storeKey = (ttId: string, trainId: string) => `guard:loa:${ttId}:${trainId}`;

function load(ttId: string, trainId: string): LoaTrainState | null {
  try {
    const raw = localStorage.getItem(storeKey(ttId, trainId));
    return raw ? parseLoaState(JSON.parse(raw), trainId) : null;
  } catch { return null; }
}
function save(ttId: string, s: LoaTrainState): void {
  try { localStorage.setItem(storeKey(ttId, s.trainId), JSON.stringify(s)); } catch { /* storage unavailable */ }
}

interface Args {
  timetableId: string | null;
  train: Train | null;
  stations: Station[];
  config: LoaConfig | null | undefined;
  /** Topic cache from useLiveTimetable().loaValues. */
  values: Record<string, LoaValue>;
}

export interface UseLoa {
  /** Sections on the train's route, in order (empty → no strip, no tab). */
  matches: SectionMatch[];
  sections: SectionView[];
  /** First section that isn't complete, or null. */
  current: SectionView | null;
  /** "Reset LOA for this train": forget grants and completions. */
  reset: () => void;
}

/**
 * Limit of Authority for the displayed train (spec §11.4): latch + complete
 * state kept in localStorage per timetable + train, re-stepped whenever the
 * train, config or topic values change. Nothing else (doors, clock) feeds it.
 */
export function useLoa({ timetableId, train, stations, config, values }: Args): UseLoa {
  const matches = useMemo(
    () => (train && config ? sectionsForTrain(train, stations, config) : []),
    [train, stations, config],
  );

  const trainId = train?.id ?? null;
  const key = timetableId && trainId ? storeKey(timetableId, trainId) : null;
  // The held state belongs to `key`; until the effect below adopts a new key, read storage directly.
  const [held, setHeld] = useState<{ key: string | null; state: LoaTrainState | null }>({ key: null, state: null });
  const state = useMemo(
    () => (held.key === key ? held.state : (timetableId && trainId ? load(timetableId, trainId) ?? initialLoaState(trainId) : null)),
    [held, key, timetableId, trainId],
  );

  const result = useMemo(
    () => (state ? stepLoa(state, matches, values) : null),
    [state, matches, values],
  );

  // Persist and hold whatever the step changed (stepLoa returns the same object when nothing did).
  useEffect(() => {
    if (!key || !timetableId || !result) return;
    if (held.key === key && held.state === result.state) return;
    if (held.key !== key || result.state !== state) save(timetableId, result.state);
    setHeld({ key, state: result.state });
  }, [key, timetableId, result, held, state]);

  const sections = useMemo(() => result?.sections ?? [], [result]);
  const current = useMemo(() => sections.find((s) => s.current) ?? null, [sections]);

  const live = useRef({ key, timetableId, state: result?.state ?? null });
  live.current = { key, timetableId, state: result?.state ?? null };

  const reset = useCallback(() => {
    const l = live.current;
    if (!l.key || !l.timetableId || !l.state) return;
    const fresh = initialLoaState(l.state.trainId);
    save(l.timetableId, fresh);
    setHeld({ key: l.key, state: fresh });
  }, []);

  return { matches, sections, current, reset };
}
