const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Материал белых минус материал чёрных в пешках (P 1, N 3, B 3, R 5, Q 9) по расстановке FEN. */
export function materialBalance(fen: string): number {
  let sum = 0;
  for (const ch of fen.split(' ')[0]) {
    const value = VALUES[ch.toLowerCase()];
    if (value === undefined) continue;
    sum += ch === ch.toLowerCase() ? -value : value;
  }
  return sum;
}

/** «Вы теряете ...»: пешку, две пешки, фигуру, ладью, ферзя, иначе «N пешек» с верным окончанием. */
export function materialWord(pawns: number): string {
  const named: Record<number, string> = { 1: 'пешку', 2: 'две пешки', 3: 'фигуру', 5: 'ладью', 9: 'ферзя' };
  if (named[pawns]) return named[pawns];
  const n10 = pawns % 10;
  const n100 = pawns % 100;
  const word = n10 === 1 && n100 !== 11 ? 'пешку' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'пешки' : 'пешек';
  return `${pawns} ${word}`;
}
