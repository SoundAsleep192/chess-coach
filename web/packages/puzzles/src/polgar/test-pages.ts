import { DARK_GLYPHS } from './glyphs.ts';

const TO_DARK = Object.fromEntries(Object.entries(DARK_GLYPHS).map(([glyph, piece]) => [piece, glyph]));

/** Позиция -> 8 строк шрифта диаграмм (обратное к rowsToPlacement). */
export function encode(placement: string): string[] {
  return placement.split('/').map((rank, r) => {
    const cells = [...rank].flatMap((c) => (/\d/.test(c) ? Array<string>(Number(c)).fill('') : [c]));
    return cells
      .map((piece, f) => {
        const dark = (f + r) % 2 === 1;
        if (!piece) return dark ? 'Z' : '0';
        return dark ? TO_DARK[piece] : piece;
      })
      .join('');
  });
}

/** Слова pdftotext -bbox одной диаграммы: номер над доской, цифры горизонталей слева, 8 строк. */
export function diagramWords(number: number, x: number, y: number, placement: string): string {
  const words = [`<word xMin="${x + 40}" yMin="${y}" xMax="${x + 50}" yMax="${y + 12}">${number}</word>`];
  encode(placement).forEach((row, i) => {
    const top = y + 20 + i * 14;
    words.push(`<word xMin="${x - 12}" yMin="${top}" xMax="${x - 6}" yMax="${top + 12}">${8 - i}</word>`);
    words.push(`<word xMin="${x}" yMin="${top}" xMax="${x + 100}" yMax="${top + 12}">${row}</word>`);
  });
  return words.join('\n');
}

export function page(...diagrams: string[]): string {
  return `<page width="612.000000" height="792.000000">\n${diagrams.join('\n')}\n</page>\n`;
}
