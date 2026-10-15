import type { Side } from '../chess-utils.ts';

export interface PolgarChapter {
  from: number;
  to: number;
  name: string;
  themes?: string[];
  /** Сторона хода по названию главы, если в ответе её нет. */
  side?: Side;
  /** Почему глава не идёт в задачи. */
  skip?: string;
}

export const POLGAR_TOTAL = 5334;

export const POLGAR_CHAPTERS: PolgarChapter[] = [
  { from: 1, to: 306, name: 'Mate in 1', themes: ['mate', 'mateIn1'] },
  { from: 307, to: 450, name: 'White to Move #2', themes: ['mate', 'mateIn2'], side: 'w' },
  { from: 451, to: 3718, name: 'Combinations #2', themes: ['mate', 'mateIn2'] },
  { from: 3719, to: 4462, name: 'Combinations #3', themes: ['mate', 'mateIn3'] },
  { from: 4463, to: 5062, name: 'Miniature games', skip: 'ответ - вся партия с первого хода' },
  { from: 5063, to: 5104, name: 'White draws', skip: 'этюд на ничью: доска не умеет засчитывать ничью' },
  { from: 5105, to: 5206, name: 'White wins', themes: ['endgame'], side: 'w' },
  { from: 5207, to: 5334, name: "Polgár sisters' combinations", themes: [] },
];

export function polgarChapter(n: number): PolgarChapter {
  const chapter = POLGAR_CHAPTERS.find((c) => n >= c.from && n <= c.to);
  if (!chapter) throw new Error(`no Polgar chapter for problem ${n}`);
  return chapter;
}
