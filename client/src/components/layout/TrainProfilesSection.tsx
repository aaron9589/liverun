import { useEffect, useRef, useState } from 'react';
import type { FunctionMode, JmriRosterEntry, ProfileFunction, Timetable, TrainProfile } from '../../types';
import { describeSkip, resolveAction, resolveProfile } from '../../lib/profiles';
import { useJmriRoster, type JmriRoster } from '../../hooks/useJmriRoster';
import { useJmriThrottle } from '../../hooks/useJmriThrottle';
import { useProfileActions } from '../../hooks/useProfileActions';
import { FIELD_CLS, SoundSelect, useSoundList, validateProfiles, type LayoutSectionProps } from './shared';
import type { SoundFile } from '../../api';

const BUILTIN_ACTIONS = ['door_open', 'door_close', 'bell'] as const;
const MODES: FunctionMode[] = ['on', 'off', 'toggle', 'pulse', 'hold', 'on_for'];
const CUSTOM = '__custom';

type Entry = [string, ProfileFunction];

function newId(): string {
  return `profile-${Math.random().toString(36).slice(2, 8)}`;
}

function blankProfile(): TrainProfile {
  return {
    id: newId(),
    name: 'New profile',
    match: [],
    sounds: { door_open: '', door_close: '', bell: '' },
    functions: {},
  };
}

function withDefaults(f: ProfileFunction, mode: FunctionMode): ProfileFunction {
  const base: ProfileFunction = { key: f.key, mode };
  if (mode === 'pulse') base.pulse_ms = f.pulse_ms ?? 600;
  if (mode === 'on_for') base.duration_s = f.duration_s ?? 10;
  return base;
}

function uniqueCustom(used: Set<string>): string {
  let n = 1;
  while (used.has(`custom_${n}`)) n++;
  return `custom_${n}`;
}

function NumberInput({ value, onChange, min, max, label, className = 'w-20' }: {
  value: number | undefined;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={value === undefined || !Number.isFinite(value) ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      className={`${FIELD_CLS} ${className}`}
    />
  );
}

// ── Test panel ──────────────────────────────────────────────────────────────

function FunctionTest({ url, profile, action, roster }: {
  url: string;
  profile: TrainProfile;
  action: string;
  roster: JmriRoster;
}) {
  const [loco, setLoco] = useState('');
  const [throttleName] = useState(() => `liverun-test-${Math.random().toString(36).slice(2, 8)}`);
  const throttle = useJmriThrottle(url || undefined, loco || null, throttleName);
  const entry: JmriRosterEntry | null = roster.entries.find((e) => e.name === loco) ?? null;
  const runner = useProfileActions(throttle, profile, entry);
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  useEffect(() => () => runnerRef.current.stopAll(), []);
  const [result, setResult] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const mode = profile.functions[action]?.mode;

  function fire() {
    if (!url) return setResult({ text: 'JMRI not configured', tone: 'warn' });
    if (!loco) return setResult({ text: 'Pick a loco first', tone: 'warn' });
    const r = runner.press(action);
    if (!r.resolved.ok) return setResult({ text: `Skipped: ${describeSkip(r.resolved.reason)}`, tone: 'warn' });
    if (r.sent) return setResult({ text: `Sent F${r.resolved.fn} (${r.resolved.spec.mode})`, tone: 'ok' });
    setResult({
      text: throttle.status !== 'connected' ? 'JMRI not connected' : 'Throttle not acquired yet',
      tone: 'warn',
    });
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
      <select value={loco} onChange={(e) => { setLoco(e.target.value); setResult(null); }} aria-label="Test loco" className={`${FIELD_CLS} max-w-[16rem]`}>
        <option value="">Pick a roster loco…</option>
        {roster.entries.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
      </select>
      <button
        type="button"
        onClick={mode === 'hold' ? undefined : fire}
        onPointerDown={mode === 'hold' ? fire : undefined}
        onPointerUp={mode === 'hold' ? () => runner.release(action) : undefined}
        onPointerLeave={mode === 'hold' ? () => runner.release(action) : undefined}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 select-none"
      >
        {mode === 'hold' ? 'Hold to send' : 'Send'}
      </button>
      <span className="text-xs text-slate-500">
        {url ? `JMRI: ${throttle.status}${loco ? (throttle.acquired ? ', throttle acquired' : '') : ''}` : 'JMRI not configured'}
      </span>
      {roster.status === 'error' && <span className="text-xs text-amber-400">roster unavailable</span>}
      {result && <span className={`text-xs ${result.tone === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`}>{result.text}</span>}
    </div>
  );
}

// ── Function row ────────────────────────────────────────────────────────────

function FunctionRow({ name, fn, usedElsewhere, onRename, onChange, onRemove, testSlot }: {
  name: string;
  fn: ProfileFunction;
  usedElsewhere: Set<string>;
  onRename: (next: string) => void;
  onChange: (next: ProfileFunction) => void;
  onRemove: () => void;
  testSlot: { open: boolean; toggle: () => void; panel: React.ReactNode };
}) {
  const builtin = (BUILTIN_ACTIONS as readonly string[]).includes(name);
  const isFn = 'fn' in fn.key;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Action"
          value={builtin ? name : CUSTOM}
          onChange={(e) => onRename(e.target.value === CUSTOM ? uniqueCustom(usedElsewhere) : e.target.value)}
          className={FIELD_CLS}
        >
          {BUILTIN_ACTIONS.map((a) => <option key={a} value={a} disabled={usedElsewhere.has(a)}>{a}</option>)}
          <option value={CUSTOM}>custom…</option>
        </select>
        {!builtin && (
          <input
            aria-label="Custom action name"
            value={name}
            onChange={(e) => { if (!usedElsewhere.has(e.target.value)) onRename(e.target.value); }}
            placeholder="brake_squeal"
            spellCheck={false}
            className={`${FIELD_CLS} w-36 font-mono ${/^[a-z0-9_]{1,40}$/.test(name) ? '' : 'border-red-700'}`}
          />
        )}
        <select
          aria-label="Key type"
          value={isFn ? 'fn' : 'label'}
          onChange={(e) => onChange({ ...fn, key: e.target.value === 'fn' ? { fn: 0 } : { label: '' } })}
          className={FIELD_CLS}
        >
          <option value="fn">F-number</option>
          <option value="label">Roster label</option>
        </select>
        {'fn' in fn.key ? (
          <NumberInput label="Function number" value={fn.key.fn} min={0} max={68} onChange={(n) => onChange({ ...fn, key: { fn: n } })} className="w-16" />
        ) : (
          <input
            aria-label="Roster label"
            value={fn.key.label}
            onChange={(e) => onChange({ ...fn, key: { label: e.target.value } })}
            placeholder="Door Open/Close"
            className={`${FIELD_CLS} w-40 ${fn.key.label.trim() ? '' : 'border-red-700'}`}
          />
        )}
        <select
          aria-label="Mode"
          value={fn.mode}
          onChange={(e) => onChange(withDefaults(fn, e.target.value as FunctionMode))}
          className={FIELD_CLS}
        >
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {fn.mode === 'pulse' && (
          <label className="inline-flex items-center gap-1 text-xs text-slate-400">
            <NumberInput label="Pulse ms" value={fn.pulse_ms} min={50} max={10000} onChange={(n) => onChange({ ...fn, pulse_ms: n })} />
            ms
          </label>
        )}
        {fn.mode === 'on_for' && (
          <label className="inline-flex items-center gap-1 text-xs text-slate-400">
            <NumberInput label="Duration seconds" value={fn.duration_s} min={1} max={300} onChange={(n) => onChange({ ...fn, duration_s: n })} />
            s
          </label>
        )}
        <button
          type="button"
          onClick={testSlot.toggle}
          className={`px-2 py-1 rounded-md text-xs border ${testSlot.open ? 'bg-blue-950/50 text-blue-300 border-blue-800' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
        >
          Test
        </button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-950/50">
          Remove
        </button>
      </div>
      {testSlot.open && testSlot.panel}
    </div>
  );
}

// ── Profile card ────────────────────────────────────────────────────────────

function ProfileCard({ profile, index, count, sounds, roster, jmriUrl, onChange, onMove, onDuplicate, onDelete }: {
  profile: TrainProfile;
  index: number;
  count: number;
  sounds: SoundFile[] | null;
  roster: JmriRoster;
  jmriUrl: string;
  onChange: (p: TrainProfile) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const entries: Entry[] = Object.entries(profile.functions);
  const setEntries = (next: Entry[]) => onChange({ ...profile, functions: Object.fromEntries(next) });
  const fallback = profile.match.every((m) => m.trim() === '');

  function addFunction() {
    const used = new Set(entries.map(([n]) => n));
    const name = BUILTIN_ACTIONS.find((a) => !used.has(a)) ?? uniqueCustom(used);
    setEntries([...entries, [name, { key: { fn: 0 }, mode: 'on' }]]);
  }

  const btn = 'px-2 py-1 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-4" aria-label={`Profile ${profile.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 w-5">{index + 1}.</span>
        <input
          aria-label="Profile name"
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
          className={`${FIELD_CLS} flex-1 min-w-[10rem] font-medium ${profile.name.trim() ? '' : 'border-red-700'}`}
        />
        {fallback && <span className="text-xs rounded-full px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700">fallback</span>}
        <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button type="button" className={btn} onClick={onDuplicate}>Duplicate</button>
        <button
          type="button"
          className="px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-950/50"
          onClick={() => { if (window.confirm(`Delete profile "${profile.name}"?`)) onDelete(); }}
        >
          Delete
        </button>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Train ID patterns</div>
        <div className="space-y-1.5">
          {profile.match.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Pattern ${i + 1}`}
                value={m}
                onChange={(e) => onChange({ ...profile, match: profile.match.map((x, j) => (j === i ? e.target.value : x)) })}
                placeholder="CityRail ?T-*"
                spellCheck={false}
                className={`${FIELD_CLS} flex-1 font-mono`}
              />
              <button type="button" className="px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-950/50" aria-label={`Remove pattern ${i + 1}`}
                onClick={() => onChange({ ...profile, match: profile.match.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => onChange({ ...profile, match: [...profile.match, ''] })}>+ Add pattern</button>
        </div>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Case-insensitive globs on the train ID: <span className="font-mono">*</span> matches any run of characters,{' '}
          <span className="font-mono">?</span> exactly one. A profile with no patterns is the fallback for trains no other profile matches.
        </p>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Tablet sounds</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {BUILTIN_ACTIONS.map((k) => (
            <label key={k} className="inline-flex items-center gap-2 text-sm text-slate-300">
              <span className="font-mono text-xs w-20">{k}</span>
              <SoundSelect
                label={`${k} sound`}
                sounds={sounds}
                value={profile.sounds[k]}
                onChange={(v) => onChange({ ...profile, sounds: { ...profile.sounds, [k]: v } })}
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Decoder functions</div>
        <div className="space-y-2">
          {entries.map(([name, fn], i) => (
            <FunctionRow
              key={i}
              name={name}
              fn={fn}
              usedElsewhere={new Set(entries.filter((_, j) => j !== i).map(([n]) => n))}
              onRename={(next) => setEntries(entries.map((e, j): Entry => (j === i ? [next, e[1]] : e)))}
              onChange={(next) => setEntries(entries.map((e, j): Entry => (j === i ? [e[0], next] : e)))}
              onRemove={() => { setEntries(entries.filter((_, j) => j !== i)); setTesting(null); }}
              testSlot={{
                open: testing === name,
                toggle: () => setTesting(testing === name ? null : name),
                panel: <FunctionTest url={jmriUrl} profile={profile} action={name} roster={roster} />,
              }}
            />
          ))}
          {entries.length === 0 && <p className="text-xs text-slate-500">No functions: nothing is sent to the decoder.</p>}
          <button type="button" className={btn} onClick={addFunction}>+ Add function</button>
        </div>
      </div>
    </section>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

function Preview({ profiles, timetable, roster }: { profiles: TrainProfile[]; timetable: Timetable | null | undefined; roster: JmriRoster }) {
  if (!timetable) {
    return <p className="text-sm text-slate-500">Open a timetable to preview how its trains resolve.</p>;
  }
  const actions = [...BUILTIN_ACTIONS as readonly string[]];
  for (const p of profiles) for (const a of Object.keys(p.functions)) if (!actions.includes(a)) actions.push(a);
  const rows = timetable.trains.map((t) => {
    const trainId = (t.train_id ?? '').trim();
    const profile = resolveProfile(profiles, trainId);
    const entry = roster.entries.find((e) => e.name === trainId) ?? null;
    return { train: t, trainId, profile, entry };
  });
  const unmatched = [...new Set(rows.filter((r) => r.trainId && !r.profile).map((r) => r.trainId))];
  const noId = rows.filter((r) => !r.trainId).length;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 bg-slate-900">
              <th className="px-2 py-1.5">Train</th>
              <th className="px-2 py-1.5">Train ID</th>
              <th className="px-2 py-1.5">Profile</th>
              {actions.map((a) => <th key={a} className="px-2 py-1.5 font-mono">{a}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map(({ train, trainId, profile, entry }) => (
              <tr key={train.id}>
                <td className="px-2 py-1 text-white">{train.name}</td>
                <td className="px-2 py-1 text-slate-300 font-mono">{trainId || <span className="text-slate-600">none</span>}</td>
                <td className="px-2 py-1 text-slate-300">{profile ? profile.name : <span className="text-amber-400">no profile</span>}</td>
                {actions.map((a) => {
                  if (!profile) return <td key={a} className="px-2 py-1 text-slate-600">–</td>;
                  const r = resolveAction(profile, a, entry);
                  if (r.ok) return <td key={a} className="px-2 py-1 text-emerald-400 font-mono">F{r.fn} {r.spec.mode}</td>;
                  if (r.reason === 'unmapped') return <td key={a} className="px-2 py-1 text-slate-600">–</td>;
                  return <td key={a} className="px-2 py-1 text-amber-400">{describeSkip(r.reason)}</td>;
                })}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3 + actions.length} className="px-2 py-2 text-slate-500">This timetable has no trains.</td></tr>}
          </tbody>
        </table>
      </div>
      {roster.status !== 'ready' && (
        <p className="text-xs text-slate-500">
          JMRI roster {roster.status === 'loading' ? 'is loading' : 'is unavailable'}, so roster-label keys cannot be resolved to F-numbers.
        </p>
      )}
      {unmatched.length > 0 && (
        <p className="text-xs text-amber-400">Train IDs matching no profile: {unmatched.join(', ')}</p>
      )}
      {noId > 0 && <p className="text-xs text-slate-500">{noId} train{noId === 1 ? ' has' : 's have'} no train ID.</p>}
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export function TrainProfilesSection({ draft, onChange, timetable }: LayoutSectionProps) {
  const { sounds, error } = useSoundList();
  const roster = useJmriRoster(draft.jmri.url);
  const profiles = draft.train_profiles;
  const problem = validateProfiles(draft);

  const set = (next: TrainProfile[]) => onChange({ ...draft, train_profiles: next });
  const move = (i: number, d: -1 | 1) => {
    const next = [...profiles];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Train profiles</h3>
        <p className="text-sm text-slate-400 mt-1">
          A profile chooses the tablet sounds and decoder functions for every train whose ID matches it.
          Profiles are checked top to bottom and the first match wins, so put one-off locos above general patterns.
        </p>
      </div>

      {problem && <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-300">{problem}</div>}
      {error && <p className="text-xs text-amber-400">{error}</p>}

      <div className="space-y-4">
        {profiles.map((p, i) => (
          <ProfileCard
            key={p.id}
            profile={p}
            index={i}
            count={profiles.length}
            sounds={sounds}
            roster={roster}
            jmriUrl={draft.jmri.url}
            onChange={(np) => set(profiles.map((x, j) => (j === i ? np : x)))}
            onMove={(d) => move(i, d)}
            onDuplicate={() => {
              const copy: TrainProfile = { ...structuredClone(p), id: newId(), name: `${p.name} copy` };
              set([...profiles.slice(0, i + 1), copy, ...profiles.slice(i + 1)]);
            }}
            onDelete={() => set(profiles.filter((_, j) => j !== i))}
          />
        ))}
        {profiles.length === 0 && <p className="text-sm text-slate-500">No profiles yet. Without one, no sounds play and no functions are sent.</p>}
        <button
          type="button"
          onClick={() => set([...profiles, blankProfile()])}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
        >
          + Add profile
        </button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">
          Preview{timetable ? ` — ${timetable.name}` : ''}
        </h4>
        <Preview profiles={profiles} timetable={timetable} roster={roster} />
      </div>
    </div>
  );
}
