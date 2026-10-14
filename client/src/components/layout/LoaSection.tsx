import { useEffect, useMemo, useState } from 'react';
import type { LayoutConfig, LoaCondition, LoaConfig, LoaElement, LoaSection as LoaSectionDef, LoaSelector, LoaValue } from '../../types';
import { api } from '../../api';
import { conditionState, evaluateElement, sectionsForTrain, type ElementState } from '../../lib/loa';
import { FIELD_CLS, type LayoutSectionProps } from './shared';

// ── Validation (mirrors server/loa.js; the server is authoritative) ─────────

const MAX_SECTIONS = 200;
const MAX_ELEMENTS = 50;
const MAX_OPTIONS = 20;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const nonBlank = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

function conditionError(c: unknown, at: string): string | null {
  if (!isObj(c)) return `${at} must be an object`;
  if (c.type !== 'signal' && c.type !== 'token' && c.type !== 'condition') return `${at}: type must be signal, token or condition`;
  if (!nonBlank(c.label)) return `${at}: label is required`;
  if (!nonBlank(c.topic, 300)) return `${at}: topic is required`;
  if (/[+#]/.test(c.topic)) return `${at}: topic must not contain MQTT wildcards (+ or #)`;
  if (!strList(c.clear) || !c.clear.some((s) => s.trim() !== '')) return `${at}: needs at least one clear value`;
  if (c.caution !== undefined && !strList(c.caution)) return `${at}: caution must be a list of strings`;
  if (c.grants !== undefined && typeof c.grants !== 'boolean') return `${at}: grants must be true or false`;
  if (c.revokes !== undefined && typeof c.revokes !== 'boolean') return `${at}: revokes must be true or false`;
  return null;
}

function elementError(el: unknown, at: string): string | null {
  if (!isObj(el)) return `${at} must be an object`;
  if (el.type !== 'selector') return conditionError(el, at);
  if (!nonBlank(el.label)) return `${at}: label is required`;
  if (!nonBlank(el.topic, 300)) return `${at}: topic is required`;
  if (/[+#]/.test(el.topic)) return `${at}: topic must not contain MQTT wildcards (+ or #)`;
  if (!isObj(el.options)) return `${at}: options must be an object`;
  const keys = Object.keys(el.options);
  if (keys.length === 0) return `${at}: needs at least one option`;
  if (keys.length > MAX_OPTIONS) return `${at}: at most ${MAX_OPTIONS} options`;
  for (const k of keys) {
    if (k.trim() === '') return `${at}: option keys must not be blank`;
    const o = el.options[k];
    if (isObj(o) && o.type === 'selector') return `${at}: option "${k}" must be a condition, not a selector`;
    const e = conditionError(o, `${at} option "${k}"`);
    if (e) return e;
  }
  if (typeof el.default !== 'string' || !keys.includes(el.default)) return `${at}: default must be one of the options`;
  return null;
}

/** Error message for a loa config (any shape), or null. */
export function loaError(loa: unknown): string | null {
  if (!isObj(loa)) return 'LOA config must be an object';
  if (loa.warn_on_depart !== undefined && typeof loa.warn_on_depart !== 'boolean') return 'warn_on_depart must be true or false';
  if (!Array.isArray(loa.sections)) return 'sections must be an array';
  if (loa.sections.length > MAX_SECTIONS) return `At most ${MAX_SECTIONS} sections`;
  const ids = new Set<string>();
  for (const [i, s] of loa.sections.entries()) {
    const at = isObj(s) && nonBlank(s.name) ? `Section "${s.name}"` : `Section ${i + 1}`;
    if (!isObj(s)) return `${at} must be an object`;
    if (!nonBlank(s.id) || ids.has(s.id)) return `${at}: id must be unique`;
    ids.add(s.id);
    if (!nonBlank(s.name)) return `${at}: name is required`;
    if (!nonBlank(s.from) || !nonBlank(s.to)) return `${at}: from and to stations are required`;
    if (s.from.trim().toLowerCase() === s.to.trim().toLowerCase()) return `${at}: from and to must differ`;
    if (!strList(s.only) || !strList(s.except)) return `${at}: only/except must be lists of strings`;
    if (!Array.isArray(s.elements)) return `${at}: elements must be an array`;
    if (s.elements.length > MAX_ELEMENTS) return `${at}: at most ${MAX_ELEMENTS} elements`;
    for (const [j, el] of s.elements.entries()) {
      const e = elementError(el, `${at}, element ${j + 1}`);
      if (e) return e;
    }
  }
  return null;
}

export function validateLoa(draft: LayoutConfig): string | null {
  return loaError(draft.loa);
}

// ── Small helpers ───────────────────────────────────────────────────────────

const LABEL_CLS = 'block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1';
const BTN_CLS = 'px-2 py-1 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed';

const DOT_CLS: Record<ElementState, string> = {
  clear: 'bg-green-500 text-green-950',
  caution: 'bg-amber-400 text-amber-950',
  stop: 'bg-red-500 text-red-950',
  unknown: 'bg-slate-600 text-slate-200',
};
const DOT_LABEL: Record<ElementState, string> = { clear: 'Clear', caution: 'Caution', stop: 'Not clear', unknown: 'No value yet' };

function Dot({ state }: { state: ElementState }) {
  return (
    <span title={DOT_LABEL[state]} aria-label={DOT_LABEL[state]} data-state={state}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${DOT_CLS[state]}`}>
      {state === 'unknown' ? '?' : ''}
    </span>
  );
}

function newId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'section';
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Polls the server topic cache while mounted. Errors (e.g. endpoint not available) are ignored. */
function useLoaValues(): Record<string, LoaValue> {
  const [values, setValues] = useState<Record<string, LoaValue>>({});
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      api.getLoaValues().then((v) => { if (alive && v && typeof v === 'object') setValues(v); }).catch(() => { /* quiet */ });
    };
    tick();
    const t = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return values;
}

/** Text area holding a list; keeps the raw text so typing separators isn't fought by re-parsing. */
function ListInput({ value, onChange, separator, rows = 1, label, placeholder }: {
  value: string[];
  onChange: (v: string[]) => void;
  separator: '\n' | ', ';
  rows?: number;
  label: string;
  placeholder?: string;
}) {
  const parse = (t: string) => t.split(separator === '\n' ? /\n/ : /[,\n]/).map((s) => s.trim()).filter(Boolean);
  const [text, setText] = useState(value.join(separator));
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(value.join(separator));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <textarea aria-label={label} rows={rows} value={text} placeholder={placeholder} spellCheck={false}
      onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }}
      className={`${FIELD_CLS} w-full font-mono text-xs resize-y`} />
  );
}

function LiveValue({ topic, values }: { topic: string; values: Record<string, LoaValue> }) {
  const v = topic ? values[topic] : undefined;
  return (
    <span className="text-xs font-mono text-slate-400 truncate max-w-[16rem]" title={v ? `${v.value} (${v.at})` : 'No value received'}>
      {v ? v.value : '—'}
    </span>
  );
}

// ── Condition row (signal / token / condition) ──────────────────────────────

function ConditionFields({ cond, values, onChange, fixedType }: {
  cond: LoaCondition;
  values: Record<string, LoaValue>;
  onChange: (c: LoaCondition) => void;
  /** Hide the type dropdown (selector options keep their own). */
  fixedType?: boolean;
}) {
  const live = cond.topic ? values[cond.topic]?.value : undefined;
  const state = conditionState(cond, live);
  const grants = cond.grants ?? true;
  const revokes = cond.revokes ?? cond.type === 'token';
  const set = (patch: Partial<LoaCondition>) => onChange({ ...cond, ...patch });
  const canCapture = live !== undefined && live !== '';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {!fixedType && (
          <div>
            <label className={LABEL_CLS}>Type</label>
            <select aria-label="Element type" value={cond.type} onChange={(e) => set({ type: e.target.value as LoaCondition['type'] })} className={FIELD_CLS}>
              <option value="signal">Signal</option>
              <option value="token">Token</option>
              <option value="condition">Condition</option>
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[10rem]">
          <label className={LABEL_CLS}>Label</label>
          <input aria-label="Element label" value={cond.label} onChange={(e) => set({ label: e.target.value })} className={`${FIELD_CLS} w-full`} />
        </div>
        <div className="flex-[2] min-w-[14rem]">
          <label className={LABEL_CLS}>Topic</label>
          <input aria-label="Element topic" value={cond.topic} spellCheck={false} onChange={(e) => set({ topic: e.target.value })}
            className={`${FIELD_CLS} w-full font-mono text-xs`} />
        </div>
        <div className="flex items-center gap-2 pb-1.5" data-testid="live-value">
          <Dot state={state} />
          <LiveValue topic={cond.topic} values={values} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <div className="flex items-center justify-between">
            <label className={LABEL_CLS}>Clear values (one per line, globs ok)</label>
            <button type="button" disabled={!canCapture} className={`${BTN_CLS} mb-1`}
              title={canCapture ? `Add "${live}"` : 'No live value for this topic'}
              onClick={() => { if (live && !cond.clear.includes(live)) set({ clear: [...cond.clear, live] }); }}>
              Use current value as clear
            </button>
          </div>
          <ListInput label="Clear values" value={cond.clear} separator={'\n'} rows={2} onChange={(clear) => set({ clear })} />
        </div>
        <div>
          <label className={LABEL_CLS}>Caution values (optional, amber)</label>
          <ListInput label="Caution values" value={cond.caution ?? []} separator={'\n'} rows={2}
            onChange={(caution) => set({ caution: caution.length ? caution : undefined })} />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
            <label className="flex items-center gap-1.5" title="Must be clear, together with every other granting element, for the section to be granted">
              <input type="checkbox" aria-label="Grants" checked={grants} onChange={(e) => set({ grants: e.target.checked })} />
              Grants
            </label>
            <label className="flex items-center gap-1.5" title="Going back to not clear releases the authority (e.g. the staff returned)">
              <input type="checkbox" aria-label="Revokes" checked={revokes} onChange={(e) => set({ revokes: e.target.checked })} />
              Revokes
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Selector row ────────────────────────────────────────────────────────────

function emptyCondition(type: LoaCondition['type'] = 'signal'): LoaCondition {
  return { type, label: '', topic: '', clear: [] };
}

function SelectorFields({ el, values, onChange }: {
  el: LoaSelector;
  values: Record<string, LoaValue>;
  onChange: (e: LoaSelector) => void;
}) {
  const view = evaluateElement(el, values);
  const keys = Object.keys(el.options);
  const liveSel = el.topic ? values[el.topic]?.value : undefined;

  function setOption(k: string, c: LoaCondition) {
    onChange({ ...el, options: { ...el.options, [k]: c } });
  }
  function renameOption(oldKey: string, newKey: string, input: HTMLInputElement) {
    const k = newKey.trim();
    if (k === oldKey) return;
    if (!k || k in el.options) { input.value = oldKey; return; }
    const options = Object.fromEntries(Object.entries(el.options).map(([key, c]) => [key === oldKey ? k : key, c]));
    onChange({ ...el, options, default: el.default === oldKey ? k : el.default });
  }
  function removeOption(k: string) {
    if (keys.length <= 1) return;
    const options = Object.fromEntries(Object.entries(el.options).filter(([key]) => key !== k));
    onChange({ ...el, options, default: el.default === k ? Object.keys(options)[0] : el.default });
  }
  function addOption() {
    let n = keys.length + 1;
    while (`OPTION${n}` in el.options) n++;
    onChange({ ...el, options: { ...el.options, [`OPTION${n}`]: emptyCondition() } });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[10rem]">
          <label className={LABEL_CLS}>Selector label</label>
          <input aria-label="Selector label" value={el.label} onChange={(e) => onChange({ ...el, label: e.target.value })} className={`${FIELD_CLS} w-full`} />
        </div>
        <div className="flex-[2] min-w-[14rem]">
          <label className={LABEL_CLS}>Selector topic</label>
          <input aria-label="Selector topic" value={el.topic} spellCheck={false} onChange={(e) => onChange({ ...el, topic: e.target.value })}
            className={`${FIELD_CLS} w-full font-mono text-xs`} />
        </div>
        <div className="flex items-center gap-2 pb-1.5" data-testid="live-value">
          <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold ${liveSel !== undefined ? 'bg-sky-500 text-sky-950' : DOT_CLS.unknown}`}>
            {liveSel !== undefined ? '' : '?'}
          </span>
          <LiveValue topic={el.topic} values={values} />
        </div>
        <div>
          <label className={LABEL_CLS}>Default</label>
          <select aria-label="Selector default" value={el.default} onChange={(e) => onChange({ ...el, default: e.target.value })} className={FIELD_CLS}>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-400" data-testid="selector-in-use">
        In use: {view.option !== undefined ? <span className="font-mono text-slate-200">{view.option}</span> : <span className="text-slate-500">none</span>}
        {view.option !== undefined && <span className="text-slate-500"> ({view.optionFrom === 'value' ? 'from live value' : 'default, no value yet'})</span>}
      </p>
      <div className="space-y-2 border-l-2 border-slate-800 pl-3">
        {keys.map((k) => (
          <div key={k} className={`rounded-md border p-2 space-y-2 ${view.option === k ? 'border-sky-700/70 bg-sky-950/20' : 'border-slate-800'}`} data-testid="selector-option">
            <div className="flex items-end gap-2">
              <div>
                <label className={LABEL_CLS}>When selector reads</label>
                <input aria-label="Option value" defaultValue={k} spellCheck={false} className={`${FIELD_CLS} w-40 font-mono text-xs`}
                  onBlur={(e) => renameOption(k, e.target.value, e.currentTarget)} />
              </div>
              {view.option === k && <span className="text-[11px] text-sky-300 pb-2">in use</span>}
              <button type="button" className={`${BTN_CLS} ml-auto`} disabled={keys.length <= 1} onClick={() => removeOption(k)}>Remove option</button>
            </div>
            <ConditionFields cond={el.options[k]} values={values} onChange={(c) => setOption(k, c)} />
          </div>
        ))}
        <button type="button" className={BTN_CLS} disabled={keys.length >= MAX_OPTIONS} onClick={addOption}>+ Add option</button>
      </div>
    </div>
  );
}

// ── Element row ─────────────────────────────────────────────────────────────

function ElementRow({ el, index, count, values, onChange, onMove, onRemove }: {
  el: LoaElement;
  index: number;
  count: number;
  values: Record<string, LoaValue>;
  onChange: (e: LoaElement) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const view = evaluateElement(el, values);
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-2 space-y-2" data-testid="loa-element">
      <div className="flex items-center gap-2">
        <Dot state={view.state} />
        <span className="text-xs text-slate-400">{index + 1}. {el.type === 'selector' ? 'Selector' : 'Element'}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" className={BTN_CLS} disabled={index === 0} aria-label="Move element up" onClick={() => onMove(-1)}>↑</button>
          <button type="button" className={BTN_CLS} disabled={index === count - 1} aria-label="Move element down" onClick={() => onMove(1)}>↓</button>
          <button type="button" className={BTN_CLS} aria-label="Remove element" onClick={onRemove}>Remove</button>
        </span>
      </div>
      {el.type === 'selector'
        ? <SelectorFields el={el} values={values} onChange={onChange} />
        : <ConditionFields cond={el} values={values} onChange={onChange} />}
    </div>
  );
}

// ── Section card ────────────────────────────────────────────────────────────

function StationInput({ label, value, stations, onChange }: {
  label: string;
  value: string;
  stations: string[];
  onChange: (v: string) => void;
}) {
  const listId = useMemo(() => `loa-stations-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <input aria-label={label} list={listId} value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD_CLS} w-44`} placeholder="Station name" />
      <datalist id={listId}>{stations.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

function SectionCard({ section, index, count, stations, values, open, onToggle, onChange, onMove, onRemove }: {
  section: LoaSectionDef;
  index: number;
  count: number;
  stations: string[];
  values: Record<string, LoaValue>;
  open: boolean;
  onToggle: () => void;
  onChange: (s: LoaSectionDef) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<LoaSectionDef>) => onChange({ ...section, ...patch });
  const setEl = (j: number, e: LoaElement) => set({ elements: section.elements.map((x, k) => (k === j ? e : x)) });
  const add = (kind: LoaCondition['type'] | 'selector') => {
    const el: LoaElement = kind === 'selector'
      ? { type: 'selector', label: '', topic: '', options: { CLOSED: emptyCondition(), THROWN: emptyCondition() }, default: 'CLOSED' }
      : emptyCondition(kind);
    set({ elements: [...section.elements, el] });
  };
  const states = section.elements.map((el) => evaluateElement(el, values).state);

  return (
    <div className="rounded-lg border border-slate-800" data-testid="loa-section">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Collapse section' : 'Expand section'}
          className="text-slate-400 hover:text-white w-5">{open ? '▾' : '▸'}</button>
        <span className="text-sm font-medium text-white truncate">{section.name || '(unnamed)'}</span>
        <span className="text-xs text-slate-500 truncate">{section.from || '?'} → {section.to || '?'}</span>
        <span className="flex gap-1 ml-2">{states.map((s, i) => <Dot key={i} state={s} />)}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" className={BTN_CLS} disabled={index === 0} aria-label="Move section up" onClick={() => onMove(-1)}>↑</button>
          <button type="button" className={BTN_CLS} disabled={index === count - 1} aria-label="Move section down" onClick={() => onMove(1)}>↓</button>
          <button type="button" className={BTN_CLS} aria-label="Remove section"
            onClick={() => { if (window.confirm(`Delete section "${section.name || 'unnamed'}"?`)) onRemove(); }}>Remove</button>
        </span>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[10rem]">
              <label className={LABEL_CLS}>Name</label>
              <input aria-label="Section name" value={section.name} onChange={(e) => set({ name: e.target.value })} className={`${FIELD_CLS} w-full`} />
            </div>
            <StationInput label="From" value={section.from} stations={stations} onChange={(from) => set({ from })} />
            <StationInput label="To" value={section.to} stations={stations} onChange={(to) => set({ to })} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Only trains matching (globs, comma separated)</label>
              <ListInput label="Only" value={section.only} separator=", " placeholder="e.g. K*, 8*" onChange={(only) => set({ only })} />
            </div>
            <div>
              <label className={LABEL_CLS}>Except trains matching</label>
              <ListInput label="Except" value={section.except} separator=", " placeholder="e.g. LE*" onChange={(except) => set({ except })} />
            </div>
          </div>
          <div className="space-y-2">
            {section.elements.length === 0 && <p className="text-xs text-slate-500">No elements yet. A section with no elements is granted immediately.</p>}
            {section.elements.map((el, j) => (
              <ElementRow key={j} el={el} index={j} count={section.elements.length} values={values}
                onChange={(e) => setEl(j, e)}
                onMove={(d) => set({ elements: move(section.elements, j, d) })}
                onRemove={() => set({ elements: section.elements.filter((_, k) => k !== j) })} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-slate-400 self-center mr-1">Add element</span>
            {(['signal', 'token', 'condition', 'selector'] as const).map((k) => (
              <button key={k} type="button" className={BTN_CLS} disabled={section.elements.length >= MAX_ELEMENTS} onClick={() => add(k)}>+ {k}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

function Preview({ loa, timetable, values }: { loa: LoaConfig; timetable: LayoutSectionProps['timetable']; values: Record<string, LoaValue> }) {
  const [trainId, setTrainId] = useState('');
  const train = timetable?.trains.find((t) => t.id === trainId);
  const matches = train && timetable ? sectionsForTrain(train, timetable.stations, loa) : [];
  return (
    <div className="rounded-lg border border-slate-800 p-3 space-y-2" data-testid="loa-preview">
      <h4 className="text-sm font-semibold text-white">Preview</h4>
      {!timetable ? (
        <p className="text-xs text-slate-500">Open a timetable to preview which sections a train gets.</p>
      ) : (
        <>
          <select aria-label="Preview train" value={trainId} onChange={(e) => setTrainId(e.target.value)} className={FIELD_CLS}>
            <option value="">Pick a train…</option>
            {timetable.trains.map((t) => <option key={t.id} value={t.id}>{t.name}{t.train_id ? ` (${t.train_id})` : ''}</option>)}
          </select>
          {train && matches.length === 0 && <p className="text-xs text-slate-500">No sections match this train.</p>}
          <ol className="space-y-1">
            {matches.map((m) => (
              <li key={m.key} className="text-sm text-slate-200" data-testid="preview-section">
                <span className="font-medium">{m.section.name}</span>
                <span className="text-xs text-slate-500"> · stops {m.fromIndex + 1} → {m.toIndex + 1}</span>
                <span className="ml-2 inline-flex gap-1 align-middle">
                  {m.section.elements.map((el, i) => {
                    const v = evaluateElement(el, values);
                    return <span key={i} title={`${el.label}: ${DOT_LABEL[v.state]}`}><Dot state={v.state} /></span>;
                  })}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// ── JSON view ───────────────────────────────────────────────────────────────

function JsonView({ loa, onApply }: { loa: LoaConfig; onApply: (l: LoaConfig) => void }) {
  const canonical = JSON.stringify(loa, null, 2);
  const [text, setText] = useState(canonical);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!dirty) setText(canonical); }, [canonical, dirty]);

  function apply() {
    try {
      const parsed: unknown = JSON.parse(text);
      const e = loaError(parsed);
      if (e) { setError(e); return; }
      onApply(parsed as LoaConfig);
      setDirty(false);
      setError('');
    } catch (err) {
      setError(`Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`);
    }
  }

  return (
    <div className="space-y-2">
      <textarea aria-label="LOA JSON" value={text} spellCheck={false} rows={22}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        className={`${FIELD_CLS} w-full font-mono text-xs`} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={BTN_CLS} onClick={apply} disabled={!dirty}>Apply</button>
        <button type="button" className={BTN_CLS} onClick={() => { setText(canonical); setDirty(false); setError(''); }} disabled={!dirty}>Revert</button>
        <span className="text-xs text-slate-500 self-center">Apply updates the draft; Save validates on the server.</span>
      </div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export function LoaSection({ draft, onChange, timetable }: LayoutSectionProps) {
  const loa = draft.loa;
  const values = useLoaValues();
  const [view, setView] = useState<'edit' | 'json'>('edit');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const stations = useMemo(
    () => Array.from(new Set((timetable?.stations ?? []).map((s) => s.name))),
    [timetable],
  );
  const problem = validateLoa(draft);
  const setLoa = (patch: Partial<LoaConfig>) => onChange({ ...draft, loa: { ...loa, ...patch } });
  const setSection = (i: number, s: LoaSectionDef) => setLoa({ sections: loa.sections.map((x, j) => (j === i ? s : x)) });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function addSection() {
    const name = 'New section';
    const id = newId(name);
    setLoa({ sections: [...loa.sections, { id, name, from: '', to: '', only: [], except: [], elements: [] }] });
    setOpen((o) => new Set(o).add(id));
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Limit of authority</h3>
        <p className="text-sm text-slate-400 mt-1">
          Directional sections between stations. The guard panel shows authority once every element in a section is clear.
          Live values come from the server's MQTT topic cache.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={loa.warn_on_depart} onChange={(e) => setLoa({ warn_on_depart: e.target.checked })} />
        Warn when the doors close at a section's start without authority
      </label>

      {problem && <p className="text-sm text-red-400">{problem}</p>}

      <div className="flex gap-1" role="tablist">
        {(['edit', 'json'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`px-3 py-1 rounded-md text-xs border ${view === v ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}>
            {v === 'edit' ? 'Editor' : 'JSON'}
          </button>
        ))}
      </div>

      {view === 'json' ? (
        <JsonView loa={loa} onApply={(l) => onChange({ ...draft, loa: l })} />
      ) : (
        <>
          <div className="space-y-2">
            {loa.sections.length === 0 && <p className="text-sm text-slate-500">No sections yet.</p>}
            {loa.sections.map((s, i) => (
              <SectionCard key={s.id} section={s} index={i} count={loa.sections.length} stations={stations} values={values}
                open={open.has(s.id)} onToggle={() => toggle(s.id)}
                onChange={(x) => setSection(i, x)}
                onMove={(d) => setLoa({ sections: move(loa.sections, i, d) })}
                onRemove={() => setLoa({ sections: loa.sections.filter((_, j) => j !== i) })} />
            ))}
          </div>
          <button type="button" className={BTN_CLS} disabled={loa.sections.length >= MAX_SECTIONS} onClick={addSection}>+ Add section</button>
          <Preview loa={loa} timetable={timetable} values={values} />
        </>
      )}
    </div>
  );
}
