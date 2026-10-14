import { describe, expect, it } from 'vitest';
import { crewInitials } from './utils';

describe('crewInitials', () => {
  it('takes the first letter of each word and keeps numbers whole', () => {
    expect(crewInitials('Local Operator 1')).toBe('LO1');
    expect(crewInitials('Local Operator 12')).toBe('LO12');
    expect(crewInitials('  aaron   stinson ')).toBe('AS');
    expect(crewInitials('Driver')).toBe('D');
  });
  it('caps the length and handles blanks', () => {
    expect(crewInitials('A B C D E')).toBe('ABCD');
    expect(crewInitials('   ')).toBe('?');
  });
});
