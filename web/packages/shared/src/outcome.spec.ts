import { describe, expect, it, vi } from 'vitest';
import { winPct } from './engine.ts';
import { compareMove, DEFAULT_EQUIV_GAP, OUTCOME_WORD, outcomeClass } from './outcome.ts';

describe('outcomeClass', () => {
  it('splits win% at 75, 60, 40 and 25 and treats a mate for the solver as its own class', () => {
    expect(outcomeClass({ mate: 3 })).toBe('mate');
    expect(outcomeClass({ cp: 300 })).toBe('winning');
    expect(outcomeClass({ cp: 290 })).toBe('advantage');
    expect(outcomeClass({ cp: 120 })).toBe('advantage');
    expect(outcomeClass({ cp: 110 })).toBe('equal');
    expect(outcomeClass({ cp: -110 })).toBe('equal');
    expect(outcomeClass({ cp: -120 })).toBe('worse');
  });

  it('lost: mate against the solver or win% below 25', () => {
    expect(outcomeClass({ mate: -3 })).toBe('lost');
    expect(outcomeClass({ cp: -400 })).toBe('lost'); // winPct ≈ 19
    expect(outcomeClass({ cp: -150 })).toBe('worse'); // winPct ≈ 36
  });

  it('boundary worse/lost is win% 25', () => {
    expect(winPct({ cp: -297 })).toBeGreaterThanOrEqual(25);
    expect(outcomeClass({ cp: -297 })).toBe('worse');
    expect(winPct({ cp: -300 })).toBeLessThan(25);
    expect(outcomeClass({ cp: -300 })).toBe('lost');
  });

  it('has a word for every class', () => {
    expect(OUTCOME_WORD.lost).toBe('проигрыш');
    expect(Object.keys(OUTCOME_WORD).sort()).toEqual(['advantage', 'equal', 'lost', 'mate', 'winning', 'worse']);
  });
});

describe('compareMove', () => {
  it('compares mates by length', () => {
    expect(compareMove({ mate: 2 }, { mate: 2 })).toBe('equal');
    expect(compareMove({ mate: 2 }, { mate: 1 })).toBe('equal');
    expect(compareMove({ mate: 2 }, { mate: 3 })).toBe('weaker');
    expect(compareMove({ mate: 2 }, { cp: 900 })).toBe('wrong');
  });

  it('inside a class: within 5 points equal, further weaker, higher better; a lower class is wrong', () => {
    expect(compareMove({ cp: 900 }, { cp: 800 })).toBe('equal');
    expect(compareMove({ cp: 400 }, { cp: 350 })).toBe('equal');
    expect(compareMove({ cp: 400 }, { cp: 300 })).toBe('weaker');
    expect(compareMove({ cp: 900 }, { cp: 1000 })).toBe('better');
    expect(compareMove({ cp: 150 }, { mate: 4 })).toBe('better');
    expect(compareMove({ cp: 900 }, { cp: 0 })).toBe('wrong');
    expect(compareMove({ cp: 900 }, { cp: 290 })).toBe('wrong');
  });

  it('worse -> lost is wrong, lost -> lost (longer mate) is not wrong', () => {
    expect(compareMove({ cp: -150 }, { mate: -2 })).toBe('wrong');
    expect(compareMove({ cp: -500 }, { mate: -4 })).not.toBe('wrong');
  });

  it('equivGap is a parameter, default 5', () => {
    const expected = { cp: 0 };
    const played = { cp: -70 }; // yields about 6.4 points, both in the equal class
    expect(DEFAULT_EQUIV_GAP).toBe(5);
    expect(compareMove(expected, played)).toBe('weaker');
    expect(compareMove(expected, played, 5)).toBe('weaker');
    expect(compareMove(expected, played, 10)).toBe('equal');
  });
});

describe('environment', () => {
  it('does not touch process.env', async () => {
    vi.resetModules();
    vi.stubGlobal('process', undefined);
    try {
      const mod = await import('./outcome.ts');
      expect(mod.compareMove({ cp: 0 }, { cp: 0 })).toBe('equal');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
