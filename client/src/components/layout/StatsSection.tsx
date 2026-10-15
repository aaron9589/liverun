import type { StatsConfig } from '../../types';
import { resolveTopic, TOPIC_PLACEHOLDERS, validateStatsConfig } from '../../lib/boardingSettings';
import { FIELD_CLS, type LayoutSectionProps } from './shared';

export function validateStats(draft: { stats: StatsConfig }): string | null {
  return validateStatsConfig(draft.stats);
}

const LABEL_CLS = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

export function StatsSection({ draft, onChange, timetable }: LayoutSectionProps) {
  const s = draft.stats;
  const set = (patch: Partial<StatsConfig>) => onChange({ ...draft, stats: { ...s, ...patch } });
  const problem = validateStats(draft);
  const sample = timetable?.trains[0];
  const sampleStation = timetable?.stations.find((st) => st.id === sample?.stops[0]?.station_id);
  const example = resolveTopic(s.topic, {
    train: sample?.name ?? 'SL21',
    trainId: sample?.train_id ?? '2171',
    station: sampleStation?.name ?? 'Berry',
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Stats publishing</h3>
        <p className="text-sm text-slate-400 mt-1">
          Publishes each stop's passenger numbers over MQTT from the guard panel. Off by default.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-blue-500" />
        Publish passenger stats
      </label>

      <div>
        <label className={LABEL_CLS} htmlFor="stats-topic">Topic template</label>
        <input
          id="stats-topic"
          value={s.topic}
          onChange={(e) => set({ topic: e.target.value })}
          placeholder="trains/stats/passengersMoved/{train}"
          spellCheck={false}
          className={`${FIELD_CLS} w-full max-w-xl font-mono ${problem ? 'border-red-700' : ''}`}
        />
        {problem && <p className="text-xs text-red-400 mt-1">{problem}</p>}
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Placeholders: {TOPIC_PLACEHOLDERS.map((p) => <code key={p} className="text-slate-400 mr-1.5">{`{${p}}`}</code>)}
          Values have <code className="text-slate-400">/ + #</code> replaced with <code className="text-slate-400">_</code>. Wildcards are not allowed in the template.
        </p>
        <p className="text-xs text-slate-400 mt-1.5">
          Example: <code className="text-sky-300" data-testid="stats-topic-example">{s.topic.trim() ? example : '(no topic set)'}</code>
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <label className={LABEL_CLS} htmlFor="stats-payload">Payload</label>
          <select id="stats-payload" value={s.payload} onChange={(e) => set({ payload: e.target.value as StatsConfig['payload'] })} className={FIELD_CLS}>
            <option value="count">count (plain integer)</option>
            <option value="json">json (full record)</option>
          </select>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">JSON: train, trainId, station, boarded, leftBehind, runners, clock, dwellSeconds, at.</p>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="stats-publish-on">Publish on</label>
          <select id="stats-publish-on" value={s.publish_on} onChange={(e) => set({ publish_on: e.target.value as StatsConfig['publish_on'] })} className={FIELD_CLS}>
            <option value="door_close">Door close (final result)</option>
            <option value="boarding_start">Boarding start (initial count)</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed rounded-lg border border-slate-800 p-3">
        Publishes to the active timetable's clock broker (set in the timetable's clock settings). It is a blind push from the browser:
        QoS 0, not retained, no acknowledgement. If the broker is briefly unreachable, up to 50 messages are queued for the page session only.
      </p>
    </div>
  );
}
