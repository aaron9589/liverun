import { useEffect, useRef, useState } from 'react';
import type { TimetableSettings } from '../types';
import type { ClockStatus } from '../hooks/useFastClock';

interface Props {
  labelMode: 'code' | 'name';
  onLabelModeChange: (m: 'code' | 'name') => void;
  settings: TimetableSettings;
  onSettingsSave: (s: TimetableSettings) => Promise<void>;
  clockStatus: ClockStatus;
  clockError: string | null;
  onClose: () => void;
}

export function SettingsPanel({
  labelMode, onLabelModeChange, settings, onSettingsSave, clockStatus, clockError, onClose,
}: Props) {
  const [local, setLocal] = useState<TimetableSettings>(settings);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLocal(settings), [settings]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const dirty = JSON.stringify(local) !== JSON.stringify(settings);

  async function handleSave() {
    setSaving(true);
    try { await onSettingsSave(local); } finally { setSaving(false); }
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
      className="absolute right-0 top-full mt-1 w-80 z-50 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-sm overflow-hidden"
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

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="w-full py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
        >
          {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
