import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { LayoutConfig, Timetable } from '../types';
import { api } from '../api';
import { JmriSection, validateJmriUrl } from './layout/JmriSection';
import { GuardSection } from './layout/GuardSection';
import { TrainProfilesSection } from './layout/TrainProfilesSection';
import { SoundLibrarySection } from './layout/SoundLibrarySection';
import { BoardingSection, validateBoarding } from './layout/BoardingSection';
import { GuardEventsSection, validateGuardEvents } from './layout/GuardEventsSection';
import { LoaSection, validateLoa } from './layout/LoaSection';
import { StatsSection, validateStats } from './layout/StatsSection';
import { validateGuard, validateProfiles, type LayoutSectionProps } from './layout/shared';

interface SectionDef {
  id: string;
  label: string;
  component: ComponentType<LayoutSectionProps>;
  /** Returns an error message when the draft is invalid for this section. */
  validate?: (draft: LayoutConfig) => string | null;
}

// To add a layout-wide settings section, add an entry here.
const SECTIONS: SectionDef[] = [
  { id: 'jmri', label: 'JMRI', component: JmriSection, validate: (d) => validateJmriUrl(d.jmri.url) },
  { id: 'guard', label: 'Guard panel', component: GuardSection, validate: validateGuard },
  { id: 'profiles', label: 'Train profiles', component: TrainProfilesSection, validate: validateProfiles },
  { id: 'boarding', label: 'Boarding', component: BoardingSection, validate: validateBoarding },
  { id: 'events', label: 'Guard events', component: GuardEventsSection, validate: validateGuardEvents },
  { id: 'stats', label: 'Stats', component: StatsSection, validate: validateStats },
  { id: 'loa', label: 'Limit of authority', component: LoaSection, validate: validateLoa },
  { id: 'sounds', label: 'Sound library', component: SoundLibrarySection },
];

interface Props {
  layout: LayoutConfig;
  /** The currently open timetable, used by the train profile preview. */
  timetable?: Timetable | null;
  onSaved: (layout: LayoutConfig) => void;
  onClose: () => void;
}

/** api.ts throws Error(body); body is JSON {"error": "..."} for validation failures. */
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch { /* not JSON */ }
  return raw || 'Save failed';
}

export function LayoutSettings({ layout, timetable, onSaved, onClose }: Props) {
  const [saved, setSaved] = useState<LayoutConfig>(layout);
  const [draft, setDraft] = useState<LayoutConfig>(layout);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = SECTIONS.flatMap((s) => {
    const m = s.validate?.(draft);
    return m ? [`${s.label}: ${m}`] : [];
  });
  const invalid = problems.length > 0;
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const Section = section.component;

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved layout changes?')) return;
    onClose();
  }

  // Keep a fresh handler for the Escape listener without re-binding every render.
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const result = await api.updateLayout(draft);
      setSaved(result);
      setDraft(result);
      onSaved(result);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(saved, null, 2) + '\n'], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'liverun-layout.json';
    a.click();
    URL.revokeObjectURL(href);
  }

  async function handleImport(file: File) {
    setImportError('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected a JSON object');
      }
      // Merge over the current draft so sections absent from the file keep their values.
      setDraft({ ...draft, ...(parsed as Partial<LayoutConfig>) });
      setError('');
    } catch (e) {
      setImportError(`Could not import "${file.name}": ${e instanceof Error ? e.message : 'invalid JSON'}`);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={requestClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
            <h2 className="text-lg font-semibold text-white">Layout settings</h2>
            <button
              onClick={requestClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            <nav className="w-44 shrink-0 border-r border-slate-800 p-2 space-y-0.5 overflow-y-auto">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSectionId(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    s.id === section.id
                      ? 'bg-slate-800 text-white font-medium'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <Section draft={draft} onChange={setDraft} timetable={timetable} />
            </div>
          </div>

          <div className="px-6 py-3 border-t border-slate-800 shrink-0 space-y-2">
            {error && (
              <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-300">{error}</div>
            )}
            {invalid && (
              <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-300">
                Cannot save: {problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}
              </div>
            )}
            {importError && (
              <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-300">{importError}</div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Export layout JSON
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Import layout JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handleImport(f);
                }}
              />
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={requestClose}
                  className="px-4 py-1.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving || invalid}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
