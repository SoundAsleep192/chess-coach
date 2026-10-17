import { describe, expect, it } from 'vitest';
import type { BoardState, PuzzleSession } from '@board/shared';
import { addMove, fromGame } from '../tree/tree';
import { appendToLine, cursorLine, deleteDraft, eventText, lineDraft, moveToken, puzzleDraft, type StoredEvent } from './inbox-format';

const state = (moves: string[], extra: Partial<BoardState> = {}): BoardState => ({
  ...fromGame({ moves }),
  version: 1, mode: 'free', orientation: 'white', meta: { plyOffset: 0 }, updatedAt: '', treeEpoch: 3, ...extra,
});
const stored = (d: object): StoredEvent => ({ _id: 1, at: new Date(), read: false, text: '', ...(d as any) });

describe('moveToken', () => {
  it('numbers white moves always and black moves when forced', () => {
    expect(moveToken('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 24', 'Nh6+', false)).toBe('24.Nh6+');
    expect(moveToken('8/8/8/8/8/8/8/K6k b - - 0 23', 'Nf5', true)).toBe('23...Nf5');
    expect(moveToken('8/8/8/8/8/8/8/K6k b - - 0 23', 'Kh8', false)).toBe('Kh8');
  });
});

describe('line events', () => {
  it('starts a branch with the position it grew from and glues the next move', () => {
    const s0 = state(['e4', 'e5']);
    const from = s0.cursor;
    const a = addMove(fromGame({ moves: ['e4', 'e5'] }), from, 'Nf3', 'student');
    const s1 = { ...s0, ...a.tree, cursor: a.node.id };
    const d = lineDraft(s1, a.node);
    expect(d).toMatchObject({ kind: 'line', fromNode: from, nodes: [a.node.id], moves: ['2.Nf3'], treeEpoch: 3 });
    expect(eventText(d)).toBe(`ветка ученика от 1...e5: 2.Nf3 (узел ${a.node.id})`);
    const b = addMove(a.tree, a.node.id, 'Nc6', 'student');
    const s2 = { ...s1, ...b.tree, cursor: b.node.id };
    const glued = appendToLine(stored(d), s2, b.node)!;
    expect(glued.moves).toEqual(['2.Nf3', 'Nc6']);
    expect(glued.text).toBe(`ветка ученика от 1...e5: 2.Nf3 Nc6 (узлы ${a.node.id}-${b.node.id})`);
  });
  it('does not glue after a read event, another tree, or a move from elsewhere', () => {
    const s0 = state(['e4']);
    const a = addMove(fromGame({ moves: ['e4'] }), s0.cursor, 'e5', 'student');
    const s1 = { ...s0, ...a.tree };
    const d = stored(lineDraft(s1, a.node));
    const b = addMove(a.tree, a.node.id, 'Nf3', 'student');
    const s2 = { ...s1, ...b.tree };
    expect(appendToLine({ ...d, read: true }, s2, b.node)).toBeNull();
    expect(appendToLine({ ...d, treeEpoch: 2 }, s2, b.node)).toBeNull();
    const c = addMove(b.tree, s0.cursor, 'c5', 'student');
    expect(appendToLine(d, { ...s2, ...c.tree }, c.node)).toBeNull();
  });
  it('a branch from the root says so', () => {
    const s0 = state([]);
    const a = addMove(fromGame({}), s0.rootId, 'd4', 'student');
    expect(eventText(lineDraft({ ...s0, ...a.tree }, a.node))).toBe(`ветка ученика от начальной позиции: 1.d4 (узел ${a.node.id})`);
  });
});

describe('delete events', () => {
  it('names the first move and counts plies with the right word form', () => {
    const s0 = state(['e4']);
    let t = addMove(fromGame({ moves: ['e4'] }), s0.cursor, 'c5', 'student');
    const first = t.node.id;
    t = addMove(t.tree, first, 'Nf3', 'student');
    const s = { ...s0, ...t.tree };
    expect(eventText(deleteDraft(s, first))).toBe('ученик удалил ветку 1...c5 (2 полухода)');
  });
});

describe('puzzle events', () => {
  const pz = (over: Partial<PuzzleSession>): PuzzleSession => ({
    puzzleId: 'polgar:0310', label: 'Полгар №310', side: 'white', solution: ['h3h2'], done: 0, status: 'solving',
    startedAt: '', phase: 'move', node: 'n1', onMain: true, errors: 0, weaker: 0, altBetter: false, recorded: false,
    rootAlternatives: [], found: [], bonus: false, ...over,
  });
  it('reports a wrong move with its SAN and banner', () => {
    const s = state(['e4']);
    const prev = { ...s, mode: 'puzzle' as const, puzzle: pz({ phase: 'checking', checking: { moveNode: s.cursor, created: true } }) };
    const next = { ...prev, puzzle: pz({ phase: 'feedback', errors: 1, checking: { moveNode: s.cursor, created: true }, feedback: { kind: 'wrong', text: 'Мат упущен.' } }) };
    expect(eventText(puzzleDraft(prev, next)!)).toBe('задача polgar:0310: ошибка, ход 1.e4, «Мат упущен.»');
  });
  it('reports weaker, solved with errors, and shown solution; nothing for a correct step', () => {
    const s = state(['e4']);
    const base = { ...s, mode: 'puzzle' as const };
    const checking = { moveNode: s.cursor, created: true };
    const weaker = puzzleDraft({ ...base, puzzle: pz({ phase: 'checking', checking }) },
      { ...base, puzzle: pz({ phase: 'feedback', weaker: 1, checking, feedback: { kind: 'weaker', text: 'Хороший ход, но есть сильнее.' } }) });
    expect(eventText(weaker!)).toBe('задача polgar:0310: ход «слабее»: 1.e4, «Хороший ход, но есть сильнее.»');
    const solved = puzzleDraft({ ...base, puzzle: pz({ errors: 1 }) }, { ...base, mode: 'free', puzzle: pz({ status: 'solved', errors: 1 }) });
    expect(eventText(solved!)).toBe('задача polgar:0310: решено, ошибок 1');
    const shown = puzzleDraft({ ...base, puzzle: pz({}) }, { ...base, mode: 'free', puzzle: pz({ status: 'failed', answer: '1.Rh2#' }) });
    expect(eventText(shown!)).toBe('задача polgar:0310: показано решение 1.Rh2#');
    expect(puzzleDraft({ ...base, puzzle: pz({ phase: 'checking', checking }) }, { ...base, puzzle: pz({ phase: 'reply', feedback: { kind: 'correct', text: 'Верно, продолжайте' } }) })).toBeNull();
  });
  it('records a give-up even when no answer line could be built', () => {
    const s = state(['e4']);
    const base = { ...s, mode: 'puzzle' as const };
    const shown = puzzleDraft({ ...base, puzzle: pz({}) }, { ...base, mode: 'free', puzzle: pz({ status: 'failed' }) });
    expect(eventText(shown!)).toBe('задача polgar:0310: показано решение (линии нет)');
  });
  it('adds the second-solution mark and ignores moves after the solution was shown', () => {
    const s = state(['e4']);
    const base = { ...s, mode: 'puzzle' as const };
    const solved = puzzleDraft({ ...base, puzzle: pz({ bonus: true }) }, { ...base, puzzle: pz({ status: 'solved', bonus: true }) });
    expect(eventText(solved!)).toBe('задача polgar:0310: решено (второе решение)');
    const after = { ...base, mode: 'free' as const, puzzle: pz({ status: 'failed', answer: '1.Rh2#' }) };
    expect(puzzleDraft(after, { ...after, cursor: s.rootId })).toBeNull();
  });
});

describe('cursorLine', () => {
  it('describes the cursor node author and mode, the root, and a puzzle', () => {
    const s = state(['e4', 'e5']);
    expect(cursorLine(s)).toBe('курсор после 1...e5 (партия), режим free');
    expect(cursorLine({ ...s, cursor: s.rootId })).toBe('курсор в начальной позиции, режим free');
    expect(cursorLine({ ...s, mode: 'puzzle', puzzle: { puzzleId: 'polgar:0310', status: 'solving' } as PuzzleSession })).toBe('на доске задача polgar:0310, решается');
  });
});
