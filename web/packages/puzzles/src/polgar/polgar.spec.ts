import { describe, expect, it } from 'vitest';
import { findDiagrams, parseBBox } from './bbox.ts';
import { polgarChapter } from './chapters.ts';
import { DARK_GLYPHS, GlyphError, rowsToPlacement } from './glyphs.ts';
import { parseSolutions } from './solutions.ts';
import { encode, page, diagramWords } from './test-pages.ts';

describe('rowsToPlacement', () => {
  it('decodes the chess font: light and dark squares, empty squares of both colours', () => {
    const placement = 'r3k2r/pp3ppp/2n5/3Qp3/8/2N5/PPP2PPP/R3K2R';
    expect(rowsToPlacement(encode(placement))).toBe(placement);
    expect(DARK_GLYPHS.J).toBe('K');
  });

  it('rejects a glyph that cannot stand on that square colour', () => {
    expect(() => rowsToPlacement(['0K0Z0Z0Z', ...encode('8/8/8/8/8/8/8/8').slice(1)])).toThrow(GlyphError);
    expect(() => rowsToPlacement(['ZZ0Z0Z0Z', ...encode('8/8/8/8/8/8/8/8').slice(1)])).toThrow(/empty-square glyph Z/);
  });
});

describe('findDiagrams', () => {
  it('takes the number right above the top row and ignores rank digits', () => {
    const html = `<doc>${page(diagramWords(25, 50, 80, '7k/8/6K1/8/8/8/8/R7'), diagramWords(28, 300, 80, '8/8/8/8/8/8/8/8'))}</doc>`;
    const [words] = parseBBox(html);
    const found = findDiagrams(words, 20);
    expect(found.map((d) => [d.number, d.page])).toEqual([[25, 20], [28, 20]]);
    expect(rowsToPlacement(found[0].rows)).toBe('7k/8/6K1/8/8/8/8/R7');
  });
});

describe('parseSolutions', () => {
  it('joins wrapped lines and cuts the running header', () => {
    const text = [
      '5334 Problems, Combinations & Games 8.1 Solutions',
      '1 1.Qh7m',
      '2 1...Qa5+ 2.KXb1 ( 2.NXa5',
      'RXc3m ) 2...Rb8m',
      '3 3.Re7 BXe2 4.Re8+ +–5334 Problems, Combinations & Games 8.1 Solutions',
      '4 1.Ra8m',
    ].join('\n');
    const s = parseSolutions(text);
    expect([...s.keys()]).toEqual([1, 2, 3, 4]);
    expect(s.get(2)).toBe('1...Qa5+ 2.KXb1 ( 2.NXa5 RXc3m ) 2...Rb8m');
    expect(s.get(3)).toBe('3.Re7 BXe2 4.Re8+ +–');
  });
});

describe('polgarChapter', () => {
  it('gives themes, side and skipped chapters by number', () => {
    expect(polgarChapter(306)).toMatchObject({ name: 'Mate in 1', themes: ['mate', 'mateIn1'] });
    expect(polgarChapter(307)).toMatchObject({ themes: ['mate', 'mateIn2'], side: 'w' });
    expect(polgarChapter(4000)).toMatchObject({ themes: ['mate', 'mateIn3'] });
    expect(polgarChapter(4470).skip).toBeDefined();
    expect(polgarChapter(5100).skip).toBeDefined();
    expect(polgarChapter(5200)).toMatchObject({ themes: ['endgame'], side: 'w' });
    expect(polgarChapter(5334).themes).toEqual([]);
  });
});
