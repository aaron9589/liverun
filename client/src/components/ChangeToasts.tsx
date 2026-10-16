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
  /** Optional button (e.g. Review); clicking it runs onClick and dismisses the toast. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toasts {
  /** Currently shown toasts, newest first. */
  toasts: Toast[];
  push: (message: string, tone?: ToastTone, action?: ToastAction) => number;
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

  const push = useCallback((message: string, tone: ToastTone = 'info', action?: ToastAction) => {
    const toast: Toast = { id: nextToastId++, message, tone, at: Date.now(), ...(action ? { action } : {}) };
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

/** Fixed right-hand stack (top or bottom). Shows the newest `max` toasts; tap one to dismiss it. */
export function ChangeToasts({
  toasts,
  onDismiss,
  max = 4,
  placement = 'top',
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  max?: number;
  /** 'bottom' keeps the stack clear of header controls and banners. */
  placement?: 'top' | 'bottom';
}) {
  return (
    <div
      className={`fixed ${placement === 'top' ? 'top-3 flex-col' : 'bottom-3 flex-col-reverse'} right-3 z-50 flex gap-2 w-[min(20rem,calc(100vw-1.5rem))] pointer-events-none`}
      role="status"
      aria-live="polite"
    >
      {toasts.slice(0, max).map((t) => t.action ? (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-800/95 backdrop-blur border border-slate-700 border-l-4 ${TONE_CLASSES[t.tone]} text-sm text-slate-100 shadow-xl`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => { t.action!.onClick(); onDismiss(t.id); }}
            className="shrink-0 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
          >
            {t.action.label}
          </button>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 text-slate-500 hover:text-slate-300" title="Dismiss" aria-label="Dismiss">✕</button>
        </div>
      ) : (
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
