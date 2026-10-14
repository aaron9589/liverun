import type { GuardEventDef, LayoutConfig } from '../../types';
import { countPlacementsFor, customActionNames, splitLines, validateEventsLibrary } from '../../lib/guardEventForm';
import { FIELD_CLS, SoundSelect, soundNameError, useSoundList, type LayoutSectionProps } from './shared';

export function validateGuardEvents(draft: LayoutConfig): string | null {
  return validateEventsLibrary(draft.events, soundNameError);
}

const LABEL_CLS = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function GuardEventsSection({ draft, onChange, timetable }: LayoutSectionProps) {
  const { sounds, error: soundError } = useSoundList();
  const ev = draft.events;
  const setEvents = (patch: Partial<typeof ev>) => onChange({ ...draft, events: { ...ev, ...patch } });
  const setDef = (i: number, patch: Partial<GuardEventDef>) =>
    setEvents({ library: ev.library.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const actions = customActionNames(draft.train_profiles);
  const problem = validateGuardEvents(draft);

  function add() {
    const id = uniqueId('new-event', new Set(ev.library.map((d) => d.id)));
    setEvents({ library: [...ev.library, { id, name: 'New event', kind: 'station', messages: [''], sound: '' }] });
  }

  function duplicate(i: number) {
    const d = ev.library[i];
    const id = uniqueId(`${d.id}-copy`, new Set(ev.library.map((x) => x.id)));
    const copy = { ...d, id, name: `${d.name} (copy)`, messages: [...d.messages] };
    setEvents({ library: [...ev.library.slice(0, i + 1), copy, ...ev.library.slice(i + 1)] });
  }

  function remove(i: number) {
    const d = ev.library[i];
    const used = timetable ? countPlacementsFor(timetable.trains, d.id) : 0;
    const msg = used > 0
      ? `"${d.name}" is placed ${used} time${used === 1 ? '' : 's'} in the open timetable (other timetables may use it too). The guard panel skips placements whose event no longer exists. Delete it?`
      : `Delete "${d.name}"? Placements in other timetables that use it will be skipped by the guard panel.`;
    if (!window.confirm(msg)) return;
    setEvents({ library: ev.library.filter((_, j) => j !== i) });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Guard events</h3>
        <p className="text-sm text-slate-400 mt-1">
          Reusable scripted events. Place them on train stops in the train editor; only the guard panel sees them.
        </p>
      </div>

      {problem && <p className="text-sm text-red-400">{problem}</p>}
      {soundError && <p className="text-xs text-amber-400">{soundError}</p>}

      <div className="space-y-3">
        {ev.library.map((d, i) => (
          <div key={i} className="rounded-lg border border-slate-800 p-3 space-y-2" data-testid="event-def">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={LABEL_CLS}>Id</label>
                <input aria-label="Event id" value={d.id} spellCheck={false}
                  onChange={(e) => setDef(i, { id: e.target.value })} className={`${FIELD_CLS} w-40 font-mono`} />
              </div>
              <div>
                <label className={LABEL_CLS}>Name</label>
                <input aria-label="Event name" value={d.name}
                  onChange={(e) => setDef(i, { name: e.target.value })} className={`${FIELD_CLS} w-48`} />
              </div>
              <div>
                <label className={LABEL_CLS}>Kind</label>
                <select aria-label="Event kind" value={d.kind}
                  onChange={(e) => setDef(i, { kind: e.target.value as GuardEventDef['kind'] })} className={FIELD_CLS}>
                  <option value="station">Station</option>
                  <option value="enroute">En route</option>
                </select>
              </div>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => duplicate(i)}
                  className="px-2 py-1 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700">Duplicate</button>
                <button type="button" onClick={() => remove(i)}
                  className="px-2 py-1 rounded-md text-xs text-red-400 border border-red-900/50 hover:bg-red-950/40">Delete</button>
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Messages (one per line; one is picked at random)</label>
              <textarea aria-label="Event messages" rows={3} value={d.messages.join('\n')}
                onChange={(e) => setDef(i, { messages: e.target.value.split('\n') })}
                onBlur={() => setDef(i, { messages: splitLines(d.messages.join('\n')).length ? splitLines(d.messages.join('\n')) : d.messages })}
                className={`${FIELD_CLS} w-full resize-y`} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={LABEL_CLS}>Alert sound</label>
                <SoundSelect label="Event sound" sounds={sounds} value={d.sound} onChange={(v) => setDef(i, { sound: v })} />
              </div>
              <div>
                <label className={LABEL_CLS}>Loco action (optional)</label>
                <input aria-label="Event action" list="guard-event-actions" value={d.action ?? ''} spellCheck={false}
                  placeholder="e.g. brake_squeal"
                  onChange={(e) => setDef(i, { action: e.target.value || undefined })} className={`${FIELD_CLS} w-44 font-mono`} />
              </div>
            </div>
          </div>
        ))}
        {ev.library.length === 0 && <p className="text-sm text-slate-500">No library events yet. Events can also be written inline on a stop.</p>}
        <datalist id="guard-event-actions">
          {actions.map((a) => <option key={a} value={a} />)}
        </datalist>
        <button type="button" onClick={add}
          className="px-3 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700">
          + Add event
        </button>
      </div>

      <div>
        <label className={LABEL_CLS} htmlFor="events-topic">Publish topic</label>
        <input id="events-topic" value={ev.publish_topic} spellCheck={false}
          onChange={(e) => setEvents({ publish_topic: e.target.value })}
          placeholder="(blank = off)" className={`${FIELD_CLS} w-full max-w-xl font-mono`} />
        <p className="text-xs text-slate-500 mt-1.5">
          Fired events are published here (blind push, no wildcards). Uses the active timetable's clock broker.
        </p>
      </div>
    </div>
  );
}
