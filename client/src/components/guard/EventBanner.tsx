import type { FiredEvent } from '../../hooks/useGuardEvents';

/** Flashing amber banner for fired guard events (spec §10.7); several queue behind each other. */
export function EventBanner({ queue, onAck }: { queue: FiredEvent[]; onAck: () => void }) {
  const first = queue[0];
  if (!first) return null;
  return (
    <div role="alert" data-testid="event-banner" className="flex items-center gap-3 px-4 py-3 bg-amber-600 border-b border-amber-300 text-slate-950 animate-pulse">
      <span className="flex-1 text-lg font-bold">
        ⚠ {first.ev.message}
        {queue.length > 1 && <span className="ml-3 text-sm font-semibold">1 of {queue.length}</span>}
      </span>
      <button onClick={onAck} className="min-h-[56px] px-8 rounded-lg bg-slate-950 text-amber-300 text-xl font-bold hover:bg-slate-800">ACK</button>
    </div>
  );
}
