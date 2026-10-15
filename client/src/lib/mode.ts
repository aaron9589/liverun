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

// ─── Mobile views (docs/path-requests-spec.md §3.1) ──────────────────────────
// `…/mobile` shows one of two views. The choice is saved per device; `?view=`
// deep links pick and save one.
/** 'jobs' = Crew jobs (train crews), 'board' = Running board (owner's CrewMobile). */
export type MobileView = 'jobs' | 'board';

export const MOBILE_VIEW_KEY = 'liverun.mobileView';

export interface MobileViewResult {
  /** View to render; 'pick' = show the mobile view picker. */
  view: MobileView | 'pick';
  /** A `?view=` deep link chose this: the caller saves it with saveMobileView(). */
  save?: MobileView;
  /**
   * Set when `search` had a `view` param (valid or not): the query string to
   * replace it with (that param removed; '' or '?…'), so a later Change view
   * isn't overridden on reload.
   */
  replaceSearch?: string;
}

/**
 * Pure. `?view=jobs|board` wins (and is saved); an unknown `?view=` value shows
 * the picker; otherwise the saved view, or the picker when none is saved.
 */
export function resolveMobileView(search: string, saved: MobileView | null): MobileViewResult {
  const params = new URLSearchParams(search);
  if (!params.has('view')) return { view: saved ?? 'pick' };
  const v = params.get('view');
  params.delete('view');
  const rest = params.toString();
  const replaceSearch = rest ? `?${rest}` : '';
  if (v === 'jobs' || v === 'board') return { view: v, save: v, replaceSearch };
  return { view: 'pick', replaceSearch };
}

/** Saved mobile view from localStorage['liverun.mobileView'], or null (missing, invalid, storage unavailable). */
export function loadMobileView(): MobileView | null {
  try {
    const v = localStorage.getItem(MOBILE_VIEW_KEY);
    return v === 'jobs' || v === 'board' ? v : null;
  } catch { return null; }
}

/** Saves (or with null clears) the device's mobile view. Never throws. */
export function saveMobileView(view: MobileView | null): void {
  try {
    if (view) localStorage.setItem(MOBILE_VIEW_KEY, view);
    else localStorage.removeItem(MOBILE_VIEW_KEY);
  } catch { /* storage unavailable */ }
}

/** ☰ Change view: clears the saved mobile view and reloads `<prefix>/mobile` (the picker). */
export function changeMobileView(): void {
  saveMobileView(null);
  window.location.assign(`${basePrefix(window.location.pathname)}/mobile`);
}
