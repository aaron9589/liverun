import { saveMobileView, switchMode, type MobileView } from '../lib/mode';

const CARDS: { view: MobileView; title: string; blurb: string }[] = [
  { view: 'jobs', title: 'Crew jobs', blurb: 'Your jobs, their timetables and instructions. Request a path from Control.' },
  { view: 'board', title: 'Running board', blurb: 'Everything running and when. Mark runs started and complete.' },
];

export function MobilePicker({ onPick }: { onPick: (view: MobileView) => void }) {
  const choose = (view: MobileView) => {
    saveMobileView(view);
    onPick(view);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold">LiveRun</h1>
          <p className="text-sm text-slate-400 mt-1">Which view on this phone?</p>
        </div>
        {CARDS.map((c) => (
          <button
            key={c.view}
            onClick={() => choose(c.view)}
            className="text-left min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-blue-500 active:bg-slate-800 px-5 py-4 transition-colors"
          >
            <div className="text-lg font-semibold text-blue-400">{c.title}</div>
            <div className="text-sm text-slate-400 mt-1">{c.blurb}</div>
          </button>
        ))}
        <button
          onClick={switchMode}
          title="Switch mode (guard panel, mobile, planner)"
          className="self-center min-h-[48px] px-4 text-sm text-slate-400 hover:text-slate-200 mt-2"
        >Switch mode</button>
      </div>
    </div>
  );
}
