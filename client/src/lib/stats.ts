// Stats publishing helpers (spec §9). Pure: topic/payload building only.

import type { StatsConfig } from '../types';

export interface StatsRecord {
  train: string;
  trainId: string;
  station: string;
  boarded: number;
  leftBehind: number;
  runners: number;
  /** Clock at boarding, "H:MM". */
  clock: string;
  /** Real seconds from boarding start to the report. */
  dwellSeconds: number;
  /** ISO timestamp. */
  at: string;
}

export const sanitiseTopicPart = (s: string): string => s.replace(/[/+#]/g, '_');

export function statsTopic(
  template: string,
  v: { train: string; trainId: string; station: string },
): string {
  return template
    .replace(/\{train\}/g, () => sanitiseTopicPart(v.train))
    .replace(/\{trainId\}/g, () => sanitiseTopicPart(v.trainId))
    .replace(/\{station\}/g, () => sanitiseTopicPart(v.station));
}

export function statsPayload(kind: StatsConfig['payload'], r: StatsRecord): string {
  if (kind === 'count') return String(Math.max(0, Math.round(r.boarded)));
  return JSON.stringify({
    train: r.train,
    trainId: r.trainId,
    station: r.station,
    boarded: r.boarded,
    leftBehind: r.leftBehind,
    runners: r.runners,
    clock: r.clock,
    dwellSeconds: r.dwellSeconds,
    at: r.at,
  });
}

/** The message to publish for this trigger, or null (disabled, no topic, other trigger). */
export function statsMessage(
  cfg: StatsConfig,
  trigger: StatsConfig['publish_on'],
  r: StatsRecord,
): { topic: string; payload: string } | null {
  if (!cfg.enabled || !cfg.topic.trim() || cfg.publish_on !== trigger) return null;
  return {
    topic: statsTopic(cfg.topic.trim(), r),
    payload: statsPayload(cfg.payload, r),
  };
}
