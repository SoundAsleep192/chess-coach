import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  gradeFor,
  gradeName,
  puzzleFilter,
  puzzleLabel,
  sanLine,
  sideOf,
  sourceOrder,
} from './puzzle-logic';

describe('puzzle logic', () => {
  it('labels a puzzle by the book reference or by the requested theme', () => {
    expect(puzzleLabel({ _id: 'raduga:1-001', ref: 'Дорофеева, т.1 №1', themes: ['fork'] }, ['pin'])).toBe('Дорофеева, т.1 №1');
    expect(puzzleLabel({ _id: 'lichess:x', themes: ['mate', 'fork'] }, ['fork', 'pin'])).toBe('fork');
    expect(puzzleLabel({ _id: 'lichess:x', themes: ['mate'] }, [])).toBe('mate');
    expect(puzzleLabel({ _id: 'lichess:x', themes: [] }, [])).toBe('lichess:x');
  });

  it('filters by themes and source, never serves disputed puzzles, and prefixes fields after $lookup', () => {
    expect(puzzleFilter([], undefined)).toEqual({ disputed: { $ne: true } });
    expect(puzzleFilter(['fork'], 'raduga', 'p.')).toEqual({
      'p.disputed': { $ne: true },
      'p.themes': { $in: ['fork'] },
      'p.source': 'raduga',
    });
  });

  it('puts the books first, the one with fewer attempts ahead, Lichess last, and reads the side to move', () => {
    expect(sourceOrder({})).toEqual(['polgar', 'raduga', 'lichess']);
    expect(sourceOrder({ lichess: 0, polgar: 3, raduga: 1 })).toEqual(['raduga', 'polgar', 'lichess']);
    expect(sideOf('7k/8/8/8/8/8/8/K7 b - - 0 1')).toBe('black');
  });
});

const FORK = 'q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1';

describe('grades and answers', () => {
  it('grades a failure Again, a slow solve or one with a weaker move Hard and a clean solve Good', () => {
    expect(gradeFor(false, 1000)).toBe(Rating.Again);
    expect(gradeFor(true, 61_000)).toBe(Rating.Hard);
    expect(gradeFor(true, 59_000)).toBe(Rating.Good);
    expect(gradeFor(true, 5_000, 1)).toBe(Rating.Hard);
    expect(gradeFor(false, 5_000, 1)).toBe(Rating.Again);
    expect(gradeName(Rating.Hard)).toBe('Hard');
  });

  it('writes the solution in SAN with move numbers', () => {
    expect(sanLine(FORK, ['d5c7', 'e8d7', 'c7a8'])).toBe('1.Nc7+ Kd7 2.Nxa8');
    expect(sanLine('7k/8/8/8/8/8/3r2PP/6K1 b - - 0 30', ['d2d8'])).toBe('30...Rd8');
  });
});
