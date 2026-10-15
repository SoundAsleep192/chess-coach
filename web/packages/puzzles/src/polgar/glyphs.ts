/** Глифы фигур на тёмных полях -> буквы FEN. На светлых полях глиф совпадает с буквой FEN. */
export const DARK_GLYPHS: Record<string, string> = {
  J: 'K', L: 'Q', S: 'R', A: 'B', M: 'N', O: 'P',
  j: 'k', l: 'q', s: 'r', a: 'b', m: 'n', o: 'p',
};
const LIGHT_PIECES = 'KQRBNPkqrbnp';

export class GlyphError extends Error {
  name = 'GlyphError';
}

/** 8 строк шрифта (сверху 8-я горизонталь) -> поле расстановки FEN. Тёмное поле: (столбец + строка сверху) нечётно. */
export function rowsToPlacement(rows: string[]): string {
  if (rows.length !== 8) throw new GlyphError(`expected 8 rows, got ${rows.length}`);
  return rows
    .map((row, r) => {
      let out = '';
      let empty = 0;
      [...row].forEach((ch, f) => {
        const dark = (f + r) % 2 === 1;
        let piece: string | null;
        if (ch === '0' || ch === 'Z') {
          if ((ch === 'Z') !== dark) {
            throw new GlyphError(`rank ${8 - r}: empty-square glyph ${ch} on a ${dark ? 'dark' : 'light'} square`);
          }
          piece = null;
        } else if (dark && DARK_GLYPHS[ch]) {
          piece = DARK_GLYPHS[ch];
        } else if (!dark && LIGHT_PIECES.includes(ch)) {
          piece = ch;
        } else {
          throw new GlyphError(`rank ${8 - r}: glyph ${ch} cannot stand on a ${dark ? 'dark' : 'light'} square`);
        }
        if (piece) {
          if (empty) out += String(empty);
          empty = 0;
          out += piece;
        } else {
          empty += 1;
        }
      });
      return out + (empty ? String(empty) : '');
    })
    .join('/');
}
