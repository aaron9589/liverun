import { useMemo, useState } from 'react';
import type { Crew, PathRequestSubmit, PathWorkKind, Station } from '../../types';
import { useLayout } from '../../hooks/useLayout';
import { useJmriRoster } from '../../hooks/useJmriRoster';
import { RosterCombobox } from '../RosterCombobox';
import { fmtMins } from '../../lib/crewJobs';
import {
  MAX_MINUTES, MAX_NOTES, MAX_STOP_NOTE, MAX_VIA, apiErrorText, buildSubmit, canSubmit, emptyPlace,
  type Place, type RequestDraft, type ViaDraft,
} from '../../lib/pathRequests';

interface Props {
  crew: Crew;
  stations: Station[];
  /** Fast clock minutes when running, else null. */
  clock: number | null;
  /** Prefilled From (crew's current/last job) and Loco. */
  initialFrom: Place | null;
  initialLoco: string;
  onSubmit: (body: PathRequestSubmit) => Promise<void>;
  onClose: () => void;
}

const FIELD = 'w-full min-h-[48px] rounded-lg bg-slate-800 border border-slate-600 px-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500';
const LABEL = 'text-sm font-medium text-slate-300';
const SMALL_BTN = 'min-w-[48px] min-h-[48px] rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-lg';

const KINDS: { kind: PathWorkKind; label: string }[] = [
  { kind: 'stop', label: 'Stop' },
  { kind: 'shunt', label: 'Shunt' },
  { kind: 'work', label: 'Work' },
];

let viaSeq = 0;

/** Station picker plus a siding box where the station allows one (alias_enabled). */
function PlaceField({ label, value, stations, onChange }: {
  label: string; value: Place; stations: Station[]; onChange: (p: Place) => void;
}) {
  const station = stations.find((s) => s.id === value.stationId);
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <select
        value={value.stationId}
        aria-label={label}
        onChange={(e) => onChange({ stationId: e.target.value, alias: '' })}
        className={FIELD}
      >
        <option value="">Choose a station…</option>
        {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {station?.alias_enabled && (
        <input
          value={value.alias}
          maxLength={60}
          onChange={(e) => onChange({ ...value, alias: e.target.value })}
          placeholder="Siding / road (optional)"
          aria-label={`${label} siding`}
          className={FIELD}
        />
      )}
    </div>
  );
}

/** Full-screen sheet to request a path (spec §3.3). Stays open on error. */
export function RequestForm({ crew, stations, clock, initialFrom, initialLoco, onSubmit, onClose }: Props) {
  const layout = useLayout();
  const roster = useJmriRoster(layout.jmri?.url);
  const [draft, setDraft] = useState<RequestDraft>(() => ({
    crewId: crew.id,
    loco: initialLoco,
    from: initialFrom ?? emptyPlace(),
    via: [],
    to: emptyPlace(),
    asap: true,
    readyAt: '',
    notes: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => [...stations].sort((a, b) => a.sort_order - b.sort_order), [stations]);
  const check = canSubmit(draft);
  const set = (patch: Partial<RequestDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setVia = (key: string, patch: Partial<ViaDraft>) =>
    setDraft((d) => ({ ...d, via: d.via.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    const via = [...d.via];
    [via[i], via[i + dir]] = [via[i + dir], via[i]];
    return { ...d, via };
  });
  const addVia = () => setDraft((d) => ({
    ...d,
    via: [...d.via, { key: `v${++viaSeq}`, ...emptyPlace(), kind: 'stop', minutes: 0, note: '' }],
  }));

  async function submit() {
    if (!check.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(buildSubmit(draft));
    } catch (e) {
      setError(apiErrorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100" role="dialog" aria-modal="true" aria-label="Request a path">
      <header className="flex items-center gap-3 px-3 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
        <h2 className="text-lg font-semibold flex-1">Request a path</h2>
        <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] rounded-lg bg-slate-800 hover:bg-slate-700 text-xl">✕</button>
      </header>

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-md mx-auto flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Crew</span>
            <div className="min-h-[48px] flex items-center gap-2 px-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: crew.color }} />
              {crew.name}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className={LABEL}>Loco (optional)</span>
            <RosterCombobox value={draft.loco} onChange={(loco) => set({ loco })} roster={roster} placeholder="Roster name or number" />
          </div>

          <PlaceField label="From (where you are now)" value={draft.from} stations={ordered} onChange={(from) => set({ from })} />

          {draft.via.map((v, i) => (
            <fieldset key={v.key} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <legend className="px-1 text-xs text-slate-400">Stop {i + 1}</legend>
              <PlaceField
                label="Station"
                value={v}
                stations={ordered}
                onChange={(p) => setVia(v.key, { stationId: p.stationId, alias: p.alias })}
              />
              <div className="grid grid-cols-3 rounded-lg overflow-hidden border border-slate-600" role="group" aria-label="Kind of stop">
                {KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={v.kind === kind}
                    onClick={() => setVia(v.key, { kind })}
                    className={`min-h-[48px] ${v.kind === kind ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                  >{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className={`${LABEL} flex-1`}>Minutes on site</span>
                <button type="button" aria-label="Fewer minutes" className={SMALL_BTN} disabled={v.minutes <= 0}
                  onClick={() => setVia(v.key, { minutes: Math.max(0, Math.ceil(v.minutes / 5) * 5 - 5) })}>−</button>
                <input
                  type="number" inputMode="numeric" min={0} max={MAX_MINUTES} step={5}
                  value={v.minutes}
                  aria-label="Minutes on site"
                  onChange={(e) => setVia(v.key, { minutes: Math.min(MAX_MINUTES, Math.max(0, Math.round(Number(e.target.value)) || 0)) })}
                  className="w-20 min-h-[48px] rounded-lg bg-slate-800 border border-slate-600 text-center text-base text-white focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button type="button" aria-label="More minutes" className={SMALL_BTN} disabled={v.minutes >= MAX_MINUTES}
                  onClick={() => setVia(v.key, { minutes: Math.min(MAX_MINUTES, Math.floor(v.minutes / 5) * 5 + 5) })}>+</button>
              </div>
              <input
                value={v.note}
                maxLength={MAX_STOP_NOTE}
                onChange={(e) => setVia(v.key, { note: e.target.value })}
                placeholder="Note, e.g. drop 2 wagons (optional)"
                aria-label="Note for this stop"
                className={FIELD}
              />
              <div className="flex gap-2">
                <button type="button" aria-label="Move up" className={SMALL_BTN} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="Move down" className={SMALL_BTN} disabled={i === draft.via.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" aria-label="Remove stop" className={`${SMALL_BTN} ml-auto text-red-300`}
                  onClick={() => setDraft((d) => ({ ...d, via: d.via.filter((x) => x.key !== v.key) }))}>✕</button>
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            onClick={addVia}
            disabled={draft.via.length >= MAX_VIA}
            className="min-h-[48px] rounded-lg border border-dashed border-slate-600 text-slate-300 hover:bg-slate-900 disabled:opacity-40"
          >+ Add stop</button>

          <PlaceField label="To (where you want to go)" value={draft.to} stations={ordered} onChange={(to) => set({ to })} />

          <div className="flex flex-col gap-2">
            <span className={LABEL}>Ready at</span>
            <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-slate-600" role="group" aria-label="Ready at">
              <button type="button" aria-pressed={draft.asap} onClick={() => set({ asap: true })}
                className={`min-h-[48px] px-2 ${draft.asap ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>As soon as possible</button>
              <button type="button" aria-pressed={!draft.asap}
                onClick={() => set({ asap: false, readyAt: draft.readyAt || (clock !== null ? fmtMins(clock) : '') })}
                className={`min-h-[48px] px-2 ${!draft.asap ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>At a time</button>
            </div>
            {!draft.asap && (
              <input
                type="time"
                value={draft.readyAt}
                aria-label="Ready at time"
                onChange={(e) => set({ readyAt: e.target.value })}
                className={FIELD}
              />
            )}
            {clock !== null && <p className="text-xs text-slate-500">Fast clock is {fmtMins(clock)}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <span className={LABEL}>Notes for Control</span>
            <textarea
              value={draft.notes}
              maxLength={MAX_NOTES}
              rows={3}
              onChange={(e) => set({ notes: e.target.value })}
              aria-label="Notes for Control"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-slate-500 text-right">{draft.notes.length}/{MAX_NOTES}</span>
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-3">
        <div className="max-w-md mx-auto flex flex-col gap-2">
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {!check.ok && <p className="text-sm text-amber-300/90">{check.reason}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!check.ok || busy}
            className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-lg font-semibold"
          >{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </footer>
    </div>
  );
}
