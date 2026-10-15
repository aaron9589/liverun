// Derives the boarding context for the stop the doors opened at (spec §6.3, §8). Pure.

import type { Station, Train } from '../types';
import type { CountContext, StopPosition } from './boarding';
import { currentStop, type SeqStop } from './stops';

export interface BoardingContext {
  stopId: string;
  stationId: string;
  stationName: string;
  position: StopPosition;
  /** Fast clock if it is running, else the stop's scheduled time (minutes, 0-1439). */
  clockMinutes: number;
  /** Ready for sampleCount / alightingCount. */
  count: CountContext;
  trainName: string;
  trainId: string;
}

/** First sequenced stop is the origin, the last the terminus; a single stop counts as origin. */
export function stopPosition(index: number, length: number): StopPosition {
  if (index <= 0) return 'origin';
  return index >= length - 1 ? 'terminus' : 'intermediate';
}

const wrap = (m: number) => ((Math.round(m) % 1440) + 1440) % 1440;

/**
 * Context for a Doors Open now: the pinned stop wins, else the one the clock says (§6.3).
 * Returns null when no stop can be determined (no pin and no usable clock).
 */
export function buildBoardingContext(args: {
  train: Train;
  seq: SeqStop[];
  stations: Station[];
  clockMinutes: number | null;
  pinnedStopId: string | null;
}): BoardingContext | null {
  const { train, seq, stations, clockMinutes, pinnedStopId } = args;
  const { index } = currentStop(seq, clockMinutes, pinnedStopId);
  if (index < 0) return null;
  const s = seq[index];
  const station = stations.find((x) => x.id === s.stop.station_id);
  const position = stopPosition(index, seq.length);
  const clock = clockMinutes !== null ? wrap(clockMinutes) : wrap(s.dep);
  return {
    stopId: s.stop.id,
    stationId: s.stop.station_id,
    stationName: station?.name ?? s.stop.station_id,
    position,
    clockMinutes: clock,
    count: {
      clockMinutes: clock,
      direction: train.direction,
      trainId: train.train_id,
      trainName: train.name,
      stationWeight: station?.boarding_weight ?? 1,
      position,
    },
    trainName: train.name,
    trainId: train.train_id ?? '',
  };
}
