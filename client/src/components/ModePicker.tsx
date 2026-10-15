import { useState } from 'react';
import { modeUrl, saveMode, type SavedMode } from '../lib/mode';

const CARDS: { mode: SavedMode; title: string; blurb: string }[] = [
  { mode: 'guard', title: 'Guard panel', blurb: 'Your train, stops and clock at a glance while you work the service.' },
  { mode: 'crew', title: 'Crew view', blurb: 'Browse crews and trains, see timetables and mark runs complete.' },
  { mode: 'planner', title: 'Planner', blurb: 'Build timetables, stations and the stringline graph.' },
];

export function ModePicker() {
  const [remember, setRemember] = useState(true);

  const choose = (mode: SavedMode) => {
    if (remember) saveMode(mode);
    window.location.assign(modeUrl(mode));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold">LiveRun</h1>
          <p className="text-sm text-slate-400 mt-1">How do you want to use it on this device?</p>
        </div>
        {CARDS.map((c) => (
          <button
            key={c.mode}
            onClick={() => choose(c.mode)}
            className="text-left min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-blue-500 active:bg-slate-800 px-5 py-4 transition-colors"
          >
            <div className="text-lg font-semibold text-blue-400">{c.title}</div>
            <div className="text-sm text-slate-400 mt-1">{c.blurb}</div>
          </button>
        ))}
        <label className="flex items-center gap-3 min-h-[48px] text-sm text-slate-300 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-5 h-5 accent-blue-500"
          />
          Remember this choice on this device
        </label>
      </div>
    </div>
  );
}
