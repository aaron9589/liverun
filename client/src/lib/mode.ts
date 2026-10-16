/**
 * The chooser's apps: 'jobs' = Train Crew App (CrewJobs), 'board' = Crewing Manager
 * (CrewMobile), 'guard' = Guard Panel, 'planner' = Train Graph.
 */
export type SavedMode = 'jobs' | 'board' | 'guard' | 'planner';
export type View = SavedMode | 'choose';

export const MODE_KEY = 'liverun.mode';

const MODES: readonly SavedMode[] = ['jobs', 'board', 'guard', 'planner'];
const isMode = (v: unknown): v is SavedMode => MODES.includes(v as SavedMode);

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

/**
 * Entry routing. Explicit pages win: `/guard`, `/mobile?view=jobs|board` (any other
 * `/mobile` shows the chooser), `?desktop`, `?choose`. Otherwise a phone always gets
 * the chooser (its home page); a desktop gets its saved mode, else the Train Graph.
 */
export function resolveMode({ pathname, search, savedMode, isMobileUA }: ResolveInput): { view: View; replacePath?: string } {
  const params = new URLSearchParams(search);
  if (/\/guard\/*$/.test(pathname)) return { view: 'guard' };
  if (/\/mobile\/*$/.test(pathname)) {
    const v = params.get('view');
    return { view: v === 'jobs' || v === 'board' ? v : 'choose' };
  }
  if (params.has('desktop')) return { view: 'planner' };
  if (params.has('choose') || isMobileUA) return { view: 'choose' };
  if (savedMode && savedMode !== 'planner') return { view: savedMode, replacePath: modeUrl(savedMode, pathname) };
  return { view: 'planner' };
}

export function loadSavedMode(): SavedMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return isMode(v) ? v : null; // the old 'crew' value is dropped
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
  if (mode === 'jobs' || mode === 'board') return `${prefix}/mobile?view=${mode}`;
  return `${prefix}/?desktop`;
}

/** Switch mode: clears the saved mode and returns to the chooser. */
export function switchMode(): void {
  saveMode(null);
  window.location.assign(`${basePrefix(window.location.pathname)}/?choose`);
}
