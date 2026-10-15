import { describe, expect, it } from 'vitest';
import { alternativesLeft } from './puzzle.ts';

describe('alternativesLeft', () => {
  it('offers another solution while a first move from the solution or the alternatives is not found', () => {
    expect(alternativesLeft({ solution: ['a1a8'], rootAlternatives: [], found: ['a1a8'] })).toBe(false);
    expect(alternativesLeft({ solution: ['a1a8'], rootAlternatives: ['b1b8'], found: ['a1a8'] })).toBe(true);
    expect(alternativesLeft({ solution: ['a1a8'], rootAlternatives: ['b1b8'], found: ['a1a8', 'b1b8'] })).toBe(false);
    expect(alternativesLeft({ solution: ['d5c7'], rootAlternatives: [], found: ['d5f6'] })).toBe(true);
  });
});
