import type { PuzzleSource } from './index.ts';
import { LESSON_SAY_MAX, LESSON_SENTENCES_MAX, STUDENT_SAY_MAX, countSentences } from './lesson.ts';

/** Валидаторы тел HTTP-запросов: null - тело годится, строка - что не так. Лишние поля не проверяются. */
export const PUZZLE_SOURCES: readonly PuzzleSource[] = ['lichess', 'polgar', 'raduga', 'games'];
const SQUARE = /^[a-h][1-8]$/;
const COLORS = ['green', 'red', 'blue'];

type Obj = Record<string, unknown>;
const isObj = (b: unknown): b is Obj => typeof b === 'object' && b !== null && !Array.isArray(b);
const isInt = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const isStrArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function first(...checks: (string | null | false)[]): string | null {
  for (const c of checks) if (c) return c;
  return null;
}
const opt = (b: Obj, key: string, ok: (v: unknown) => boolean, what: string) =>
  b[key] !== undefined && !ok(b[key]) ? `${key} must be ${what}` : null;

function validateAt(b: Obj): string | null {
  const at = b.at;
  if (isInt(at, 0) || (typeof at === 'string' && at.length > 0 && at.length <= 50)) return null;
  return 'at must be a ply number >= 0 or a node id';
}

export function validateReplaceBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    b.pgn !== undefined && b.fen !== undefined && 'give pgn or fen, not both',
    opt(b, 'pgn', (v) => typeof v === 'string', 'a string'),
    opt(b, 'fen', (v) => typeof v === 'string', 'a string'),
    opt(b, 'moves', isStrArray, 'an array of strings'),
    opt(b, 'cursorPly', (v) => isInt(v, 1), 'an integer >= 1'),
    opt(b, 'upto', (v) => isInt(v, 1), 'an integer >= 1'),
    opt(b, 'plyOffset', (v) => isInt(v, 0), 'an integer >= 0'),
    opt(b, 'orientation', (v) => v === 'white' || v === 'black', '"white" or "black"'),
    opt(b, 'title', (v) => isStr(v, 200), 'a string up to 200 characters'),
    opt(b, 'gameId', (v) => isStr(v, 200), 'a string up to 200 characters'),
  );
}

export function validateAddLineBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    validateAt(b),
    !(isStrArray(b.moves) && (b.moves as string[]).length > 0) && 'moves must be a non-empty array of strings',
    opt(b, 'caption', (v) => isStr(v, 500), 'a string up to 500 characters'),
  );
}

const isArrow = (a: unknown) =>
  isObj(a) && typeof a.from === 'string' && SQUARE.test(a.from) && typeof a.to === 'string' && SQUARE.test(a.to) && COLORS.includes(a.color as string);

export function validateCursorBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    validateAt(b),
    opt(b, 'arrows', (v) => Array.isArray(v) && v.length <= 20 && v.every(isArrow), 'up to 20 arrows {from, to: a1..h8, color: green|red|blue}'),
    opt(b, 'caption', (v) => isStr(v, 500), 'a string up to 500 characters'),
  );
}

export function validateModeBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return b.mode === 'frozen' || b.mode === 'free' ? null : 'mode must be "frozen" or "free"';
}

export function validatePanelBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  if (b.eval === undefined && b.lines === undefined && b.note === undefined) return 'give at least one of eval, lines, note';
  return first(
    opt(b, 'eval', (v) => typeof v === 'boolean', 'true or false'),
    opt(b, 'lines', (v) => isInt(v, 0) && (v as number) <= 3, 'an integer 0..3'),
    opt(b, 'note', (v) => v === null || isStr(v, 2000), 'a string up to 2000 characters or null'),
  );
}

export function validatePuzzleNextBody(b: unknown): string | null {
  if (b === undefined || b === null) return null;
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    opt(b, 'id', (v) => isStr(v, 200), 'a string'),
    opt(b, 'theme', (v) => isStr(v, 100), 'a string'),
    opt(b, 'themes', isStrArray, 'an array of strings'),
    opt(b, 'source', (v) => PUZZLE_SOURCES.includes(v as PuzzleSource), PUZZLE_SOURCES.join(' | ')),
    opt(b, 'rating', (v) => isInt(v, 0), 'an integer'),
  );
}

export function validateInboxAckBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return isInt(b.upto, 0) ? null : 'upto must be an integer >= 0';
}

// Занятие у доски

const VERDICT_KINDS = ['correct', 'weaker', 'wrong', 'unavailable', 'info'];
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const isArrowList = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every(isArrow);
const arrowsHint = 'up to 20 arrows {from, to: a1..h8, color: green|red|blue}';
const isNonEmptyStr = (v: unknown, max: number) => isStr(v, max) && (v as string).length > 0;

/** Реплика, вступление, итог: длина и число предложений. */
const isSay = (v: unknown) => isStr(v, LESSON_SAY_MAX) && countSentences(v as string) <= LESSON_SENTENCES_MAX;
const sayHint = `a string up to ${LESSON_SAY_MAX} characters and ${LESSON_SENTENCES_MAX} sentences`;
/** Как opt, но с готовым сообщением (для вложенных полей). */
const optMsg = (b: Obj, key: string, ok: (v: unknown) => boolean, msg: string) => (b[key] !== undefined && !ok(b[key]) ? msg : null);

/** Оценка со стороны белых: целые cp и/или mate, хотя бы одно. */
const isScore = (v: unknown) =>
  isObj(v) &&
  (v.cp === undefined || Number.isInteger(v.cp)) &&
  (v.mate === undefined || Number.isInteger(v.mate)) &&
  (v.cp !== undefined || v.mate !== undefined);

function validateLessonVerdict(v: unknown): string | null {
  if (!isObj(v)) return 'verdict must be an object';
  return first(
    !VERDICT_KINDS.includes(v.kind as string) && `verdict.kind must be ${VERDICT_KINDS.join(' | ')}`,
    optMsg(v, 'score', isScore, 'verdict.score must be {cp?: integer, mate?: integer} with at least one of them'),
    v.score !== undefined && (v.kind === 'unavailable' || v.kind === 'info') && `verdict.score is not allowed for kind ${v.kind}`,
  );
}

function validateLessonGame(g: unknown): string | null {
  const ok = isObj(g) && isStr(g.white, 200) && isStr(g.black, 200) && isStrArray(g.moves);
  return ok ? null : 'position.game must be {white: string, black: string, moves: array of strings}';
}

function validateLessonPosition(p: unknown): string | null {
  if (!isObj(p)) return 'position must be an object';
  return first(
    !isNonEmptyStr(p.fen, 200) && 'position.fen must be a non-empty string',
    !(p.orientation === 'white' || p.orientation === 'black') && 'position.orientation must be "white" or "black"',
    !isStr(p.label, 200) && 'position.label must be a string up to 200 characters',
    !isStr(p.context, 500) && 'position.context must be a string up to 500 characters',
    !isStr(p.task, 500) && 'position.task must be a string up to 500 characters',
    optMsg(p, 'gameId', (v) => isStr(v, 200), 'position.gameId must be a string up to 200 characters'),
    optMsg(p, 'ply', (v) => isInt(v, 1), 'position.ply must be an integer >= 1'),
    p.game !== undefined && validateLessonGame(p.game),
  );
}

export function validateLessonStartBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    !isNonEmptyStr(b.lessonId, 100) && 'lessonId must be a non-empty string up to 100 characters',
    !isNonEmptyStr(b.title, 200) && 'title must be a non-empty string up to 200 characters',
    !isInt(b.total, 1) && 'total must be an integer >= 1',
    !(isInt(b.index, 0) && (b.index as number) < (b.total as number)) && 'index must be an integer, 0 <= index < total',
    optMsg(b, 'intro', isSay, `intro must be ${sayHint}`),
    validateLessonPosition(b.position),
  );
}

export function validateLessonVerdictBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(!isInt(b.inputId, 1) && 'inputId must be an integer >= 1', validateLessonVerdict(b.verdict));
}

function validateLessonAction(a: unknown): string | null {
  const bad = 'action must be {type: none | ask | play | line | arrows | back | feedback | pause | position | end, ...}';
  if (!isObj(a)) return bad;
  switch (a.type) {
    case 'none':
    case 'ask':
    case 'back':
    case 'pause':
      return null;
    case 'play':
      return typeof a.uci === 'string' && UCI_MOVE.test(a.uci) ? null : 'action.uci must be a move like e2e4';
    case 'line':
      return first(
        !isNonEmptyStr(a.from, 50) && 'action.from must be a node id',
        !(isStrArray(a.moves) && (a.moves as string[]).length > 0) && 'action.moves must be a non-empty array of strings',
        optMsg(a, 'arrows', isArrowList, `action.arrows must be ${arrowsHint}`),
        !(a.then === 'feedback' || a.then === 'pause') && 'action.then must be "feedback" or "pause"',
      );
    case 'arrows':
      return isArrowList(a.arrows) ? null : `action.arrows must be ${arrowsHint}`;
    case 'feedback':
      return a.arrows === undefined || isArrowList(a.arrows) ? null : `action.arrows must be ${arrowsHint}`;
    case 'position':
      return first(!isInt(a.index, 0) && 'action.index must be an integer >= 0', validateLessonPosition(a.position));
    case 'end': {
      const s = a.stats;
      return first(
        !isSay(a.summary) && `action.summary must be ${sayHint}`,
        !(isObj(s) && isInt(s.modelCalls, 0) && isInt(s.fallbacks, 0)) && 'action.stats must be {modelCalls, fallbacks: integers >= 0}',
      );
    }
    default:
      return bad;
  }
}

export function validateLessonReplyBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    !isInt(b.inputId, 1) && 'inputId must be an integer >= 1',
    optMsg(b, 'say', (v) => isSay(v) && (v as string).length > 0, `say must be non-empty, ${sayHint}`),
    b.verdict !== undefined && validateLessonVerdict(b.verdict),
    opt(b, 'accept', (v) => typeof v === 'boolean', 'true or false'),
    opt(b, 'note', (v) => isStr(v, 2000), 'a string up to 2000 characters'),
    validateLessonAction(b.action),
  );
}

export function validateLessonSay(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  const ok = typeof b.text === 'string' && b.text.trim().length >= 1 && b.text.trim().length <= STUDENT_SAY_MAX;
  return ok ? null : `text must be 1..${STUDENT_SAY_MAX} characters after trimming`;
}
