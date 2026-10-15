import { Chess } from 'chess.js';
import type { PuzzleDoc, PuzzleGrade, PuzzleSource } from '@board/shared';
import { engine } from './helpers';

/** Позиция после ходов UCI. */
export function fenAfter(fen: string, ucis: string[]): string {
  const chess = new Chess(fen);
  for (const u of ucis) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return chess.fen();
}

/** Детский мат: 4.Qxf7#. */
export const MATE1: PuzzleDoc = {
  _id: 'lichess:mate1',
  source: 'lichess',
  fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  solution: ['h5f7'],
  themes: ['mate', 'mateIn1', 'short'],
  rating: 1500,
  solutionFrom: 'lichess',
};

export const HIGH: PuzzleDoc = { ...MATE1, _id: 'lichess:high', rating: 2300 };

/** Мат в 2: 1.Kg6 Kg8 2.Ra8#. */
export const MATE2: PuzzleDoc = {
  _id: 'polgar:0307',
  source: 'polgar',
  fen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
  solution: ['f6g6', 'h8g8', 'a1a8'],
  themes: ['mate', 'mateIn2'],
  themesRaw: ['White to Move #2'],
  ref: 'Полгар №307',
  page: 120,
  solutionFrom: 'book',
};

/** Мат в 1, где матуют обе ладьи: Ra8# по решению, Rb8# - другой мат. */
export const TWO_ROOKS: PuzzleDoc = {
  _id: 'polgar:0001',
  source: 'polgar',
  fen: '7k/8/6K1/8/8/8/8/RR6 w - - 0 1',
  solution: ['a1a8'],
  themes: ['mate', 'mateIn1'],
  themesRaw: ['Mate in 1'],
  ref: 'Полгар №1',
  page: 16,
  solutionFrom: 'book',
};

/** Вилка: 1.Nc7+ Kd7 2.Nxa8. */
export const FORK: PuzzleDoc = {
  _id: 'raduga:1-1-001',
  source: 'raduga',
  fen: 'q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1',
  solution: ['d5c7', 'e8d7', 'c7a8'],
  themes: ['fork'],
  themesRaw: ['Двойной удар'],
  ref: 'Дорофеева, т.1, ч.1 №1',
  page: 7,
  solutionFrom: 'book',
};

/** Мат в 1 (Qe8#), а Qf7 - пат. */
export const STALEMATE_TRAP: PuzzleDoc = {
  _id: 'polgar:0002',
  source: 'polgar',
  fen: '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1',
  solution: ['e7e8'],
  themes: ['mate', 'mateIn1'],
  ref: 'Полгар №2',
  page: 16,
  solutionFrom: 'book',
};

/** Линии движка для FORK: Nc7+ лучший, Nf6+ в тройку не входит и проигрывает (опровержение Ke7, угроза Qa1+). */
export const FORK_ROOT = [
  { move: 'd5c7', cp: 900, pv: ['d5c7', 'e8d7', 'c7a8'] },
  { move: 'd5b6', cp: 0, pv: ['d5b6', 'a8a1'] },
  { move: 'g1g2', cp: -50, pv: ['g1g2'] },
];
export const FORK_NF6 = [{ move: 'd5f6', cp: -800, pv: ['d5f6', 'e8e7', 'f6g4', 'a8a1'] }];

/** FORK с записанным анализом корня и хода Nf6+. */
export function forkEngine(): void {
  engine.on(FORK.fen, FORK_ROOT).on(FORK.fen, FORK_NF6, ['d5f6']);
}

/** Линии для MATE2: Ra7 тоже матует, но длиннее. */
export const MATE2_ROOT = [
  { move: 'f6g6', mate: 2, pv: ['f6g6', 'h8g8', 'a1a8'] },
  { move: 'a1a7', mate: 3, pv: ['a1a7', 'h8g8'] },
  { move: 'f6f7', cp: 0, pv: ['f6f7'] },
];

export const DISPUTED: PuzzleDoc = { ...FORK, _id: 'raduga:1-1-002', ref: 'Дорофеева, т.1, ч.1 №2', disputed: true };

/** Карточка FSRS в форме коллекции cards. */
export function card(
  id: string,
  source: PuzzleSource,
  themes: string[],
  due: Date,
  history: { at: Date; correct: boolean; ms?: number; grade?: PuzzleGrade }[] = [{ at: due, correct: false }],
  ref?: string,
) {
  return {
    _id: id,
    source,
    themes,
    ...(ref ? { ref } : {}),
    due,
    stability: 1,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: history.length,
    lapses: 0,
    state: 1,
    last_review: history.at(-1)?.at ?? due,
    history: history.map((h) => ({ at: h.at, correct: h.correct, ms: h.ms ?? 5000, grade: h.grade ?? (h.correct ? 'Good' : 'Again') })),
  };
}
