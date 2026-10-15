import { describe, it, expect } from 'vitest';
import { resolveMode, basePrefix, modeUrl } from './mode';

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
