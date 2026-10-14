// Publish payload for a fired guard event (spec §10.7). Pure.

import type { Station, Train } from '../types';
import { stopKeysOf, type RolledEvent } from './guardEvents';
import { sequenceStops } from './stops';

export interface EventPublishPayload {
  train: string;
  trainId: string;
  /** Station events: the stop's station name. */
  stop?: string;
  /** En-route events: "From → To" station names. */
  section?: string;
  /** Library id, or 'inline'. */
  event: string;
  message: string;
  /** Fast clock "H:MM", or null if unavailable. */
  clock: string | null;
  /** ISO timestamp. */
  at: string;
}

const clockText = (m: number | null): string | null => {
  if (m === null) return null;
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function eventPublishPayload(
  ev: RolledEvent,
  train: Train,
  stations: Station[],
  clockMin: number | null,
  nowMs: number,
): EventPublishPayload {
  const nameOf = (id: string) => stations.find((s) => s.id === id)?.name ?? id;
  const base = {
    train: train.name,
    trainId: train.train_id ?? '',
    event: ev.eventId ?? 'inline',
    message: ev.message,
    clock: clockText(clockMin),
    at: new Date(nowMs).toISOString(),
  };
  const from = ev.stopKey.slice(0, ev.stopKey.lastIndexOf('#'));
  if (ev.kind === 'enroute') {
    // The section runs from this stop to the next timed stop.
    const stop = train.stops[stopKeysOf(train).indexOf(ev.stopKey)];
    const seq = sequenceStops(train);
    const si = stop ? seq.findIndex((q) => q.stop.id === stop.id) : -1;
    const to = si >= 0 && si < seq.length - 1 ? seq[si + 1].stop.station_id : null;
    return { ...base, section: to ? `${nameOf(from)} → ${nameOf(to)}` : nameOf(from) };
  }
  return { ...base, stop: nameOf(from) };
}
