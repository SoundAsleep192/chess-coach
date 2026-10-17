import { Chess } from 'chess.js';
import { compareMove, outcomeClass, type EngineLine, type Score } from '@board/shared';
import { uciMove } from '../chess-utils.ts';
import { DEFAULT_SOLVE, extendLine, isUnique, resolveSoft, type Engine, type SolveOptions } from '../engine/solution.ts';
import type { Candidate } from './review.ts';

export type JudgeResult =
  | { ok: true; fen: string; solution: string[]; themes: string[] }
  | { ok: false; reason: 'no_class_drop' | 'not_puzzle' | 'illegal_position' | 'engine_error'; detail: string };

const MULTIPV = 3;
const DRAW_SCORE: Score = { cp: 0 };
/** Ход, который ставит мат, - мат в 1 в пользу ходившего (оценка со стороны решающего). */
const MATE_SCORE: Score = { mate: 1 };

/** Конец партии после сыгранного хода (как terminalAfter на сервере доски); null - нелегальный ход. */
function terminalOf(fen: string, played: string): 'checkmate' | 'draw' | null | 'illegal' {
  try {
    const chess = new Chess(fen);
    chess.move(uciMove(played));
    if (chess.isCheckmate()) return 'checkmate';
    return chess.isDraw() ? 'draw' : null;
  } catch {
    return 'illegal';
  }
}

/**
 * Суд над кандидатом из собственной партии: роняет ли сыгранный ход класс исхода против лучшего хода, и есть ли в
 * позиции удар или единственный ход. Запросы те же, что у доски: multipv 3, сыгранный ход вне тройки - searchmoves.
 */
export async function judgeCandidate(engine: Engine, c: Candidate, opts: SolveOptions = DEFAULT_SOLVE): Promise<JudgeResult> {
  const terminal = terminalOf(c.fen, c.played);
  if (terminal === 'illegal') return { ok: false, reason: 'illegal_position', detail: `ход ${c.played} нелегален в ${c.fen}` };
  try {
    const lines = await engine.analyse(c.fen, { multipv: MULTIPV });
    const best = lines[0];
    if (!best) return { ok: false, reason: 'engine_error', detail: `нет линий движка в ${c.fen}` };
    let played: Score;
    if (terminal === 'checkmate') played = MATE_SCORE;
    else if (terminal === 'draw') played = DRAW_SCORE;
    else {
      const found: EngineLine | undefined =
        lines.find((l) => l.move === c.played) ?? (await engine.analyse(c.fen, { searchmoves: [c.played] }))[0];
      if (!found) return { ok: false, reason: 'engine_error', detail: `нет оценки хода ${c.played}` };
      played = found;
    }
    if (compareMove(best, played) !== 'wrong') return { ok: false, reason: 'no_class_drop', detail: `${c.played} не хуже ${best.move}` };

    const strike = (best.mate !== undefined && best.mate > 0) || outcomeClass(best) === 'winning';
    // мат в 1: «единственный» только если второй линии нет среди матов за столько же ходов или быстрее
    // (isUnique для мата в 1 всегда истинно, на нём держится extendLine, здесь он дал бы ложную метку при двух матах в 1)
    const second = lines[1];
    const only =
      best.mate !== undefined && best.mate > 0
        ? !(second?.mate !== undefined && second.mate > 0 && second.mate <= best.mate)
        : isUnique(best, second, opts.uniqueGap);
    if (!strike && !only) return { ok: false, reason: 'not_puzzle', detail: `нет удара и нет единственного хода (${best.move})` };

    let solution: string[];
    if (strike) {
      const soft = await resolveSoft(engine, c.fen, opts);
      solution = soft.ok && soft.solution[0] === best.move ? soft.solution : [best.move];
    } else {
      const line = await extendLine(engine, c.fen, opts);
      solution = line.length > 0 && line[0] === best.move ? line : [best.move];
    }

    const themes = ['ownGame'];
    if (strike) themes.push('missedWin');
    if (only) themes.push('onlyMove');
    if (only && !strike) themes.push('defensiveMove');
    if (best.mate !== undefined && best.mate > 0) themes.push('mate');
    return { ok: true, fen: c.fen, solution, themes };
  } catch (e) {
    return { ok: false, reason: 'engine_error', detail: (e as Error).message };
  }
}
