import { useEffect, useMemo, useState } from 'react';
import type { BoardingConfig, BoardingModel, BoardingRule } from '../../types';
import { demandAt, parseHHMM, type StopPosition } from '../../lib/boarding';
import { BOARDING_EXAMPLE, previewBoarding, validateBoardingConfig } from '../../lib/boardingSettings';
import { FIELD_CLS, type LayoutSectionProps } from './shared';

export function validateBoarding(draft: { boarding: BoardingConfig }): string | null {
  return validateBoardingConfig(draft.boarding);
}

const LABEL_CLS = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
const BTN_CLS = 'px-2.5 py-1 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700';

/** Number field that tolerates half-typed text; an unparseable value is reported as NaN so validation flags it. */
function Num({ value, onChange, label, className = 'w-20', step = 'any' }: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  className?: string;
  step?: string;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    if (Number(text) !== value && !(text === '' && Number.isNaN(value))) setText(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const bad = !Number.isFinite(value);
  return (
    <input
      type="number"
      step={step}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? NaN : Number(e.target.value));
      }}
      className={`${FIELD_CLS} ${className} ${bad ? 'border-red-700' : ''}`}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ── Demand curve ────────────────────────────────────────────────────────────

function DemandChart({ curve }: { curve: [string, number][] }) {
  const W = 560, H = 170, L = 34, R = 10, T = 10, B = 24;
  const valid = curve.filter(([t, v]) => parseHHMM(t) !== null && Number.isFinite(v));
  const top = Math.max(1, ...valid.map(([, v]) => v)) * 1.1;
  const x = (min: number) => L + (min / 1440) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  // Sample through demandAt so the line shows exactly what the engine uses (incl. the midnight wrap).
  const pts = Array.from({ length: 145 }, (_, i) => {
    const m = i * 10;
    return `${x(m).toFixed(1)},${y(demandAt(curve, Math.min(m, 1439.999)) || 0).toFixed(1)}`;
  }).join(' ');
  const yTicks = [0, 0.5, 1, 1.5, 2].filter((t) => t <= top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Demand curve over 24 hours" className="w-full max-w-xl rounded-lg bg-slate-950/60 border border-slate-800">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#334155" strokeWidth={t === 1 ? 1 : 0.5} strokeDasharray={t === 1 ? '3 3' : undefined} />
          <text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{t}</text>
        </g>
      ))}
      {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
        <g key={h}>
          <line x1={x(h * 60)} x2={x(h * 60)} y1={T} y2={H - B} stroke="#334155" strokeWidth={0.5} />
          <text x={x(h * 60)} y={H - B + 13} textAnchor="middle" fontSize="9" fill="#64748b">{String(h).padStart(2, '0')}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={1.75} strokeLinejoin="round" />
      {valid.map(([t, v], i) => (
        <circle key={i} cx={x(parseHHMM(t) ?? 0)} cy={y(v)} r={2.5} fill="#0ea5e9" stroke="#0f172a" strokeWidth={1} />
      ))}
    </svg>
  );
}

function CurveEditor({ curve, onChange }: { curve: [string, number][]; onChange: (c: [string, number][]) => void }) {
  const set = (i: number, p: [string, number]) => onChange(curve.map((q, j) => (j === i ? p : q)));
  return (
    <div className="space-y-2">
      <DemandChart curve={curve} />
      <p className="text-xs text-slate-500">Factor by fast-clock time, drawn straight between points; the last point joins the first across midnight. 1.0 = full load.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1.5">
        {curve.map(([t, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              aria-label={`Point ${i + 1} time`}
              value={t}
              onChange={(e) => set(i, [e.target.value, v])}
              placeholder="HH:MM"
              className={`${FIELD_CLS} w-[4.5rem] font-mono ${parseHHMM(t) === null ? 'border-red-700' : ''}`}
            />
            <Num label={`Point ${i + 1} factor`} value={v} onChange={(n) => set(i, [t, n])} className="w-16" step="0.05" />
            <button
              type="button"
              disabled={curve.length <= 1}
              onClick={() => onChange(curve.filter((_, j) => j !== i))}
              aria-label={`Remove point ${i + 1}`}
              title="Remove point"
              className="px-1.5 py-1 rounded-md text-xs text-slate-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={BTN_CLS} onClick={() => onChange([...curve, ['12:00', 1]])}>+ Add point</button>
    </div>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────

function RuleEditor({ rules, onChange }: { rules: BoardingRule[]; onChange: (r: BoardingRule[]) => void }) {
  const set = (i: number, r: BoardingRule) => onChange(rules.map((q, j) => (j === i ? r : q)));
  const setWhen = (i: number, key: keyof BoardingRule['when'], v: string) => {
    const when = { ...rules[i].when };
    if (v === '') delete when[key]; else when[key] = v;
    set(i, { ...rules[i], when });
  };
  const textCls = `${FIELD_CLS} w-28`;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 leading-relaxed">
        Every rule whose conditions all match multiplies the load by its factor; leave a condition blank to ignore it.
        Text conditions are case-insensitive globs (<code className="text-slate-400">*</code> any run of characters,{' '}
        <code className="text-slate-400">?</code> one character). A From/To window may cross midnight (22:00 to 04:00); From only
        means until end of day, To only means from the start of day.
      </p>
      {rules.length === 0 && <p className="text-xs text-slate-500 italic">No rules.</p>}
      {rules.map((r, i) => {
        const timeBad = (k: 'from' | 'to') => r.when[k] !== undefined && parseHHMM(r.when[k] as string) === null;
        return (
          <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 flex flex-wrap items-center gap-2">
            <input aria-label="Rule name" value={r.name} onChange={(e) => set(i, { ...r, name: e.target.value })} placeholder="Name" className={`${FIELD_CLS} w-40`} />
            <input aria-label="Direction" value={r.when.direction ?? ''} onChange={(e) => setWhen(i, 'direction', e.target.value)} placeholder="Direction" className={textCls} />
            <input aria-label="Train ID glob" value={r.when.train_id ?? ''} onChange={(e) => setWhen(i, 'train_id', e.target.value)} placeholder="Train ID glob" className={textCls} />
            <input aria-label="Train name glob" value={r.when.train_name ?? ''} onChange={(e) => setWhen(i, 'train_name', e.target.value)} placeholder="Train name glob" className={textCls} />
            <input aria-label="From" value={r.when.from ?? ''} onChange={(e) => setWhen(i, 'from', e.target.value)} placeholder="From HH:MM" className={`${FIELD_CLS} w-24 font-mono ${timeBad('from') ? 'border-red-700' : ''}`} />
            <input aria-label="To" value={r.when.to ?? ''} onChange={(e) => setWhen(i, 'to', e.target.value)} placeholder="To HH:MM" className={`${FIELD_CLS} w-24 font-mono ${timeBad('to') ? 'border-red-700' : ''}`} />
            <label className="inline-flex items-center gap-1 text-xs text-slate-400">
              ×<Num label="Rule factor" value={r.factor} onChange={(n) => set(i, { ...r, factor: n })} className="w-16" step="0.05" />
            </label>
            <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule" title="Remove rule" className="ml-auto px-1.5 py-1 rounded-md text-xs text-slate-400 hover:text-red-300 hover:bg-slate-800">✕</button>
          </div>
        );
      })}
      <button type="button" className={BTN_CLS} onClick={() => onChange([...rules, { name: '', when: {}, factor: 1 }])}>+ Add rule</button>
    </div>
  );
}

// ── Model editor (used for boarding and alighting) ──────────────────────────

function ModelEditor({ model, onChange }: { model: BoardingModel; onChange: (m: BoardingModel) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Field label="Max passengers" hint="Load at demand 1.0 (0-1000)">
          <Num label="Max passengers" value={model.max_passengers} onChange={(n) => onChange({ ...model, max_passengers: n })} step="1" />
        </Field>
        <Field label="Spread" hint="Extra randomness, fraction of expected (0-2)">
          <Num label="Spread" value={model.spread} onChange={(n) => onChange({ ...model, spread: n })} step="0.05" />
        </Field>
      </div>
      <Field label="Position factors" hint="Multiplier by the stop's place in the train's run. Terminus 0 means nobody boards at the last stop.">
        <div className="flex flex-wrap gap-4">
          {(['origin', 'intermediate', 'terminus'] as const).map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              {k}
              <Num label={`${k} factor`} value={model.position[k]} onChange={(n) => onChange({ ...model, position: { ...model.position, [k]: n } })} className="w-16" step="0.1" />
            </label>
          ))}
        </div>
      </Field>
      <Field label="Demand curve">
        <CurveEditor curve={model.demand_curve} onChange={(c) => onChange({ ...model, demand_curve: c })} />
      </Field>
      <Field label="Rules">
        <RuleEditor rules={model.rules} onChange={(r) => onChange({ ...model, rules: r })} />
      </Field>
    </div>
  );
}

// ── Advanced timing ─────────────────────────────────────────────────────────

function PairInput({ label, value, onChange, step }: { label: string; value: [number, number]; onChange: (v: [number, number]) => void; step?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Num label={`${label} min`} value={value[0]} onChange={(n) => onChange([n, value[1]])} className="w-16" step={step} />
      <span className="text-slate-500 text-xs">to</span>
      <Num label={`${label} max`} value={value[1]} onChange={(n) => onChange([value[0], n])} className="w-16" step={step} />
    </span>
  );
}

function AdvancedTiming({ b, onChange }: { b: BoardingConfig; onChange: (b: BoardingConfig) => void }) {
  const num = (k: keyof BoardingConfig, label: string, hint: string, step = 'any') => (
    <Field label={label} hint={hint}>
      <Num label={label} value={b[k] as number} onChange={(n) => onChange({ ...b, [k]: n })} step={step} />
    </Field>
  );
  return (
    <details className="rounded-lg border border-slate-800 p-3">
      <summary className="cursor-pointer text-sm text-slate-300 select-none">Advanced timing</summary>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-6 gap-y-4">
        {num('tick_s', 'Tick (s)', 'Seconds between counter updates, 0.1-10')}
        {num('jitter', 'Jitter', 'Random variation of each gap, 0-1')}
        {num('flow_rate', 'Flow rate', 'Average passengers per tick, 0.1-100')}
        {num('straggler_threshold', 'Straggler threshold', 'Flow slows once this many remain, 0-100', '1')}
        {num('straggler_rate', 'Straggler rate', 'Average passengers per tick while straggling, 0.1-100')}
        {num('runner_chance', 'Runner chance', 'Probability (0-1), scaled by demand, that late runners appear')}
        <Field label="Runner count" hint="Runners in a group, min to max">
          <PairInput label="Runner count" value={b.runner_count} onChange={(v) => onChange({ ...b, runner_count: v })} step="1" />
        </Field>
        <Field label="Runner delay (s)" hint="Seconds before runners arrive, min to max (0-60)">
          <PairInput label="Runner delay" value={b.runner_delay_s} onChange={(v) => onChange({ ...b, runner_delay_s: v })} />
        </Field>
        {num('start_delay_s', 'Start delay (s)', 'Used when the profile has no door-open sound, 0-60')}
        {num('doil_off_delay_s', 'DOIL-off delay (s)', 'Used when the profile has no door-close sound, 0-60')}
      </div>
    </details>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

function minutesToHHMM(m: number): string {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function Preview({ b, timetable }: { b: BoardingConfig; timetable: LayoutSectionProps['timetable'] }) {
  const trains = timetable?.trains ?? [];
  const [trainId, setTrainId] = useState('');
  const [stopIdx, setStopIdx] = useState(0);
  const [time, setTime] = useState('');
  const train = trains.find((t) => t.id === trainId) ?? trains[0];
  const stop = train?.stops[Math.min(stopIdx, (train?.stops.length ?? 1) - 1)];
  const station = timetable?.stations.find((s) => s.id === stop?.station_id);

  // Default the clock to the chosen stop's own time until the user types one.
  const stopTime = stop?.departure ?? stop?.arrival ?? '08:00';
  const clock = time || stopTime;
  const clockMin = parseHHMM(clock);

  const result = useMemo(() => {
    if (!train || !stop || clockMin === null || validateBoardingConfig(b)) return null;
    const position: StopPosition = train.stops[0] === stop ? 'origin' : train.stops[train.stops.length - 1] === stop ? 'terminus' : 'intermediate';
    const ctx = { clockMinutes: clockMin, direction: train.direction, trainId: train.train_id, trainName: train.name, stationWeight: station?.boarding_weight, position };
    return { position, boarding: previewBoarding(b, ctx), alighting: b.show_alighting ? previewBoarding(b.alighting, ctx) : null };
  }, [b, train, stop, station, clockMin]);

  if (!timetable || trains.length === 0) {
    return <p className="text-xs text-slate-500 italic">Open a timetable with trains to preview what would board.</p>;
  }
  const stationName = (id: string) => timetable.stations.find((s) => s.id === id)?.name ?? '?';
  const fmt = (p: { expected: number; low: number; high: number }) => (
    <>expected <span className="text-white font-medium">{p.expected.toFixed(1)}</span>, typical range <span className="text-white font-medium">{p.low}-{p.high}</span></>
  );
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Preview train" value={train?.id} onChange={(e) => { setTrainId(e.target.value); setStopIdx(0); setTime(''); }} className={`${FIELD_CLS} max-w-[14rem]`}>
          {trains.map((t) => <option key={t.id} value={t.id}>{t.name}{t.direction ? ` (${t.direction})` : ''}</option>)}
        </select>
        <select aria-label="Preview stop" value={stopIdx} onChange={(e) => { setStopIdx(Number(e.target.value)); setTime(''); }} className={`${FIELD_CLS} max-w-[14rem]`}>
          {train?.stops.map((s, i) => <option key={s.id} value={i}>{stationName(s.station_id)}</option>)}
        </select>
        <input aria-label="Preview time" value={clock} onChange={(e) => setTime(e.target.value)} placeholder="HH:MM" className={`${FIELD_CLS} w-20 font-mono ${clockMin === null ? 'border-red-700' : ''}`} />
        {time && <button type="button" className={BTN_CLS} onClick={() => setTime('')}>Use stop time ({minutesToHHMM(parseHHMM(stopTime) ?? 0)})</button>}
      </div>
      {clockMin === null && <p className="text-xs text-red-400">Time must be HH:MM</p>}
      {result ? (
        <div className="text-sm text-slate-300 space-y-1" data-testid="boarding-preview">
          <div>Boarding ({result.position}{station?.boarding_weight != null ? `, station weight ${station.boarding_weight}` : ''}): {fmt(result.boarding)}
            <span className="text-slate-500"> (10th-90th percentile of 500 samples, median {result.boarding.median})</span></div>
          {result.alighting && <div>Alighting: {fmt(result.alighting)}</div>}
          <div className="text-xs text-slate-400">
            Rules matched: {result.boarding.matched.length ? result.boarding.matched.map((r) => `${r.name || '(unnamed)'} ×${r.factor}`).join(', ') : 'none'}
          </div>
        </div>
      ) : clockMin !== null && <p className="text-xs text-slate-500 italic">Fix the settings errors to see a preview.</p>}
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export function BoardingSection({ draft, onChange, timetable }: LayoutSectionProps) {
  const b = draft.boarding;
  const set = (next: BoardingConfig) => onChange({ ...draft, boarding: next });
  const problem = validateBoarding(draft);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Boarding</h3>
        <p className="text-sm text-slate-400 mt-1">
          How many passengers board at each stop: <code className="text-slate-300">max × demand(clock) × rule factors × station weight × position</code>, plus randomness.
          Defaults are neutral (flat demand, no rules).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN_CLS}
          onClick={() => {
            if (window.confirm('Replace the demand curve, rules and position factors with the Illawarra example?')) {
              set({ ...b, ...structuredClone(BOARDING_EXAMPLE) });
            }
          }}
        >
          Load example (Illawarra)
        </button>
        <span className="text-xs text-slate-500">Example values from the design spec; replaces curve, rules and position factors. Not applied unless you save.</span>
      </div>

      {problem && <p className="text-xs text-red-400">{problem}</p>}

      <ModelEditor model={b} onChange={(m) => set({ ...b, ...m })} />

      <Field label="Preview">
        <Preview b={b} timetable={timetable} />
      </Field>

      <AdvancedTiming b={b} onChange={set} />

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={b.show_alighting} onChange={(e) => set({ ...b, show_alighting: e.target.checked })} className="accent-blue-500" />
          Show an alighting count before boarding
        </label>
        {b.show_alighting && (
          <div className="rounded-lg border border-slate-800 p-3 space-y-2">
            <p className="text-xs text-slate-500">Alighting uses the same model with its own values (for example, many get off at the city end in the morning).</p>
            <ModelEditor model={b.alighting} onChange={(m) => set({ ...b, alighting: m })} />
          </div>
        )}
      </div>
    </div>
  );
}
