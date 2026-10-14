import { describe, it, expect } from 'vitest';
import { liveSyncUrl } from './live';

const at = (pathname: string, protocol = 'http:') => ({ protocol, host: 'host:3001', pathname });

describe('liveSyncUrl', () => {
  it.each([
    ['/', 'ws://host:3001/api/live/sync?id=tt'],
    ['/mobile', 'ws://host:3001/api/live/sync?id=tt'],
    ['/guard', 'ws://host:3001/api/live/sync?id=tt'],
    ['/traingraph/', 'ws://host:3001/traingraph/api/live/sync?id=tt'],
    ['/traingraph/mobile', 'ws://host:3001/traingraph/api/live/sync?id=tt'],
    ['/traingraph/guard', 'ws://host:3001/traingraph/api/live/sync?id=tt'],
  ])('derives the base from %s', (pathname, expected) => {
    expect(liveSyncUrl('tt', at(pathname))).toBe(expected);
  });

  it('uses wss on https and tolerates a trailing slash after the view', () => {
    expect(liveSyncUrl('tt', at('/traingraph/mobile/', 'https:'))).toBe('wss://host:3001/traingraph/api/live/sync?id=tt');
  });

  it('only strips a whole trailing view segment', () => {
    expect(liveSyncUrl('tt', at('/automobile'))).toBe('ws://host:3001/automobile/api/live/sync?id=tt');
  });

  it('encodes the id', () => {
    expect(liveSyncUrl('a b&c', at('/'))).toBe('ws://host:3001/api/live/sync?id=a%20b%26c');
  });
});
