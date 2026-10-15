import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { BoardState, PuzzleDoc } from '@board/shared';
import { fenAfter, FORK, FORK_NF6, FORK_ROOT, MATE2, MATE2_ROOT, TWO_ROOKS } from './puzzle-fixtures';
import { cardOf, engine, puzzleStats, setupBoardApp, startPuzzle, stateOf, withDb } from './helpers';
import { WsProbe } from './ws-probe';

process.env.PUZZLE_REPLY_MS = '20';
const board = setupBoardApp();

const start = (doc: PuzzleDoc) => startPuzzle(board, doc);
const stats = () => puzzleStats(board);

/** Две ладьи: Ra8# по решению и Rb8# - равноценное второе решение. */
const TWO_ROOKS_ROOT = [
  { move: 'a1a8', mate: 1, pv: ['a1a8'] },
  { move: 'b1b8', mate: 1, pv: ['b1b8'] },
  { move: 'a1a7', cp: 0, pv: ['a1a7'] },
];

describe('puzzle actions', () => {
  it('«Показать решение» plays the solution as the main line, shows it in SAN and records a failure', async () => {
    const { ws, state } = await start(FORK);
    ws.send('puzzleGiveUp', {});
    const shown = stateOf(await ws.next());
    expect(shown).toMatchObject({
      mode: 'free',
      cursor: state.rootId,
      puzzle: { status: 'failed', answer: '1.Nc7+ Kd7 2.Nxa8', recorded: true },
    });
    const root = shown.nodes[shown.rootId];
    expect(root.arrows).toEqual([{ from: 'd5', to: 'c7', color: 'green' }]);
    expect(root.children.map((id) => shown.nodes[id].san)).toEqual(['Nc7+']);
    expect((await stats()).total).toEqual({ attempts: 1, solved: 0 });
    expect(await cardOf(FORK._id)).toMatchObject({ history: [{ correct: false, grade: 'Again', weaker: 0, altBetter: false }] });
    ws.close();
  });

  it('gives up after a mistake without a second record and puts the solution before the wrong branch', async () => {
    engine.on(FORK.fen, FORK_ROOT).on(FORK.fen, FORK_NF6, ['d5f6']);
    const { ws, state } = await start(FORK);
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    await ws.until((s) => s.puzzle?.phase === 'feedback');
    ws.send('puzzleGiveUp', {});
    const shown = stateOf(await ws.next());
    expect(shown.puzzle).toMatchObject({ status: 'failed', errors: 1, answer: '1.Nc7+ Kd7 2.Nxa8' });
    expect(shown.cursor).toBe(shown.rootId);
    expect(shown.nodes[shown.rootId].children.map((id) => shown.nodes[id].san)).toEqual(['Nc7+', 'Nf6+']);
    await stats();
    expect((await cardOf(FORK._id)) as unknown).toMatchObject({ history: [{ correct: false }] });
    expect(((await cardOf(FORK._id)) as unknown as { history: unknown[] }).history).toHaveLength(1);
    ws.close();
  });

  it('off the book line shows the engine line from the current node', async () => {
    engine
      .on(FORK.fen, [
        { move: 'd5f6', cp: 950, pv: ['d5f6', 'e8e7', 'f6d5'] },
        { move: 'g1g2', cp: 0, pv: ['g1g2'] },
        { move: 'g1h2', cp: -10, pv: ['g1h2'] },
      ])
      .on(FORK.fen, [{ move: 'd5c7', cp: 900, pv: ['d5c7', 'e8d7', 'c7a8'] }], ['d5c7'])
      .on(fenAfter(FORK.fen, ['d5f6', 'e8e7']), [{ move: 'f6d5', cp: 900, pv: ['f6d5', 'e7d7', 'd5c7'] }]);
    const { ws, state } = await start({ ...FORK, _id: 'raduga:1-1-003' });
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    const node = await ws.until((s) => s.puzzle?.phase === 'move');
    ws.send('puzzleGiveUp', {});
    const shown = await ws.until((s) => s.puzzle?.status === 'failed');
    expect(shown.cursor).toBe(node.cursor);
    expect(shown.puzzle).toMatchObject({ answer: '2.Nd5+', onMain: false, altBetter: true });
    expect(shown.nodes[node.cursor].arrows).toEqual([{ from: 'f6', to: 'd5', color: 'green' }]);
    await stats();
    expect(await cardOf('raduga:1-1-003')).toMatchObject({ history: [{ correct: false, altBetter: true }] });
    ws.close();
  });

  it('offers «Найти другое» after a solve, answers a repeated first move and never records the second run', async () => {
    engine.on(TWO_ROOKS.fen, TWO_ROOKS_ROOT);
    const { ws, state } = await start(TWO_ROOKS);
    expect(state.puzzle).toMatchObject({ rootAlternatives: ['b1b8'], classification: 'multiple' });
    ws.send('move', { parentId: state.cursor, uci: 'a1a8' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ status: 'solved', found: ['a1a8'], bonus: false });
    ws.send('puzzleAnother', {});
    const bonus = stateOf(await ws.next());
    expect(bonus).toMatchObject({ mode: 'puzzle', cursor: bonus.rootId, puzzle: { status: 'solving', phase: 'move', bonus: true, onMain: false } });
    ws.send('move', { parentId: bonus.cursor, uci: 'a1a8' });
    const repeat = stateOf(await ws.next());
    expect(repeat.puzzle).toMatchObject({ phase: 'move', feedback: { kind: 'repeat', text: 'Это решение вы уже нашли' } });
    expect(repeat.cursor).toBe(repeat.rootId);
    ws.send('move', { parentId: repeat.cursor, uci: 'b1b8' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ status: 'solved', bonus: true, found: ['a1a8', 'b1b8'] });
    ws.send('puzzleAnother', {});
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen', message: 'no other solution to find' } });
    await ws.next();
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });

  it('in the second run «Показать решение» points at the other first move and keeps the puzzle solved', async () => {
    engine.on(TWO_ROOKS.fen, TWO_ROOKS_ROOT);
    const { ws, state } = await start(TWO_ROOKS);
    ws.send('move', { parentId: state.cursor, uci: 'a1a8' });
    await ws.next();
    ws.send('puzzleAnother', {});
    await ws.next();
    ws.send('puzzleGiveUp', {});
    const shown = stateOf(await ws.next());
    expect(shown).toMatchObject({ mode: 'free', puzzle: { status: 'solved', bonus: true, answer: '1.Rb8#' } });
    expect(shown.nodes[shown.rootId].arrows).toEqual([{ from: 'b1', to: 'b8', color: 'green' }]);
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });

  it('accepts the book move in the second run after the student solved with a stronger mate, and records nothing new', async () => {
    // книга: Ra7 (около +3.2), движок видит мат в 1 - ученик решает матом, «Найти другое» предлагает ход книги
    const BOOK_WEAK: PuzzleDoc = { ...TWO_ROOKS, _id: 'polgar:0003', solution: ['a1a7'] };
    engine.on(BOOK_WEAK.fen, [
      { move: 'b1b8', mate: 1, pv: ['b1b8'] },
      { move: 'a1a8', mate: 1, pv: ['a1a8'] },
      { move: 'a1a7', cp: 320, pv: ['a1a7', 'h8g8'] },
    ]);
    const { ws, state } = await start(BOOK_WEAK);
    expect(state.puzzle?.rootAlternatives).toEqual(['b1b8', 'a1a8']);
    ws.send('move', { parentId: state.cursor, uci: 'b1b8' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ status: 'solved', found: ['b1b8'], recorded: true });
    ws.send('puzzleAnother', {});
    const bonus = stateOf(await ws.next());
    expect(bonus.puzzle).toMatchObject({ status: 'solving', bonus: true });
    ws.send('move', { parentId: bonus.cursor, uci: 'a1a7' });
    const done = stateOf(await ws.next());
    expect(done.puzzle).toMatchObject({ status: 'solved', bonus: true, found: ['b1b8', 'a1a7'] });
    expect(done.nodes[done.cursor]).toMatchObject({ san: 'Ra7' });
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    expect(((await cardOf(BOOK_WEAK._id)) as unknown as { history: unknown[] }).history).toHaveLength(1);
    ws.close();
  });

  it('with the engine down off the stored line shows no answer, fails the puzzle once and logs one line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      engine.on(FORK.fen, [
        { move: 'd5f6', cp: 950, pv: ['d5f6', 'e8e7', 'f6d5'] },
        { move: 'g1g2', cp: 0, pv: ['g1g2'] },
        { move: 'g1h2', cp: -10, pv: ['g1h2'] },
      ]).on(FORK.fen, [{ move: 'd5c7', cp: 900, pv: ['d5c7', 'e8d7', 'c7a8'] }], ['d5c7']);
      const { ws, state } = await start({ ...FORK, _id: 'raduga:1-1-004' });
      ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
      const node = await ws.until((s) => s.puzzle?.phase === 'move');
      engine.down = true;
      ws.send('puzzleGiveUp', {});
      const shown = await ws.until((s) => s.puzzle?.status === 'failed');
      expect(shown).toMatchObject({ mode: 'free', cursor: node.cursor });
      expect(shown.puzzle?.answer).toBeUndefined();
      expect(shown.nodes[node.cursor].children).toEqual([]);
      await stats();
      const history = ((await cardOf('raduga:1-1-004')) as unknown as { history: { correct: boolean; grade: string }[] }).history;
      expect(history).toMatchObject([{ correct: false, grade: 'Again' }]);
      expect(history).toHaveLength(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('cannot get the engine line');
      ws.close();
    } finally {
      log.mockRestore();
    }
  });

  it('drops the late verdict when the puzzle was given up during the check', async () => {
    engine.on(FORK.fen, FORK_ROOT).on(FORK.fen, FORK_NF6, ['d5f6']);
    const { ws, state } = await start(FORK);
    engine.delayMs = 300;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    expect(stateOf(await ws.next()).puzzle?.phase).toBe('checking');
    ws.send('puzzleGiveUp', {});
    const shown = await ws.until((s) => s.puzzle?.status === 'failed');
    expect(shown.puzzle).toMatchObject({ errors: 0, recorded: true });
    await expect(ws.next(900)).rejects.toThrow('no ws message');
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(now.puzzle).toMatchObject({ status: 'failed', errors: 0 });
    expect(now.puzzle?.feedback).toBeUndefined();
    expect((await stats()).total).toEqual({ attempts: 1, solved: 0 });
    expect(((await cardOf(FORK._id)) as unknown as { history: unknown[] }).history).toHaveLength(1);
    ws.close();
  });

  it('re-runs a check that was in flight when the server restarted', async () => {
    engine.on(FORK.fen, FORK_ROOT).on(FORK.fen, FORK_NF6, ['d5f6']);
    const { ws, state } = await start(FORK);
    engine.delayMs = 400;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    expect(stateOf(await ws.next()).puzzle?.phase).toBe('checking');
    ws.close();
    await board.restart();
    const again = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await again.next()).puzzle?.phase).toBe('checking');
    const judged = await again.until((s) => s.puzzle?.phase === 'feedback');
    expect(judged.puzzle).toMatchObject({ errors: 1, feedback: { kind: 'wrong' } });
    expect((await stats()).total).toEqual({ attempts: 1, solved: 0 });
    again.close();
  });

  it('drops a saved puzzle session without a phase (v1 shape) on start', async () => {
    const { ws } = await start(FORK);
    ws.close();
    await withDb((db) => db.collection('boards').updateOne({}, { $unset: { 'puzzle.phase': '' } }));
    await board.restart();
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(now.puzzle).toBeUndefined();
    expect(now.mode).toBe('free');
  });

  it('grades a solve with a weaker move Hard and keeps the counters in the history and the stats', async () => {
    engine.on(MATE2.fen, MATE2_ROOT);
    const { ws, state } = await start(MATE2);
    ws.send('move', { parentId: state.cursor, uci: 'a1a7' });
    await ws.until((s) => s.puzzle?.phase === 'feedback');
    ws.send('puzzleRetry', {});
    const back = stateOf(await ws.next());
    ws.send('move', { parentId: back.cursor, uci: 'f6g6' });
    const replied = await ws.until((s) => s.puzzle?.phase === 'move');
    ws.send('move', { parentId: replied.cursor, uci: 'a1a8' });
    await ws.until((s) => s.puzzle?.status === 'solved');
    await stats();
    expect(await cardOf(MATE2._id)).toMatchObject({ history: [{ correct: true, grade: 'Hard', weaker: 1, altBetter: false }] });
    expect((await stats()).recent[0]).toMatchObject({ id: MATE2._id, correct: true, weaker: 1 });
    ws.close();
  });
});
