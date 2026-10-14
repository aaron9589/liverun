/** Departure warning (spec §11.6, L2): doors were closed without authority. A warning only; needs an ACK tap. */
export function LoaWarningBanner({ title, detail, onAck }: { title: string; detail: string; onAck: () => void }) {
  return (
    <div role="alert" data-testid="loa-warning" className="flex items-center gap-3 px-4 py-3 bg-red-700 border-b border-red-300 text-white animate-pulse">
      <span className="flex-1 min-w-0">
        <span className="block text-lg font-bold">⚠ {title}</span>
        {detail && <span className="block text-sm">Waiting for: {detail}</span>}
      </span>
      <button onClick={onAck} className="min-h-[56px] px-8 rounded-lg bg-slate-950 text-red-300 text-xl font-bold hover:bg-slate-800">ACK</button>
    </div>
  );
}
