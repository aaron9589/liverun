import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutConfig, Timetable } from '../../types';
import { api, soundUrl, type SoundFile } from '../../api';
import type { SectionProps } from './JmriSection';

/** Props every layout section receives; `timetable` is the currently open one (for previews). */
export interface LayoutSectionProps extends SectionProps {
  timetable?: Timetable | null;
}

// ── Validation (mirrors server/sounds.js + server/layout.js) ───────────────

const SOUND_NAME_RE = /^[A-Za-z0-9 ._-]+$/;
const ACTION_RE = /^[a-z0-9_]{1,40}$/;

/** Error message for a sound file name, or null if valid. Does not accept ''. */
export function soundNameError(name: string): string | null {
  if (!name) return 'File name is required';
  if (name.length > 100) return 'File name must be 100 characters or fewer';
  if (name.startsWith('.')) return 'File name must not start with a dot';
  if (!SOUND_NAME_RE.test(name) || name.includes('..')) return 'File name may only use letters, digits, space, . _ -';
  if (!/\.(mp3|ogg|wav)$/i.test(name)) return 'File must be .mp3, .ogg or .wav';
  return null;
}

export function validateGuard(draft: LayoutConfig): string | null {
  const s = draft.guard.event_alert_sound;
  return s === '' ? null : soundNameError(s);
}

export function validateProfiles(draft: LayoutConfig): string | null {
  const seen = new Set<string>();
  for (const [i, p] of draft.train_profiles.entries()) {
    const at = `Profile ${i + 1}${p.name.trim() ? ` "${p.name}"` : ''}`;
    if (!p.id.trim() || seen.has(p.id)) return `${at}: id must be unique`;
    seen.add(p.id);
    if (!p.name.trim()) return `${at}: name is required`;
    for (const k of ['door_open', 'door_close', 'bell'] as const) {
      if (p.sounds[k] !== '' && soundNameError(p.sounds[k])) return `${at}: invalid ${k} sound`;
    }
    for (const [action, f] of Object.entries(p.functions)) {
      if (!ACTION_RE.test(action)) return `${at}: action name "${action}" must be 1-40 characters of a-z, 0-9, _`;
      if ('fn' in f.key) {
        if (!Number.isInteger(f.key.fn) || f.key.fn < 0 || f.key.fn > 68) return `${at}: ${action} F-number must be 0-68`;
      } else if (!f.key.label.trim()) {
        return `${at}: ${action} needs a roster label`;
      }
      if (f.mode === 'pulse' && f.pulse_ms !== undefined && !(Number.isInteger(f.pulse_ms) && f.pulse_ms >= 50 && f.pulse_ms <= 10000)) {
        return `${at}: ${action} pulse must be 50-10000 ms`;
      }
      if (f.mode === 'on_for' && f.duration_s !== undefined && !(f.duration_s >= 1 && f.duration_s <= 300)) {
        return `${at}: ${action} duration must be 1-300 s`;
      }
    }
  }
  return null;
}

/** Profiles / the guard setting that reference a sound file, as readable labels. */
export function soundReferences(layout: LayoutConfig, file: string): string[] {
  const refs: string[] = [];
  if (layout.guard.event_alert_sound === file) refs.push('Guard event alert');
  for (const p of layout.train_profiles) {
    for (const k of ['door_open', 'door_close', 'bell'] as const) {
      if (p.sounds[k] === file) refs.push(`${p.name || p.id} (${k})`);
    }
  }
  return refs;
}

// ── Sound library helpers ──────────────────────────────────────────────────

export function useSoundList() {
  const [sounds, setSounds] = useState<SoundFile[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api.listSounds()
      .then((s) => { setSounds(s); setError(''); })
      .catch(() => setError('Could not load the sound library'));
  }, []);
  useEffect(reload, [reload]);
  return { sounds, error, reload };
}

/** ▶ button that previews a library sound (nothing when file is ''). */
export function PlayButton({ file }: { file: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { ref.current?.pause(); }, []);
  return (
    <button
      type="button"
      disabled={!file}
      onClick={() => {
        ref.current?.pause();
        const a = new Audio(soundUrl(file));
        ref.current = a;
        void a.play().catch(() => { /* missing file or autoplay blocked */ });
      }}
      title={file ? `Play ${file}` : 'Silent'}
      aria-label={file ? `Play ${file}` : 'Silent'}
      className="px-2 py-1 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      ▶
    </button>
  );
}

const SELECT_CLS =
  'bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500';
export const FIELD_CLS = SELECT_CLS;

/** Dropdown of library sounds plus "silent", with a ▶ preview. */
export function SoundSelect({ value, onChange, sounds, label }: {
  value: string;
  onChange: (v: string) => void;
  sounds: SoundFile[] | null;
  label?: string;
}) {
  const missing = value !== '' && sounds !== null && !sounds.some((s) => s.file === value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${SELECT_CLS} max-w-[12rem]`}>
        <option value="">(silent)</option>
        {missing && <option value={value}>{value} (missing)</option>}
        {(sounds ?? []).map((s) => <option key={s.file} value={s.file}>{s.file}</option>)}
      </select>
      <PlayButton file={value} />
    </span>
  );
}
