import type { Arrow, NodeId, Orientation } from './index.ts';
import type { Score } from './outcome.ts';

/** Реплика тренера у доски: не больше 240 символов и 2 предложений. */
export const LESSON_SAY_MAX = 240;
export const LESSON_SENTENCES_MAX = 2;
/** Фраза ученика: 1-500 символов после обрезки пробелов. */
export const STUDENT_SAY_MAX = 500;
/** История позиции на сервере. */
export const LESSON_TRANSCRIPT_MAX = 40;
/** Показ ходов тренера на доске: столько миллисекунд на ход. */
export const LESSON_REPLAY_MS = 800;

export type LessonPhase = 'student' | 'coach' | 'feedback' | 'pause' | 'done';
export type LessonStatus = 'running' | 'done' | 'stopped';
/** info - ответ на демонстрационный ход, плашки нет. */
export type LessonVerdictKind = 'correct' | 'weaker' | 'wrong' | 'unavailable' | 'info';

/** score - оценка позиции после хода ученика со стороны белых; для unavailable и info его нет. */
export interface LessonVerdict {
  kind: LessonVerdictKind;
  score?: Score;
}

/** Слова на плашке вердикта; для info плашки нет. */
export const LESSON_VERDICT_WORD: Record<Exclude<LessonVerdictKind, 'info'>, string> = {
  correct: 'Верно',
  weaker: 'Неплохо, но есть сильнее',
  wrong: 'Ошибка',
  unavailable: 'Не могу проверить ход: движок недоступен',
};

export interface LessonEntry {
  who: 'coach' | 'student';
  kind: 'say' | 'move' | 'verdict';
  text: string;
  at: string;
}

export type LessonInput =
  | { id: number; kind: 'move'; node: NodeId; uci: string; san: string; resume: 'student' }
  | { id: number; kind: 'say'; text: string; resume: 'student' | 'feedback' | 'pause' }
  | { id: number; kind: 'next'; resume: 'pause' };

/** Игроки и ходы партии в SAN до позиции занятия: список «Ходы партии» на странице. */
export interface LessonGame {
  white: string;
  black: string;
  moves: string[];
}

export interface LessonPositionSetup {
  fen: string;
  orientation: Orientation;
  label: string;
  context: string;
  task: string;
  gameId?: string;
  ply?: number;
  game?: LessonGame;
}

/** Показ ходов тренера: клиент проигрывает узлы от from до to; id растёт, новый id - новый показ. */
export interface LessonReplay {
  from: NodeId;
  to: NodeId;
  id: number;
}

/** Видимое состояние занятия. node - узел главной линии, от которого принимается ход ученика. */
export interface LessonView {
  lessonId: string;
  title: string;
  status: LessonStatus;
  index: number;
  total: number;
  label: string;
  phase: LessonPhase;
  node: NodeId;
  pending?: LessonInput;
  verdict?: LessonVerdict;
  transcript: LessonEntry[];
  seq: number;
  online: boolean;
  summary?: string;
  game?: LessonGame;
  replay?: LessonReplay;
}

export type LessonAction =
  | { type: 'none' }
  | { type: 'ask' }
  | { type: 'play'; uci: string }
  | { type: 'line'; from: NodeId; moves: string[]; arrows?: Arrow[]; then: 'feedback' | 'pause' }
  | { type: 'arrows'; arrows: Arrow[] }
  | { type: 'back' }
  | { type: 'feedback'; arrows?: Arrow[] }
  | { type: 'pause' }
  | { type: 'position'; index: number; position: LessonPositionSetup }
  | { type: 'end'; summary: string; stats: { modelCalls: number; fallbacks: number } };

export interface LessonStartBody {
  lessonId: string;
  title: string;
  total: number;
  index: number;
  intro?: string;
  position: LessonPositionSetup;
}
export interface LessonVerdictBody {
  inputId: number;
  verdict: LessonVerdict;
}
export interface LessonReplyBody {
  inputId: number;
  say?: string;
  verdict?: LessonVerdict;
  accept?: boolean;
  action: LessonAction;
  note?: string;
}
export interface LessonSayData {
  text: string;
}

/** Границы предложений: [.!?…]+, за которыми пробел или конец текста; хвост без знака - тоже предложение. */
export function countSentences(text: string): number {
  return text.split(/[.!?…]+[»"”')\]]*(?=\s|$)/).filter((part) => part.trim() !== '').length;
}

const NOTATION: readonly RegExp[] = [
  // ход фигуры: Nd3, Qxf7+, Nbd2, R1e1
  /(?<![A-Za-z])[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?(?![A-Za-z0-9])/,
  // взятие и превращение пешкой: exd5, e8=Q
  /(?<![A-Za-z])[a-h]x[a-h][1-8](?![A-Za-z0-9])/,
  /(?<![A-Za-z])[a-h][18]=[QRBN]/,
  // рокировка буквами или нулями
  /(?<![\p{L}\d])[OО0]-[OО0](?:-[OО0])?(?![\p{L}\d])/u,
  // номер хода: 25.Nd3, 25...e5, 12.a4
  /(?<![A-Za-z0-9])\d{1,3}\.{1,3}(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?|[a-h]x[a-h][1-8]|[a-h][1-8]|[OО0]-[OО0](?:-[OО0])?)/,
  // оценка: +1.2, −0.8, +3, #3, мат в 3, мата в 3, мат за 3 (дефис после цифры - не знак: «2-3,5»)
  /(?<!\d)[+\u2212\u2013-]\d+[.,]\d/,
  /(?<![\d\w])[+\u2212]\d+/,
  /#[-\u2212]?\d+/,
  /мат(?:а|у|ом|е)?\s+(?:в|за)\s+\d+/i,
];

/**
 * Тексты для ученика без записи ходов и числовых оценок. Фигура с полем словами («конь d3») и голое поле проходят.
 * Возвращает первый (по позиции в тексте) запрещённый фрагмент или null. Серверные валидаторы её не вызывают.
 */
export function studentTextProblem(text: string): string | null {
  let best: { index: number; text: string } | null = null;
  for (const re of NOTATION) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, text: m[0] };
  }
  return best ? best.text : null;
}
