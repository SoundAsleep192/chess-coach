import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  candidatesOf,
  gameRef,
  positionKey,
  puzzleId,
  readReviews,
  type ReviewFile,
  type ReviewMove,
} from './review.ts';

function mv(ply: number, cls: ReviewMove['class'], missed = false): ReviewMove {
  return {
    ply,
    color: ply % 2 === 1 ? 'white' : 'black',
    san: `m${ply}`,
    uci: `u${ply}`,
    fen_before: `fen${ply} w - - 0 1`,
    class: cls,
    missed_chance: missed,
  };
}

function review(moves: ReviewMove[], meta: ReviewFile['meta'] = { color: 'black', date: '2026-09-21T15:01:19' }): ReviewFile {
  return { id: 'G1', meta, moves };
}

describe('candidatesOf', () => {
  it('takes mistakes, blunders and missed chances of the student only', () => {
    const r = review([
      mv(1, 'blunder'), // белые, ученик чёрными - нет
      mv(2, 'mistake'), // да
      mv(4, 'inaccuracy'), // нет
      mv(6, 'inaccuracy', true), // да
      mv(8, 'blunder'), // да
      mv(10, 'ok'), // нет
    ]);
    const got = candidatesOf(r);
    expect(got.map((c) => c.ply)).toEqual([2, 6, 8]);
    expect(got[0]).toEqual({
      gameId: 'G1',
      ply: 2,
      fen: 'fen2 w - - 0 1',
      played: 'u2',
      gameDate: '2026-09-21T15:01:19',
      ref: 'Партия, 21.09.2026, 1...',
    });
  });

  it('uses the opponent in the ref and keeps the date string as is', () => {
    const r = review([mv(2, 'blunder')], { color: 'black', date: '2025-11-09T00:00:00', opponent: 'Хаглышов' });
    const [c] = candidatesOf(r);
    expect(c.gameDate).toBe('2025-11-09T00:00:00');
    expect(c.ref).toBe('Партия с Хаглышов, 09.11.2025, 1...');
  });

  it('falls back to the epoch date and omits the date in the ref', () => {
    const [c] = candidatesOf(review([mv(2, 'blunder')], { color: 'black' }));
    expect(c.gameDate).toBe('1970-01-01T00:00:00');
    expect(c.ref).toBe('Партия, 1...');
  });

  it('throws without meta.color', () => {
    expect(() => candidatesOf(review([mv(2, 'blunder')], {}))).toThrow();
  });
});

describe('ids and refs', () => {
  it('puzzleId pads ply to three digits', () => expect(puzzleId('Mp0A6gfU', 36)).toBe('games:Mp0A6gfU-036'));

  it('ref for black and white moves', () => {
    expect(gameRef('fishbate', '2026-09-21T15:01:19', 36)).toBe('Партия с fishbate, 21.09.2026, 18...');
    expect(gameRef('Хаглышов', '2025-11-09T00:00:00', 35)).toBe('Партия с Хаглышов, 09.11.2025, 18.');
  });

  it('ref without opponent', () => expect(gameRef(undefined, '2025-11-09T00:00:00', 1)).toBe('Партия, 09.11.2025, 1.'));

  it('positionKey ignores move counters', () => {
    const a = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const b = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 12';
    expect(positionKey(a)).toBe(positionKey(b));
    expect(positionKey(a)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    expect(positionKey(a)).not.toBe(positionKey(a.replace(' w ', ' b ')));
  });
});

describe('readReviews', () => {
  function dir(): string {
    const d = mkdtempSync(join(tmpdir(), 'reviews-'));
    writeFileSync(join(d, 'a.json'), JSON.stringify(review([mv(2, 'blunder')])));
    writeFileSync(join(d, 'a.notes.json'), JSON.stringify({ _summary: 'x' }));
    writeFileSync(join(d, 'b.json'), '{not json');
    return d;
  }

  it('skips *.notes.json and reports broken JSON', () => {
    const { reviews, bad } = readReviews(dir());
    expect(reviews.map((r) => r.id)).toEqual(['G1']);
    expect(bad).toHaveLength(1);
    expect(bad[0].file).toBe('b.json');
    expect(bad[0].detail).not.toBe('');
  });

  it('with only reads one file', () => {
    const { reviews, bad } = readReviews(dir(), 'a');
    expect(reviews).toHaveLength(1);
    expect(bad).toEqual([]);
  });

  it('with only reports a missing file', () => {
    const { reviews, bad } = readReviews(dir(), 'zzz');
    expect(reviews).toEqual([]);
    expect(bad.map((b) => b.file)).toEqual(['zzz.json']);
  });
});
