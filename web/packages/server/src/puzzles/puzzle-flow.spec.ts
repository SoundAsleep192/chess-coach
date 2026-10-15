import { describe, expect, it } from 'vitest';
import type { BoardState, EngineLine } from '@board/shared';
import { applyUnavailable, applyVerdict, playMove, playReply, REPEAT_TEXT, startSession, treeOf, type Verdict } from './puzzle-flow';
import { TreeError } from '../tree/tree-error';
import { addMove, deleteBranch, mainLine } from '../tree/tree';

const FORK = 'q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1';
const NOW = new Date('2026-10-12T10:00:00.000Z');
const START = { puzzleId: 'raduga:1-1-001', fen: FORK, solution: ['d5c7', 'e8d7', 'c7a8'], label: 'test' };
/** Движок считает лучшим Nf6+ (книга: Nc7+). */
const BEST: EngineLine = { move: 'd5f6', cp: 950, pv: ['d5f6', 'e8e7', 'f6d5'] };

const BLANK = { version: 1, seq: 0, orientation: 'white', meta: { plyOffset: 0 }, updatedAt: '' } as unknown as BoardState;

/** Заход «Найти другое»: задача решена одним из первых ходов, остальные ещё не найдены. */
function bonus(found: string[]): BoardState {
  const s = startSession(BLANK, START, { rootAlternatives: ['d5f6'] }, NOW);
  return { ...s, puzzle: { ...s.puzzle!, bonus: true, onMain: false, found, recorded: true } };
}

describe('playMove in a «Найти другое» run', () => {
  it('accepts the book move at once, without the engine, although the engine prefers another first move', () => {
    const s = bonus(['d5f6']);
    const step = playMove(s, s.rootId, 'd5c7', BEST, NOW);
    expect(step.check).toBeUndefined();
    expect(step.state.puzzle).toMatchObject({ phase: 'reply', onMain: true, reply: 'e8d7', feedback: { kind: 'correct' } });
    expect(mainLine(treeOf(step.state)).map((n) => n.san)).toEqual([null, 'Nc7+']);
  });

  it('accepts a not yet found alternative at once and continues with the engine reply when it is the engine best', () => {
    const s = bonus(['d5c7']);
    const step = playMove(s, s.rootId, 'd5f6', BEST, NOW);
    expect(step.check).toBeUndefined();
    expect(step.state.puzzle).toMatchObject({ phase: 'reply', onMain: false, reply: 'e8e7' });
  });

  it('answers «already found» to a first move that has been found, and checks any other move', () => {
    const s = bonus(['d5c7']);
    const again = playMove(s, s.rootId, 'd5c7', BEST, NOW);
    expect(again.state.puzzle?.feedback).toEqual({ kind: 'repeat', text: REPEAT_TEXT });
    expect(again.state.cursor).toBe(s.rootId);
    const other = playMove(s, s.rootId, 'd5b6', BEST, NOW);
    expect(other.check).toMatchObject({ uci: 'd5b6', fen: FORK });
    expect(other.check?.expected).toBeUndefined();
    expect(other.state.puzzle?.phase).toBe('checking');
  });

  it('refuses an illegal move', () => {
    const s = bonus([]);
    expect(() => playMove(s, s.rootId, 'd5d6', undefined, NOW)).toThrow(TreeError);
  });
});

const line = (move: string, cp: number, pv: string[]): EngineLine => ({ move, cp, pv });
const NB6 = line('d5b6', 900, ['d5b6', 'a8a1', 'g1f2']);

describe('an alternative that is not the engine best in a «Найти другое» run', () => {
  const withAlternatives = (found: string[]): BoardState => {
    const s = bonus(found);
    return { ...s, puzzle: { ...s.puzzle!, rootAlternatives: ['d5f6', 'd5b6'] } };
  };

  it('takes the reply from its own cached line and the puzzle goes on after the reply', () => {
    const s = withAlternatives(['d5c7']);
    const step = playMove(s, s.rootId, 'd5b6', BEST, NOW, [BEST, NB6]);
    expect(step.check).toBeUndefined();
    expect(step.state.puzzle).toMatchObject({ phase: 'reply', onMain: false, reply: 'a8a1', status: 'solving' });
    const guard = { puzzleId: START.puzzleId, startedAt: step.state.puzzle!.startedAt, done: step.state.puzzle!.done };
    const replied = playReply(step.state, guard, NOW);
    expect(replied.state.puzzle).toMatchObject({ phase: 'move', status: 'solving', done: 2 });
    expect(replied.state.mode).toBe('puzzle');
  });

  it('without a cached line asks for the engine and accepts the move whatever the verdict', () => {
    const s = withAlternatives(['d5c7']);
    const step = playMove(s, s.rootId, 'd5b6', BEST, NOW, [BEST]);
    expect(step.state.puzzle?.phase).toBe('checking');
    expect(step.check).toMatchObject({ uci: 'd5b6', forced: true });
    const v: Verdict = { verdict: 'weaker', expected: BEST, played: NB6 };
    const done = applyVerdict(step.state, step.check!, v, NOW);
    expect(done.state.puzzle).toMatchObject({ phase: 'reply', reply: 'a8a1', errors: 0, weaker: 0, status: 'solving' });
  });
});

describe('verdicts', () => {
  const checking = () => {
    const s = startSession(BLANK, START, { rootAlternatives: [] }, NOW);
    return playMove(s, s.rootId, 'd5f6', undefined, NOW);
  };

  it('an equal alternative is not «better»: altBetter stays false', () => {
    const step = checking();
    const v: Verdict = { verdict: 'equal', expected: BEST, played: line('d5f6', 900, ['d5f6', 'e8e7', 'f6d5']) };
    expect(applyVerdict(step.state, step.check!, v, NOW).state.puzzle).toMatchObject({ phase: 'reply', altBetter: false, onMain: false });
    expect(applyVerdict(step.state, step.check!, { ...v, verdict: 'better' }, NOW).state.puzzle?.altBetter).toBe(true);
  });

  it('keeps a node that existed before the check when the engine is unavailable', () => {
    const s = startSession(BLANK, START, { rootAlternatives: [] }, NOW);
    const { tree, node } = addMove(treeOf(s), s.rootId, 'd5f6', 'student');
    const step = playMove({ ...s, ...tree }, s.rootId, 'd5f6', undefined, NOW);
    expect(step.state.puzzle?.checking).toEqual({ moveNode: node.id, created: false });
    const back = applyUnavailable(step.state, step.check!);
    expect(back.nodes[node.id]).toBeDefined();
    expect(back).toMatchObject({ cursor: s.rootId, puzzle: { phase: 'move', feedback: { kind: 'unavailable' } } });
  });

  it('drops a verdict and an «unavailable» when the coach deleted the checked node', () => {
    const step = checking();
    const gone: BoardState = { ...step.state, ...deleteBranch(treeOf(step.state), step.check!.moveNode) };
    const v: Verdict = { verdict: 'wrong', expected: BEST, played: line('d5f6', -800, ['d5f6', 'e8e7']) };
    const a = applyVerdict(gone, step.check!, v, NOW);
    expect(a.finished).toBeNull();
    expect(a.state).toMatchObject({ cursor: gone.rootId, puzzle: { phase: 'move', errors: 0, recorded: false } });
    expect(a.state.nodes[a.state.cursor]).toBeDefined();
    expect(applyUnavailable(gone, step.check!)).toMatchObject({ cursor: gone.rootId, puzzle: { phase: 'move' } });
  });
});
