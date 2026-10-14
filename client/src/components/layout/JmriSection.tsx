import { useState } from 'react';
import type { LayoutConfig } from '../../types';
import { fetchRoster, jmriHttpBase } from '../../lib/jmri';

export interface SectionProps {
  draft: LayoutConfig;
  onChange: (next: LayoutConfig) => void;
}

/** Mirrors the server rule: blank, or a ws:/wss: URL. Returns an error message or null. */
export function validateJmriUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  let u: URL;
  try { u = new URL(t); } catch { return 'Not a valid URL'; }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return 'URL must start with ws:// or wss://';
  return null;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; count: number }
  | { status: 'error'; message: string };

const TEST_TIMEOUT_MS = 5000;

export function JmriSection({ draft, onChange }: SectionProps) {
  const url = draft.jmri.url;
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  const urlError = validateJmriUrl(url);
  const rosterUrl = jmriHttpBase(url);
  const mixedContent = window.location.protocol === 'https:' && url.trim().toLowerCase().startsWith('ws://');

  async function handleTest() {
    setTest({ status: 'testing' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
    try {
      const roster = await fetchRoster(url, ctrl.signal);
      setTest({ status: 'ok', count: roster.length });
    } catch (e) {
      const message = ctrl.signal.aborted
        ? `Timed out after ${TEST_TIMEOUT_MS / 1000} s`
        : e instanceof Error ? e.message : 'Connection failed';
      setTest({ status: 'error', message });
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white">JMRI</h3>
        <p className="text-sm text-slate-400 mt-1">
          Connection to your JMRI server, used for loco roster lookup when editing trains.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          JMRI JSON WebSocket URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => {
            onChange({ ...draft, jmri: { ...draft.jmri, url: e.target.value } });
            setTest({ status: 'idle' });
          }}
          placeholder="wss://jmri.example.net/json/"
          spellCheck={false}
          className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-1 ${
            urlError ? 'border-red-700 focus:ring-red-500' : 'border-slate-700 focus:ring-blue-500'
          }`}
        />
        {urlError && <p className="text-xs text-red-400 mt-1">{urlError}</p>}
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Your browser connects to this address directly, so it must be reachable from every device
          running LiveRun. The roster is read from the matching http(s) URL.
          Leave blank to disable JMRI features.
        </p>
        {rosterUrl && (
          <p className="text-xs text-slate-500 mt-1">
            Roster URL: <span className="font-mono text-slate-400">{rosterUrl}/roster</span>
          </p>
        )}
      </div>

      {mixedContent && (
        <div className="rounded-lg bg-amber-950/40 border border-amber-800 px-3 py-2 text-sm text-amber-300">
          LiveRun is served over HTTPS, so browsers will block an insecure <span className="font-mono">ws://</span> connection
          (mixed content). Use a <span className="font-mono">wss://</span> URL.
        </div>
      )}

      <div>
        <button
          onClick={handleTest}
          disabled={!rosterUrl || test.status === 'testing'}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {test.status === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {test.status === 'ok' && (
          <p className="text-sm text-emerald-400 mt-2">
            ✓ Connected — {test.count} roster {test.count === 1 ? 'entry' : 'entries'}
          </p>
        )}
        {test.status === 'error' && (
          <p className="text-sm text-red-400 mt-2">✗ {test.message}</p>
        )}
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          The test fetches the roster from your browser. A failure can also mean JMRI is not sending
          CORS headers for this site, not only that the server is unreachable.
        </p>
      </div>
    </div>
  );
}
