import type { Document } from 'mongodb';
import type { Orientation, PuzzleDoc, PuzzleGrade, PuzzleSource } from '@board/shared';
import { Chess } from 'chess.js';
import { Rating, type Grade } from 'ts-fsrs';
import { uciMove } from './judge';

export const SOURCES: PuzzleSource[] = ['lichess', 'polgar', 'raduga', 'games'];

export function sideOf(fen: string): Orientation {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** Надпись на плашке: ссылка на книгу или тема - первая из запрошенных, что есть у задачи. */
export function puzzleLabel(p: Pick<PuzzleDoc, '_id' | 'ref' | 'themes'>, wanted: string[]): string {
  return p.ref ?? p.themes.find((t) => wanted.includes(t)) ?? p.themes[0] ?? p._id;
}

/**
 * Фильтр Mongo по темам и источнику; спорные задачи не выдаются. prefix - для полей после $lookup ('p.').
 * Явная тема (theme) фильтрует все источники. Темы по умолчанию (themes) не касаются задач из своих партий:
 * без источника это $or, а для источника games фильтра тем нет вовсе.
 */
export function puzzleFilter(q: { theme?: string; themes: string[] }, source: PuzzleSource | undefined, prefix = ''): Document {
  const filter: Document = { [`${prefix}disputed`]: { $ne: true } };
  if (q.theme) {
    filter[`${prefix}themes`] = { $in: [q.theme] };
  } else if (q.themes.length > 0 && source !== 'games') {
    const byTheme = { [`${prefix}themes`]: { $in: q.themes } };
    if (source) Object.assign(filter, byTheme);
    else filter.$or = [{ [`${prefix}source`]: 'games' }, byTheme];
  }
  if (source) filter[`${prefix}source`] = source;
  return filter;
}

export const BOOKS: PuzzleSource[] = ['polgar', 'raduga'];

/** Источники для новых задач: свои партии, затем книги (первой та, где у ученика меньше попыток), Lichess - последним. */
export function sourceOrder(attempts: Partial<Record<PuzzleSource, number>>): PuzzleSource[] {
  return ['games', ...[...BOOKS].sort((a, b) => (attempts[a] ?? 0) - (attempts[b] ?? 0)), 'lichess'];
}

export const HARD_AFTER_MS = 60_000;

/** Ошибка или «Показать решение» - Again; решено с ходом «слабее» или дольше минуты - Hard; чисто - Good. */
export function gradeFor(correct: boolean, ms: number, weaker = 0): Grade {
  if (!correct) return Rating.Again;
  return weaker > 0 || ms > HARD_AFTER_MS ? Rating.Hard : Rating.Good;
}

export function gradeName(grade: Grade): PuzzleGrade {
  return grade === Rating.Again ? 'Again' : grade === Rating.Hard ? 'Hard' : 'Good';
}

/** Линия в SAN с номерами ходов от позиции fen: «1.Nc7+ Kd7 2.Nxa8», «30...Rd8». */
export function sanLine(fen: string, ucis: string[]): string {
  const chess = new Chess(fen);
  return ucis
    .map((uci, i) => {
      const [, turn, , , , full] = chess.fen().split(' ');
      const san = chess.move(uciMove(uci)).san;
      if (turn === 'w') return `${full}.${san}`;
      return i === 0 ? `${full}...${san}` : san;
    })
    .join(' ');
}
