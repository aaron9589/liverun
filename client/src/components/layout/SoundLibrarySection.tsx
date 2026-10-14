import { useRef, useState } from 'react';
import { api } from '../../api';
import { PlayButton, soundNameError, soundReferences, useSoundList, type LayoutSectionProps } from './shared';

const MAX_BYTES = 2 * 1024 * 1024;

function errorText(e: unknown): { exists: boolean; message: string } {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p === 'object' && p !== null && 'error' in p && typeof p.error === 'string') {
      return { exists: /already exists/.test(p.error), message: p.error };
    }
  } catch { /* plain text */ }
  return { exists: false, message: raw || 'Request failed' };
}

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function SoundLibrarySection({ draft }: LayoutSectionProps) {
  const { sounds, error, reload } = useSoundList();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setMsg(null);
    const nameErr = soundNameError(file.name);
    if (nameErr) return setMsg({ ok: false, text: nameErr });
    if (!file.type.startsWith('audio/') && !/\.(mp3|ogg|wav)$/i.test(file.name)) {
      return setMsg({ ok: false, text: 'Only audio files can be uploaded' });
    }
    if (file.size > MAX_BYTES) return setMsg({ ok: false, text: 'File is larger than 2 MB' });
    setBusy(true);
    try {
      try {
        await api.uploadSound(file);
      } catch (e) {
        const { exists, message } = errorText(e);
        if (!exists) throw new Error(message);
        if (!window.confirm(`"${file.name}" already exists. Replace it?`)) return;
        await api.uploadSound(file, true);
      }
      setMsg({ ok: true, text: `Uploaded ${file.name}` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: string) {
    const refs = soundReferences(draft, file);
    const warn = refs.length ? `\n\nIt is used by: ${refs.join(', ')}.` : '';
    if (!window.confirm(`Delete "${file}"? This happens immediately.${warn}`)) return;
    setMsg(null);
    try {
      await api.deleteSound(file);
      setMsg({ ok: true, text: `Deleted ${file}` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e).message });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white">Sound library</h3>
        <p className="text-sm text-slate-400 mt-1">
          Audio files that train profiles and the guard panel can play.
        </p>
      </div>

      <div className="rounded-lg bg-amber-950/40 border border-amber-800 px-3 py-2 text-sm text-amber-300">
        Uploads and deletes here take effect immediately. They are not part of the Save button.
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Uploading…' : 'Upload sound'}
        </button>
        <span className="text-xs text-slate-500">.mp3, .ogg or .wav, up to 2 MB</span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/x-wav,.mp3,.ogg,.wav"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>

      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
        {(sounds ?? []).map((s) => {
          const refs = soundReferences(draft, s.file);
          return (
            <li key={s.file} className="flex items-center gap-3 px-3 py-2">
              <PlayButton file={s.file} />
              <span className="text-sm text-white font-mono truncate">{s.file}</span>
              {refs.length > 0 && <span className="text-xs text-slate-500">used by {refs.length}</span>}
              <span className="ml-auto text-xs text-slate-500">{fmtSize(s.size)}</span>
              <button
                onClick={() => void remove(s.file)}
                className="px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-950/50"
                aria-label={`Delete ${s.file}`}
              >
                Delete
              </button>
            </li>
          );
        })}
        {sounds && sounds.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No sounds yet.</li>}
        {!sounds && !error && <li className="px-3 py-3 text-sm text-slate-500">Loading…</li>}
      </ul>
    </div>
  );
}
