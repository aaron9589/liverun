import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveMode, basePrefix, modeUrl, resolveMobileView, loadMobileView, saveMobileView, MOBILE_VIEW_KEY,
} from './mode';

const r = (pathname: string, search = '', savedMode: 'guard' | 'crew' | 'planner' | null = null, isMobileUA = false) =>
  resolveMode({ pathname, search, savedMode, isMobileUA });

describe.each(['', '/traingraph'])('resolveMode with prefix %j', (p) => {
  it('explicit paths win over saved mode', () => {
    expect(r(`${p}/guard`, '', 'crew')).toEqual({ view: 'guard' });
    expect(r(`${p}/guard/`, '', 'planner')).toEqual({ view: 'guard' });
    expect(r(`${p}/mobile`, '', 'guard')).toEqual({ view: 'crew' });
  });
  it('?desktop and ?choose override saved mode', () => {
    expect(r(`${p}/`, '?desktop', 'guard', true)).toEqual({ view: 'planner' });
    expect(r(`${p}/`, '?choose', 'guard')).toEqual({ view: 'choose' });
  });
  it('saved mode redirects via replacePath', () => {
    expect(r(`${p}/`, '', 'guard')).toEqual({ view: 'guard', replacePath: `${p}/guard` });
    expect(r(p || '/', '', 'crew')).toEqual({ view: 'crew', replacePath: `${p}/mobile` });
    expect(r(`${p}/`, '', 'planner')).toEqual({ view: 'planner' });
  });
  it('no saved mode: mobile UA chooses, desktop is planner', () => {
    expect(r(`${p}/`, '', null, true)).toEqual({ view: 'choose' });
    expect(r(`${p}/`, '', null, false)).toEqual({ view: 'planner' });
  });
  it('builds mode urls', () => {
    expect(modeUrl('guard', `${p}/`)).toBe(`${p}/guard`);
    expect(modeUrl('planner', `${p}/guard`)).toBe(`${p}/?desktop`);
  });
});

describe('basePrefix', () => {
  it('strips mode segment and slashes', () => {
    expect(basePrefix('/traingraph/guard/')).toBe('/traingraph');
    expect(basePrefix('/')).toBe('');
  });
});

describe('resolveMobileView', () => {
  it('no view param: saved view, else picker, no replaceSearch', () => {
    expect(resolveMobileView('', 'jobs')).toEqual({ view: 'jobs' });
    expect(resolveMobileView('', 'board')).toEqual({ view: 'board' });
    expect(resolveMobileView('', null)).toEqual({ view: 'pick' });
    expect(resolveMobileView('?x=1', null)).toEqual({ view: 'pick' });
  });
  it('?view= wins over saved, is saved, and is stripped', () => {
    expect(resolveMobileView('?view=jobs', 'board')).toEqual({ view: 'jobs', save: 'jobs', replaceSearch: '' });
    expect(resolveMobileView('?view=board', null)).toEqual({ view: 'board', save: 'board', replaceSearch: '' });
  });
  it('keeps other params', () => {
    expect(resolveMobileView('?a=1&view=jobs&b=2', null)).toEqual({ view: 'jobs', save: 'jobs', replaceSearch: '?a=1&b=2' });
  });
  it('unknown or empty view shows the picker, even with a saved view', () => {
    expect(resolveMobileView('?view=nope', 'jobs')).toEqual({ view: 'pick', replaceSearch: '' });
    expect(resolveMobileView('?view=', 'board')).toEqual({ view: 'pick', replaceSearch: '' });
    expect(resolveMobileView('?view&a=1', null)).toEqual({ view: 'pick', replaceSearch: '?a=1' });
    expect(resolveMobileView('?view=JOBS', null)).toEqual({ view: 'pick', replaceSearch: '' });
  });
});

describe('load/saveMobileView', () => {
  const stub = (initial: Record<string, string> = {}) => {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    return store;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips and clears', () => {
    const store = stub();
    expect(loadMobileView()).toBeNull();
    saveMobileView('jobs');
    expect(store.get(MOBILE_VIEW_KEY)).toBe('jobs');
    expect(loadMobileView()).toBe('jobs');
    saveMobileView('board');
    expect(loadMobileView()).toBe('board');
    saveMobileView(null);
    expect(loadMobileView()).toBeNull();
  });
  it('ignores an invalid stored value', () => {
    stub({ [MOBILE_VIEW_KEY]: 'garbage' });
    expect(loadMobileView()).toBeNull();
  });
  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(loadMobileView()).toBeNull();
    expect(() => saveMobileView('jobs')).not.toThrow();
    expect(() => saveMobileView(null)).not.toThrow();
  });
});
