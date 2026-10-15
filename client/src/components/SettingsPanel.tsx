import { useEffect, useRef, useState } from 'react';
import type { TimetableSettings } from '../types';
import type { ClockStatus } from '../hooks/useFastClock';

interface Props {
  labelMode: 'code' | 'name';
  onLabelModeChange: (m: 'code' | 'name') => void;
  distanceUnit: 'km' | 'mi';
  onDistanceUnitChange: (u: 'km' | 'mi') => void;
  settings: TimetableSettings;
  onSettingsSave: (s: TimetableSettings) => Promise<void>;
  clockStatus: ClockStatus;
  clockError: string | null;
  onClose: () => void;
  onOpenLayoutSettings: () => void;
  timetableId?: string;
  firstStationName?: string;
}

const APP_BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
const API_BASE = APP_BASE + '/api';

export function SettingsPanel({
  labelMode, onLabelModeChange, distanceUnit, onDistanceUnitChange,
  settings, onSettingsSave, clockStatus, clockError, onClose,
  onOpenLayoutSettings, timetableId, firstStationName,
}: Props) {
  const [local, setLocal] = useState<TimetableSettings>(settings);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Tracks the last settings value we synced from the server. Used to detect
  // user edits: if local diverges from this snapshot the user has pending changes.
  const settingsSnapshotRef = useRef(settings);

  useEffect(() => {
    setLocal((prev) => {
      const snap = settingsSnapshotRef.current;
      settingsSnapshotRef.current = settings;
      // No user edits since last sync → full re-sync (e.g. timetable switch).
      if (JSON.stringify(prev) === JSON.stringify(snap)) return settings;
      // User has pending edits → only pull in fields not shown in this form
      // so a background graph-scale change doesn't wipe the clock config.
      return { ...prev, graph_scale: settings.graph_scale, auto_assign_min_break: settings.auto_assign_min_break };
    });
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const dirty = JSON.stringify(local) !== JSON.stringify(settings);

  const inspectorUrl = (() => {
    const url = new URL(`${APP_BASE}/ws-inspector.html`, window.location.href);
    if (timetableId) url.searchParams.set('id', timetableId);
    if (firstStationName) url.searchParams.set('station', firstStationName);
    return url.toString();
  })();

  // Path-request values are brought into the server's ranges here: a value it refuses
  // would otherwise fail silently (the save handler only logs errors).
  const clampInt = (v: number | undefined, min: number, max: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v as number))) : fallback;

  async function handleSave() {
    const prefix = (local.request_train_prefix ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 8);
    const tidy: TimetableSettings = {
      ...local,
      request_train_prefix: prefix || 'PR',
      request_default_leg_min: clampInt(local.request_default_leg_min, 1, 120, 5),
      request_lead_min: clampInt(local.request_lead_min, 0, 60, 2),
    };
    setLocal(tidy);
    setSaving(true);
    try { await onSettingsSave(tidy); } finally { setSaving(false); }
  }

  const statusDot: Record<ClockStatus, string> = {
    disconnected: 'bg-slate-500',
    connecting: 'bg-amber-400 animate-pulse',
    connected: 'bg-emerald-400',
    error: 'bg-red-500',
  };
  const statusLabel: Record<ClockStatus, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    error: 'Error',
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 w-80 z-50 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-sm overflow-y-auto max-h-[calc(100vh-4rem)]"
    >
      {/* Station labels */}
      <div className="px-4 py-3 border-b border-slate-800">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Station labels</p>
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          <button
            onClick={() => onLabelModeChange('code')}
            className={`flex-1 py-1 text-xs font-mono transition-colors ${
              labelMode === 'code' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >Code</button>
          <button
            onClick={() => onLabelModeChange('name')}
            className={`flex-1 py-1 text-xs font-mono transition-colors ${
              labelMode === 'name' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >Name</button>
        </div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-3 mb-2">Distance unit</p>
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          <button
            onClick={() => onDistanceUnitChange('km')}
            className={`flex-1 py-1 text-xs font-mono transition-colors ${
              distanceUnit === 'km' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >km</button>
          <button
            onClick={() => onDistanceUnitChange('mi')}
            className={`flex-1 py-1 text-xs font-mono transition-colors ${
              distanceUnit === 'mi' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >mi</button>
        </div>
      </div>

      {/* Fast clock */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Fast clock</p>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${statusDot[clockStatus]}`} />
            <span className="text-xs text-slate-500">{statusLabel[clockStatus]}</span>
          </div>
        </div>
        {clockError && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-700/40 rounded px-2 py-1.5 mb-3 break-all">{clockError}</p>
        )}

        <label className="flex items-center justify-between mb-3 cursor-pointer">
          <span className="text-slate-300">Enable</span>
          <button
            role="switch"
            aria-checked={local.clock_enabled}
            onClick={() => setLocal((p) => ({ ...p, clock_enabled: !p.clock_enabled }))}
            className={`relative w-9 h-5 rounded-full transition-colors ${local.clock_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${local.clock_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </label>

        <label className="block mb-2">
          <span className="text-xs text-slate-500 block mb-1">Broker URL (ws:// or wss://)</span>
          <input
            type="text"
            value={local.clock_broker_url}
            onChange={(e) => setLocal((p) => ({ ...p, clock_broker_url: e.target.value }))}
            placeholder="ws://localhost:1883"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
          />
        </label>

        <label className="block mb-3">
          <span className="text-xs text-slate-500 block mb-1">MQTT topic</span>
          <input
            type="text"
            value={local.clock_topic}
            onChange={(e) => setLocal((p) => ({ ...p, clock_topic: e.target.value }))}
            placeholder="trains/jmri/memory/currentTime"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
          />
        </label>

        {/* JMRI script download */}
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
          <p className="text-xs font-semibold text-slate-300 mb-1">JMRI integration</p>
          <p className="text-xs text-slate-500 mb-2 leading-relaxed">
            Download a Jython script that publishes the JMRI fast clock to the topic above.
            Compatible with JMRI&nbsp;4.17+.
          </p>
          <a
            href={`${API_BASE}/download/jmri-clock-script?topic=${encodeURIComponent(local.clock_topic || 'jmri/memory/currentTime')}`}
            download="liverun-clock.py"
            className="inline-flex items-center gap-1.5 w-full justify-center py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download liverun-clock.py
          </a>
          <details className="mt-2">
            <summary className="text-xs text-slate-500 cursor-pointer select-none hover:text-slate-400">
              How to use in JMRI
            </summary>
            <ol className="mt-2 text-xs text-slate-500 space-y-1 list-decimal list-inside leading-relaxed">
              <li>In JMRI open <span className="text-slate-400 font-medium">Edit &gt; Preferences &gt; Connections</span>, add a new <span className="text-slate-400 font-medium">MQTT</span> connection and enter your broker hostname and port (default&nbsp;1883).</li>
              <li>Save the downloaded file to the <span className="font-mono text-slate-400">jython/</span> folder inside your JMRI preferences folder.</li>
              <li>
                To run once: <span className="text-slate-400 font-medium">Scripting &gt; Run Script…</span>
              </li>
              <li>
                To run at startup: <span className="text-slate-400 font-medium">Edit &gt; Preferences &gt; Start Up &gt; Add Action &gt; Execute Jython Script</span>.
              </li>
            </ol>
          </details>
        </div>

        {/* Path requests (spec §7) */}
        <div className="mb-3 pt-3 border-t border-slate-800">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Path requests</p>
          <label className="flex items-center justify-between mb-3 cursor-pointer">
            <span className="text-slate-300">Crews can request paths</span>
            <button
              role="switch"
              aria-checked={local.requests_enabled ?? true}
              onClick={() => setLocal((p) => ({ ...p, requests_enabled: !(p.requests_enabled ?? true) }))}
              className={`relative w-9 h-5 rounded-full transition-colors ${(local.requests_enabled ?? true) ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${(local.requests_enabled ?? true) ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-500 block mb-1">Train name prefix</span>
            <input
              type="text"
              maxLength={8}
              value={local.request_train_prefix ?? 'PR'}
              onChange={(e) => setLocal((p) => ({ ...p, request_train_prefix: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-600"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-500 block mb-1">Default leg time (min)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={local.request_default_leg_min ?? 5}
              onChange={(e) => setLocal((p) => ({ ...p, request_default_leg_min: Number(e.target.value) }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-600"
            />
            <span className="text-xs text-slate-600 block mt-1">used where path templates have no data</span>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 block mb-1">Lead time from the fast clock (min)</span>
            <input
              type="number"
              min={0}
              max={60}
              value={local.request_lead_min ?? 2}
              onChange={(e) => setLocal((p) => ({ ...p, request_lead_min: Number(e.target.value) }))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-600"
            />
            <span className="text-xs text-slate-600 block mt-1">for &lsquo;as soon as possible&rsquo; requests</span>
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="w-full py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
        >
          {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <div className="px-4 py-3 border-t border-slate-800">
        <button
          onClick={() => { onClose(); onOpenLayoutSettings(); }}
          className="w-full py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors"
        >
          Layout settings…
        </button>
      </div>

      {/* Developer tools */}
      <div className="px-4 py-3 border-t border-slate-800">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Developer tools</p>
        <div className="flex flex-col gap-1.5">
          <a
            href={inspectorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors"
          >
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            WS Inspector
          </a>
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors"
          >
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            API Schema
          </a>
        </div>
      </div>
    </div>
  );
}
