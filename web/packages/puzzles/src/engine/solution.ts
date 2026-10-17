import { Chess } from 'chess.js';
import { materialBalance, winPct, type EngineClient, type EngineLine, type SolutionFrom } from '@board/shared';
import { uciMove } from '../chess-utils.ts';

/** Всё, что импорту нужно от движка: сервис (EngineClient) или FakeEngine в тестах. */
export type Engine = Pick<EngineClient, 'analyse'>;

export interface SolveOptions {
  /** Ход решающего единственный, если второй хуже на столько пунктов win% (порог зевка из coach.toml). */
  uniqueGap: number;
  /** Первый ход книги может уступать лучшему ходу движка не больше чем на столько пунктов win%. */
  bookTolerance: number;
  /** Перевес решающего, на котором линия заканчивается, в сантипешках. */
  winCp: number;
  maxSolverMoves: number;
}

export const DEFAULT_SOLVE: SolveOptions = { uniqueGap: 15, bookTolerance: 5, winCp: 300, maxSolverMoves: 8 };

export type SolveResult =
  | { ok: true; solution: string[]; from: SolutionFrom; disputed: boolean; extended: boolean; detail?: string }
  | { ok: false; detail: string };

export function isUnique(best: EngineLine, second: EngineLine | undefined, gap: number): boolean {
  if (!second) return true;
  if (best.mate !== undefined && best.mate > 0) {
    // последний ход засчитывается любым матом, поэтому мат в 1 «единственный» всегда
    if (best.mate === 1) return true;
    return !(second.mate !== undefined && second.mate > 0 && second.mate <= best.mate);
  }
  return winPct(best) - winPct(second) >= gap;
}

/** Продолжить линию от позиции, где ходит решающий. Последний ход результата - ход решающего. */
export async function extendLine(
  engine: Engine,
  fen: string,
  opts: SolveOptions,
  solverMovesBefore = 0,
): Promise<string[]> {
  const chess = new Chess(fen);
  const out: string[] = [];
  let solverMoves = solverMovesBefore;
  while (solverMoves < opts.maxSolverMoves) {
    const [best, second] = await engine.analyse(chess.fen(), { multipv: 2 });
    if (!best || !isUnique(best, second, opts.uniqueGap)) break;
    chess.move(uciMove(best.move));
    out.push(best.move);
    solverMoves += 1;
    const decided = best.mate === undefined && (best.cp ?? 0) >= opts.winCp;
    if (chess.isGameOver() || decided || solverMoves >= opts.maxSolverMoves) break;
    const [reply] = await engine.analyse(chess.fen(), { multipv: 1 });
    if (!reply) break;
    chess.move(uciMove(reply.move));
    out.push(reply.move);
  }
  if (out.length % 2 === 0) out.pop();
  return out;
}

/** Решение задачи: линия книги (UCI), проверенная движком, или линия движка, если книги нет. */
export async function resolveSolution(
  engine: Engine,
  fen: string,
  book: string[] | null,
  opts: SolveOptions = DEFAULT_SOLVE,
): Promise<SolveResult> {
  if (!book || book.length === 0) {
    const line = await extendLine(engine, fen, opts);
    if (line.length === 0) return { ok: false, detail: 'нет ответа в книге, а первый ход по движку не единственный' };
    return { ok: true, solution: line, from: 'engine', disputed: false, extended: false };
  }
  const line = book.length % 2 === 0 ? book.slice(0, -1) : [...book];
  try {
    const probe = new Chess(fen);
    for (const uci of line) probe.move(uciMove(uci));
  } catch {
    return { ok: false, detail: `ход книги нелегален в позиции: ${book.join(' ')}` };
  }
  const [best] = await engine.analyse(fen, { multipv: 1 });
  const [mine] = await engine.analyse(fen, { multipv: 1, searchmoves: [line[0]] });
  let disputed = false;
  let detail: string | undefined;
  if (best && mine && !(mine.mate !== undefined && mine.mate > 0)) {
    const loss = winPct(best) - winPct(mine);
    if (loss > opts.bookTolerance) {
      disputed = true;
      detail = `первый ход книги ${line[0]} хуже ${best.move} на ${loss.toFixed(1)} пункта win%`;
    }
  }
  const chess = new Chess(fen);
  for (const uci of line) chess.move(uciMove(uci));
  let extended = false;
  const solverMoves = (line.length + 1) / 2;
  if (!chess.isGameOver() && solverMoves < opts.maxSolverMoves) {
    // оценка reply - со стороны соперника: мат решающего - mate < 0, перевес решающего - cp < 0
    const [reply] = await engine.analyse(chess.fen(), { multipv: 1 });
    const solverMates = reply?.mate !== undefined && reply.mate < 0;
    const unfinished = reply !== undefined && reply.mate === undefined && -(reply.cp ?? 0) < opts.winCp;
    if (reply && (solverMates || unfinished)) {
      chess.move(uciMove(reply.move));
      const more = await extendLine(engine, chess.fen(), opts, solverMoves);
      if (more.length > 0) {
        line.push(reply.move, ...more);
        extended = true;
      }
    }
  }
  return { ok: true, solution: line, from: 'book', disputed, extended, ...(detail ? { detail } : {}) };
}

/** Мягкое правило для «Радуги» без ответа книги: первый ход выигрывает (мат или win% от 75). */
export const SOFT_WIN = 75;
export const NOT_WINNING = 'первый ход не выигрывает';
/** Материал считается выигранным, когда баланс решающего вырос на столько пешек против исходной позиции. */
export const SOFT_MATERIAL = 2;

/**
 * Решение без ответа книги и без требования единственного хода. Решающий играет лучший ход движка, соперник - лучший
 * ответ. Линия кончается матом или концом партии, выигрышем материала (после хода решающего и лучшего ответа баланс
 * вырос на SOFT_MATERIAL - тогда ответ отбрасывается) или после maxSolverMoves ходов решающего. Длина всегда нечётная.
 */
export async function resolveSoft(engine: Engine, fen: string, opts: SolveOptions = DEFAULT_SOLVE): Promise<SolveResult> {
  const chess = new Chess(fen);
  const sign = chess.turn() === 'w' ? 1 : -1;
  const start = sign * materialBalance(fen);
  const [first] = await engine.analyse(fen, { multipv: 1 });
  if (!first || !(first.mate !== undefined ? first.mate > 0 : winPct(first) >= SOFT_WIN)) return { ok: false, detail: NOT_WINNING };
  let best: EngineLine = first;
  const line: string[] = [];
  let solverMoves = 0;
  for (;;) {
    chess.move(uciMove(best.move));
    line.push(best.move);
    solverMoves += 1;
    if (chess.isGameOver() || solverMoves >= opts.maxSolverMoves) break;
    const [reply] = await engine.analyse(chess.fen(), { multipv: 1 });
    if (!reply) break;
    const after = new Chess(chess.fen());
    after.move(uciMove(reply.move));
    const mating = best.mate !== undefined && best.mate > 0;
    if (after.isGameOver() || (!mating && sign * materialBalance(after.fen()) - start >= SOFT_MATERIAL)) break;
    chess.move(uciMove(reply.move));
    line.push(reply.move);
    const [next] = await engine.analyse(chess.fen(), { multipv: 1 });
    if (!next) break;
    best = next;
  }
  if (line.length % 2 === 0) line.pop();
  return { ok: true, solution: line, from: 'engine', disputed: false, extended: false };
}
