import { useEffect, useState } from 'react';
import { api } from '../api';
import { DEFAULT_LAYOUT } from '../lib/layoutDefaults';
import type { LayoutConfig } from '../types';

/** Layout config (GET /api/layout), reloaded whenever the page becomes visible again. Falls back to neutral defaults. */
export function useLayout(): LayoutConfig {
  const [layout, setLayout] = useState<LayoutConfig>(DEFAULT_LAYOUT);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.getLayout()
        .then((l) => { if (alive) setLayout(l); })
        .catch(() => { /* keep what we have */ });
    };
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return layout;
}

const PANEL_KEY = 'guard:panelId';

/** Random id stored per device so the JMRI throttle name is stable across reloads. */
export function getPanelId(): string {
  try {
    const stored = localStorage.getItem(PANEL_KEY);
    if (stored) return stored;
  } catch { /* storage unavailable */ }
  const id = Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem(PANEL_KEY, id); } catch { /* storage unavailable */ }
  return id;
}
