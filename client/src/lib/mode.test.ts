import { describe, it, expect } from 'vitest';
import { resolveMode, basePrefix, modeUrl, type SavedMode } from './mode';

const r = (pathname: string, search = '', savedMode: SavedMode | null = null, isMobileUA = false) =>
  resolveMode({ pathname, search, savedMode, isMobileUA });

describe.each(['', '/traingraph'])('resolveMode with prefix %j', (p) => {
  it('explicit paths win over saved mode and the device', () => {
    expect(r(`${p}/guard`, '', 'jobs')).toEqual({ view: 'guard' });
    expect(r(`${p}/guard/`, '', 'planner', true)).toEqual({ view: 'guard' });
    expect(r(`${p}/mobile`, '?view=jobs', 'guard')).toEqual({ view: 'jobs' });
    expect(r(`${p}/mobile`, '?id=x&view=board', null, true)).toEqual({ view: 'board' });
  });
  it('/mobile without a valid view shows the chooser', () => {
    expect(r(`${p}/mobile`, '', 'board')).toEqual({ view: 'choose' });
    expect(r(`${p}/mobile/`, '?view=nope', null, true)).toEqual({ view: 'choose' });
  });
  it('?desktop and ?choose override saved mode', () => {
    expect(r(`${p}/`, '?desktop', 'guard', true)).toEqual({ view: 'planner' });
    expect(r(`${p}/`, '?choose', 'guard')).toEqual({ view: 'choose' });
  });
  it('a phone always gets the chooser at home, whatever was saved', () => {
    expect(r(`${p}/`, '', null, true)).toEqual({ view: 'choose' });
    expect(r(`${p}/`, '', 'board', true)).toEqual({ view: 'choose' });
    expect(r(`${p}/`, '', 'guard', true)).toEqual({ view: 'choose' });
  });
  it('a desktop follows its saved mode via replacePath, else the Train Graph', () => {
    expect(r(`${p}/`, '', 'guard')).toEqual({ view: 'guard', replacePath: `${p}/guard` });
    expect(r(p || '/', '', 'jobs')).toEqual({ view: 'jobs', replacePath: `${p}/mobile?view=jobs` });
    expect(r(`${p}/`, '', 'board')).toEqual({ view: 'board', replacePath: `${p}/mobile?view=board` });
    expect(r(`${p}/`, '', 'planner')).toEqual({ view: 'planner' });
    expect(r(`${p}/`, '', null)).toEqual({ view: 'planner' });
  });
  it('builds mode urls', () => {
    expect(modeUrl('guard', `${p}/`)).toBe(`${p}/guard`);
    expect(modeUrl('jobs', `${p}/mobile`)).toBe(`${p}/mobile?view=jobs`);
    expect(modeUrl('board', `${p}/guard`)).toBe(`${p}/mobile?view=board`);
    expect(modeUrl('planner', `${p}/guard`)).toBe(`${p}/?desktop`);
  });
});

describe('basePrefix', () => {
  it('strips mode segment and slashes', () => {
    expect(basePrefix('/traingraph/guard/')).toBe('/traingraph');
    expect(basePrefix('/traingraph/mobile')).toBe('/traingraph');
    expect(basePrefix('/')).toBe('');
  });
});
