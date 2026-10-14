export type SavedMode = 'guard' | 'crew' | 'planner';
export type View = 'planner' | 'crew' | 'guard' | 'choose';

export const MODE_KEY = 'liverun.mode';

export interface ResolveInput {
  pathname: string;
  search: string;
  savedMode: SavedMode | null;
  isMobileUA: boolean;
}

/** Deployment prefix ('' or e.g. '/traingraph'): pathname minus a trailing /guard, /mobile and slashes. */
export function basePrefix(pathname: string): string {
  return pathname.replace(/\/(guard|mobile)\/*$/, '').replace(/\/+$/, '');
}

/** Entry routing table, docs/guard-panel-spec.md §5.1. */
export function resolveMode({ pathname, search, savedMode, isMobileUA }: ResolveInput): { view: View; replacePath?: string } {
  if (/\/guard\/*$/.test(pathname)) return { view: 'guard' };
  if (/\/mobile\/*$/.test(pathname)) return { view: 'crew' };
  const params = new URLSearchParams(search);
  if (params.has('desktop')) return { view: 'planner' };
  if (params.has('choose')) return { view: 'choose' };
  const prefix = basePrefix(pathname);
  if (savedMode === 'guard') return { view: 'guard', replacePath: `${prefix}/guard` };
  if (savedMode === 'crew') return { view: 'crew', replacePath: `${prefix}/mobile` };
  if (savedMode === 'planner') return { view: 'planner' };
  return { view: isMobileUA ? 'choose' : 'planner' };
}

export function loadSavedMode(): SavedMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'guard' || v === 'crew' || v === 'planner' ? v : null;
  } catch { return null; }
}

export function saveMode(mode: SavedMode | null): void {
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch { /* storage unavailable */ }
}

/** URL (relative to the deployment prefix) for a mode's page. */
export function modeUrl(mode: SavedMode, pathname: string = window.location.pathname): string {
  const prefix = basePrefix(pathname);
  if (mode === 'guard') return `${prefix}/guard`;
  if (mode === 'crew') return `${prefix}/mobile`;
  return `${prefix}/?desktop`;
}

/** Clears the saved mode and returns to the picker. */
export function switchMode(): void {
  saveMode(null);
  window.location.assign(`${basePrefix(window.location.pathname)}/?choose`);
}
