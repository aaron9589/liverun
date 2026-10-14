import { useCallback, useEffect, useRef, useState } from 'react';

// Reusable toast stack for "changes from Control" (docs/guard-panel-spec.md §6.5).
// Used by CrewMobile and the guard panel.

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Epoch ms when pushed. */
  at: number;
}

export interface Toasts {
  /** Currently shown toasts, newest first. */
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => number;
  dismiss: (id: number) => void;
  /** The most recent toasts (newest first), kept after they hide. */
  history: Toast[];
}

let nextToastId = 1;

export function useToasts({ ttlMs = 8_000, historySize = 10 }: { ttlMs?: number; historySize?: number } = {}): Toasts {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const toast: Toast = { id: nextToastId++, message, tone, at: Date.now() };
    setToasts((prev) => [toast, ...prev]);
    setHistory((prev) => [toast, ...prev].slice(0, historySize));
    timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), ttlMs));
    return toast.id;
  }, [dismiss, ttlMs, historySize]);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  return { toasts, push, dismiss, history };
}

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'border-l-blue-400',
  success: 'border-l-green-400',
  warning: 'border-l-amber-400',
  danger: 'border-l-red-400',
};

/** Fixed top-right stack. Shows the newest `max` toasts; tap one to dismiss it. */
export function ChangeToasts({
  toasts,
  onDismiss,
  max = 4,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  max?: number;
}) {
  return (
    <div
      className="fixed top-3 right-3 z-50 flex flex-col gap-2 w-[min(20rem,calc(100vw-1.5rem))] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.slice(0, max).map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`pointer-events-auto text-left px-3 py-2.5 rounded-lg bg-slate-800/95 backdrop-blur border border-slate-700 border-l-4 ${TONE_CLASSES[t.tone]} text-sm text-slate-100 shadow-xl`}
          title="Dismiss"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
