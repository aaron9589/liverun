import type { Station } from '../types';
import type { SeqStop } from './stops';

/** Minutes (possibly past midnight) as HH:MM. */
export function fmtMins(m: number): string {
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * One-line job summary: "Kiama 14:20 → Bombo 15:02" from the first departure
 * to the last arrival of a running-order sequence. null when there are no timed stops.
 */
export function jobSummary(seq: SeqStop[], stations: Pick<Station, 'id' | 'name'>[]): string | null {
  if (seq.length === 0) return null;
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? '?';
  const first = seq[0];
  const last = seq[seq.length - 1];
  if (seq.length === 1) return `${name(first.stop.station_id)} ${fmtMins(first.arr)}`;
  return `${name(first.stop.station_id)} ${fmtMins(first.dep)} → ${name(last.stop.station_id)} ${fmtMins(last.arr)}`;
}
