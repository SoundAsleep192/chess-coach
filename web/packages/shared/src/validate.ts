import type { PuzzleSource } from './index.ts';

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
