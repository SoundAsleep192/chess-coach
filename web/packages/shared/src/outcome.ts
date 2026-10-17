import { winPct, type EngineLine } from './engine.ts';

/** Классы исхода по win% решающего (модель Lichess): выигрыш от 75, перевес от 60, равно от 40, хуже от 25, ниже - проигрыш. */
export const WIN = 75;
export const ADVANTAGE = 60;
export const EQUAL_LOW = 40;
export const WORSE_LOW = 25;
/** Ход того же класса «равноценен», если уступает меньше чем столько пунктов win% (неточность из coach.toml). */
export const DEFAULT_EQUIV_GAP = 5;

export type OutcomeClass = 'mate' | 'winning' | 'advantage' | 'equal' | 'worse' | 'lost';
export type MoveVerdict = 'equal' | 'better' | 'weaker' | 'wrong';
export type Score = Pick<EngineLine, 'cp' | 'mate'>;

const RANK: Record<OutcomeClass, number> = { lost: 0, worse: 1, equal: 2, advantage: 3, winning: 4, mate: 5 };

export const OUTCOME_WORD: Record<OutcomeClass, string> = {
  mate: 'мат',
  winning: 'выигрыш',
  advantage: 'перевес',
  equal: 'равно',
  worse: 'хуже',
  lost: 'проигрыш',
};

/** Класс исхода линии; оценка - со стороны решающего (он ходит в анализируемой позиции). */
export function outcomeClass(line: Score): OutcomeClass {
  if (line.mate !== undefined) {
    if (line.mate > 0) return 'mate';
    if (line.mate < 0) return 'lost';
  }
  const w = winPct(line);
  if (w >= WIN) return 'winning';
  if (w >= ADVANTAGE) return 'advantage';
  if (w >= EQUAL_LOW) return 'equal';
  if (w >= WORSE_LOW) return 'worse';
  return 'lost';
}

/**
 * Ход ученика против ожидаемого хода в том же узле. Класс ниже - ошибка, выше - сильнее. Тот же класс: мат не длиннее
 * ожидаемого - равноценно, длиннее - слабее; иначе больше win% - сильнее, уступает меньше equivGap - равноценно, больше - слабее.
 */
export function compareMove(expected: Score, played: Score, equivGap: number = DEFAULT_EQUIV_GAP): MoveVerdict {
  const e = outcomeClass(expected);
  const p = outcomeClass(played);
  if (RANK[p] < RANK[e]) return 'wrong';
  if (RANK[p] > RANK[e]) return 'better';
  if (e === 'mate') return played.mate! <= expected.mate! ? 'equal' : 'weaker';
  const diff = winPct(played) - winPct(expected);
  if (diff > 0) return 'better';
  return -diff < equivGap ? 'equal' : 'weaker';
}
