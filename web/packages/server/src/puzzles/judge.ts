import { Chess } from 'chess.js';
import {
  compareMove as compareMoveWith,
  DEFAULT_EQUIV_GAP,
  materialBalance,
  materialWord,
  OUTCOME_WORD,
  outcomeClass,
  type Arrow,
  type EngineLine,
  type MoveVerdict,
  type OutcomeClass,
  type Score,
} from '@board/shared';

/** Ход того же класса «равноценен», если уступает меньше чем столько пунктов win% (неточность из coach.toml). */
export const EQUIV_GAP = Number(process.env.PUZZLE_EQUIV_GAP ?? DEFAULT_EQUIV_GAP);

export type { MoveVerdict, OutcomeClass, Score };
/** Чем кончилась партия после хода: мат, ничья (пат, мало материала, повторение, 50 ходов) или ничем. */
export type Terminal = 'checkmate' | 'draw' | null;

const MINUS = '−';

export function uciMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}
export const arrow = (uci: string, color: Arrow['color']): Arrow => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), color });

/** Оценка позиции после хода, который кончил партию ничьей: win% 50. */
export const DRAW_SCORE: Score = { cp: 0 };

export { outcomeClass };

/** Сравнение хода с ожидаемым; порог равноценности - EQUIV_GAP из PUZZLE_EQUIV_GAP. */
export const compareMove = (expected: Score, played: Score): MoveVerdict => compareMoveWith(expected, played, EQUIV_GAP);

/** Сыграть ходы от корня задачи (история нужна для повторения) и сказать, кончилась ли партия. */
export function terminalAfter(rootFen: string, ucis: string[]): Terminal {
  const chess = new Chess(rootFen);
  for (const uci of ucis) chess.move(uciMove(uci));
  if (chess.isCheckmate()) return 'checkmate';
  return chess.isDraw() ? 'draw' : null;
}

/** «+1.2», «−2.8», «0.0», «#3», «#−2». */
export function formatEval(line: Score): string {
  if (line.mate !== undefined) return line.mate > 0 ? `#${line.mate}` : `#${MINUS}${-line.mate}`;
  const cp = line.cp ?? 0;
  const text = (Math.abs(cp) / 100).toFixed(1);
  return cp > 0 ? `+${text}` : cp < 0 ? `${MINUS}${text}` : text;
}

const evalWords = (line: Score) => (line.mate !== undefined && line.mate > 0 ? `мат в ${line.mate}` : formatEval(line));
const withClass = (line: Score) => `${formatEval(line)} (${OUTCOME_WORD[outcomeClass(line)]})`;

/** На сколько пешек упал материал решающего за четыре полухода линии (отрицательное - вырос). */
function materialLoss(fen: string, pv: string[]): number {
  const chess = new Chess(fen);
  const sign = chess.turn() === 'w' ? 1 : -1;
  for (const uci of pv.slice(0, 4)) {
    try {
      chess.move(uciMove(uci));
    } catch {
      break;
    }
  }
  return sign * materialBalance(fen) - sign * materialBalance(chess.fen());
}

/** Красная стрелка - опровержение; если оно тихое (не взятие и не шах), синяя - следующий ход соперника, его угроза. */
function refutationArrows(afterFen: string, pv: string[]): Arrow[] {
  const reply = pv[1];
  if (!reply) return [];
  const chess = new Chess(afterFen);
  let san: string;
  try {
    san = chess.move(uciMove(reply)).san;
  } catch {
    return [];
  }
  const arrows = [arrow(reply, 'red')];
  if (!/[x+#]/.test(san) && pv[3]) arrows.push(arrow(pv[3], 'blue'));
  return arrows;
}

export interface WrongInput {
  /** Позиция узла, ходит решающий. */
  fen: string;
  /** Ход ученика, UCI. */
  played: string;
  /** Линия движка для хода ученика: pv[0] - этот ход, pv[1] - опровержение. Оценка со стороны решающего. */
  playedLine: EngineLine;
  /** Оценка ожидаемого хода в узле. */
  expected: Score;
}

/** Текст красной плашки и стрелки для узла опровержения. Шаблоны из спецификации, без пересказа линии. */
export function describeWrong({ fen, played, playedLine, expected }: WrongInput): { text: string; arrows: Arrow[] } {
  const chess = new Chess(fen);
  const san = chess.move(uciMove(played)).san;
  const pv = playedLine.pv[0] === played ? playedLine.pv : [played];
  const arrows = refutationArrows(chess.fen(), pv);
  if (playedLine.mate !== undefined && playedLine.mate < 0) return { text: `После ${san} вам мат в ${-playedLine.mate}.`, arrows };
  if (outcomeClass(expected) === 'mate') return { text: `Мат упущен. После ${san} оценка ${withClass(playedLine)}.`, arrows };
  const loss = materialLoss(fen, pv);
  const now = withClass(playedLine);
  const was = withClass(expected);
  const text =
    loss >= 1
      ? `После ${san} вы теряете ${materialWord(loss)}. Оценка ${now}, было ${was}.`
      : `После ${san} оценка ${now}, было ${was}.`;
  return { text, arrows };
}

/** Текст жёлтой плашки: лучший ход не называется. */
export function describeWeaker(expected: Score, played: Score): string {
  return `Хороший ход, но есть сильнее. Оценка ${formatEval(played)}, лучший ход даёт ${evalWords(expected)}.`;
}
