import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { BoardState, PuzzleDoc } from '@board/shared';
import { fenAfter, forkEngine, FORK, FORK_NF6, FORK_ROOT, MATE1, MATE2, MATE2_ROOT, STALEMATE_TRAP, TWO_ROOKS } from './puzzle-fixtures';
import { cardOf, engine, puzzleStats, seed, setupBoardApp, startPuzzle, stateOf, withDb } from './helpers';
import { WsProbe } from './ws-probe';

process.env.PUZZLE_REPLY_MS = '20';
const board = setupBoardApp();
const http = () => board.running.http;

const start = (doc: PuzzleDoc) => startPuzzle(board, doc);
const stats = () => puzzleStats(board);

/** Перезапустить приложение с другой задержкой ответа соперника. */
async function withReplyDelay(ms: number, fn: () => Promise<void>): Promise<void> {
  process.env.PUZZLE_REPLY_MS = String(ms);
  try {
    await board.restart();
    await fn();
  } finally {
    process.env.PUZZLE_REPLY_MS = '20';
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('puzzle mode', () => {
  it('says «Верно, продолжайте», plays the opponent reply and records a clean solve', async () => {
    const { ws, state } = await start(FORK);
    expect(state.puzzle).toMatchObject({ phase: 'move', node: state.rootId, onMain: true, errors: 0, recorded: false });
    ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
    const moved = stateOf(await ws.next());
    expect(moved.puzzle).toMatchObject({ done: 1, phase: 'reply', feedback: { kind: 'correct', text: 'Верно, продолжайте' } });
    expect(moved.nodes[moved.cursor]).toMatchObject({ san: 'Nc7+', author: 'student' });
    const replied = stateOf(await ws.next());
    expect(replied.nodes[replied.cursor]).toMatchObject({ san: 'Kd7', author: 'game' });
    expect(replied.puzzle).toMatchObject({ done: 2, phase: 'move', node: replied.cursor });
    ws.send('move', { parentId: replied.cursor, uci: 'c7a8' });
    expect(stateOf(await ws.next())).toMatchObject({ mode: 'free', puzzle: { status: 'solved', done: 3, found: ['d5c7'], recorded: true } });
    const s = await stats();
    expect(s.total).toEqual({ attempts: 1, solved: 1 });
    expect(await cardOf(FORK._id)).toMatchObject({ reps: 1, history: [{ correct: true, grade: 'Good' }] });
    ws.close();
  });

  it('refutes a wrong move on the board, records it once and solves after «Ещё раз»', async () => {
    forkEngine();
    const { ws, state } = await start(FORK);
    expect(state.puzzle).toMatchObject({ classification: 'single', rootAlternatives: [] });
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    const checking = stateOf(await ws.next());
    expect(checking.puzzle).toMatchObject({ phase: 'checking', checking: { moveNode: checking.cursor, created: true } });
    expect(checking.nodes[checking.cursor]).toMatchObject({ san: 'Nf6+', author: 'student' });
    const wrong = stateOf(await ws.next());
    expect(wrong.puzzle).toMatchObject({
      status: 'solving',
      phase: 'feedback',
      errors: 1,
      recorded: true,
      feedback: { kind: 'wrong', text: 'После Nf6+ оценка −8.0 (проигрыш), было +9.0 (выигрыш).' },
    });
    expect(wrong.nodes[wrong.cursor]).toMatchObject({
      san: 'Ke7',
      author: 'game',
      parent: checking.cursor,
      arrows: [
        { from: 'e8', to: 'e7', color: 'red' },
        { from: 'a8', to: 'a1', color: 'blue' },
      ],
    });
    expect((await stats()).total).toEqual({ attempts: 1, solved: 0 });

    ws.send('puzzleRetry', {});
    const again = stateOf(await ws.next());
    expect(again.cursor).toBe(again.rootId);
    expect(again.puzzle).toMatchObject({ phase: 'move' });
    expect(again.puzzle?.feedback).toBeUndefined();
    expect(again.nodes[wrong.cursor].arrows).toEqual([]);

    ws.send('move', { parentId: again.cursor, uci: 'd5c7' });
    const right = stateOf(await ws.next());
    const root = right.nodes[right.rootId];
    expect(root.children.map((id) => right.nodes[id].san)).toEqual(['Nc7+', 'Nf6+']);
    const replied = stateOf(await ws.next());
    ws.send('move', { parentId: replied.cursor, uci: 'c7a8' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ status: 'solved', errors: 1 });
    expect((await stats()).total).toEqual({ attempts: 1, solved: 0 });
    expect(engine.calls.filter((c) => c.opts.searchmoves)).toEqual([
      { fen: FORK.fen, opts: { searchmoves: ['d5f6'], priority: 'interactive' } },
    ]);
    ws.close();
  });

  it('a longer mate is «good but weaker»: yellow text, no reply, not an error', async () => {
    engine.on(MATE2.fen, MATE2_ROOT);
    const { ws, state } = await start(MATE2);
    expect(state.puzzle).toMatchObject({ classification: 'main+weaker', rootAlternatives: [] });
    ws.send('move', { parentId: state.cursor, uci: 'a1a7' });
    await ws.next();
    const weaker = stateOf(await ws.next());
    expect(weaker.puzzle).toMatchObject({
      phase: 'feedback',
      weaker: 1,
      errors: 0,
      recorded: false,
      feedback: { kind: 'weaker', text: 'Хороший ход, но есть сильнее. Оценка #3, лучший ход даёт мат в 2.' },
    });
    expect(weaker.nodes[weaker.cursor]).toMatchObject({ san: 'Ra7', children: [] });
    ws.send('puzzleRetry', {});
    const again = stateOf(await ws.next());
    ws.send('move', { parentId: again.cursor, uci: 'f6g6' });
    await ws.next();
    const replied = stateOf(await ws.next());
    ws.send('move', { parentId: replied.cursor, uci: 'a1a8' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ status: 'solved', weaker: 1 });
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });

  it('accepts a move stronger than the book, asks for the book move once and goes on with engine replies', async () => {
    // книга: Nc7+ (+9.0), движок: Nf6+ сильнее (+9.5), а Nc7+ в тройку не входит
    const better = { ...FORK, _id: 'raduga:1-1-003' };
    engine
      .on(FORK.fen, [
        { move: 'd5f6', cp: 950, pv: ['d5f6', 'e8e7', 'f6d5'] },
        { move: 'g1g2', cp: 0, pv: ['g1g2'] },
        { move: 'g1h2', cp: -10, pv: ['g1h2'] },
      ])
      .on(FORK.fen, [{ move: 'd5c7', cp: 900, pv: ['d5c7', 'e8d7', 'c7a8'] }], ['d5c7'])
      .on(fenAfter(FORK.fen, ['d5f6', 'e8e7']), [{ move: 'f6d5', cp: 900, pv: ['f6d5', 'e7d7'] }]);
    const { ws, state } = await start(better);
    expect(state.puzzle).toMatchObject({ classification: 'multiple', rootAlternatives: ['d5f6'] });
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    const reply = await ws.until((s) => s.puzzle?.phase === 'reply');
    expect(reply.puzzle).toMatchObject({ onMain: false, altBetter: true, reply: 'e8e7', feedback: { kind: 'correct' } });
    const node = await ws.until((s) => s.puzzle?.phase === 'move');
    expect(node.nodes[node.cursor]).toMatchObject({ san: 'Ke7', author: 'game' });
    ws.send('move', { parentId: node.cursor, uci: 'f6d5' });
    const solved = await ws.until((s) => s.puzzle?.status === 'solved');
    expect(solved.puzzle).toMatchObject({ onMain: false, altBetter: true, found: ['d5f6'] });
    expect(engine.calls.filter((c) => c.opts.searchmoves?.[0] === 'd5c7')).toHaveLength(1);
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });

  it('a stalemating move is a mistake without a refutation', async () => {
    engine.on(STALEMATE_TRAP.fen, [{ move: 'e7e8', mate: 1, pv: ['e7e8'] }]);
    const { ws, state } = await start(STALEMATE_TRAP);
    ws.send('move', { parentId: state.cursor, uci: 'e7f7' });
    await ws.next();
    const wrong = stateOf(await ws.next());
    expect(wrong.puzzle).toMatchObject({ phase: 'feedback', errors: 1, feedback: { kind: 'wrong', text: 'Мат упущен. После Qf7 оценка 0.0 (равно).' } });
    expect(wrong.nodes[wrong.cursor]).toMatchObject({ san: 'Qf7', children: [], arrows: [] });
    expect(engine.calls.some((c) => c.opts.searchmoves?.includes('e7f7'))).toBe(false);
    ws.close();
  });

  it('accepts another mate at once, without the engine', async () => {
    const { ws, state } = await start(TWO_ROOKS);
    ws.send('move', { parentId: state.cursor, uci: 'b1b8' });
    expect(stateOf(await ws.next())).toMatchObject({ mode: 'free', puzzle: { status: 'solved', found: ['b1b8'] } });
    ws.close();
  });

  it('rejects a second move while the first is being checked and still applies the verdict', async () => {
    forkEngine();
    const { ws, state } = await start(FORK);
    engine.delayMs = 300;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    expect(stateOf(await ws.next()).puzzle?.phase).toBe('checking');
    ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen', message: 'wait: the move is being checked' } });
    await ws.next();
    expect((await ws.until((s) => s.puzzle?.phase === 'feedback')).puzzle).toMatchObject({ errors: 1, feedback: { kind: 'wrong' } });
    ws.close();
  });

  it('drops a late verdict after the coach replaced the board', async () => {
    forkEngine();
    const { ws, state } = await start(FORK);
    engine.delayMs = 300;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    await ws.next();
    const loaded = await board.load();
    expect(stateOf(await ws.next()).version).toBe(loaded.version);
    await expect(ws.next(700)).rejects.toThrow('no ws message');
    const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(now.version).toBe(loaded.version);
    expect(now.puzzle).toBeUndefined();
    expect((await stats()).total.attempts).toBe(0);
    ws.close();
  });

  it('drops a late verdict after another puzzle was started while the move was being checked', async () => {
    forkEngine();
    const { ws, state } = await start(FORK);
    engine.delayMs = 300;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    await ws.next();
    engine.delayMs = 0; // the check in flight keeps sleeping; the new puzzle starts at once
    await withDb((db) => db.collection<PuzzleDoc>('puzzles').replaceOne({ _id: MATE1._id }, MATE1, { upsert: true }));
    await request(http()).post('/api/puzzles/next').send({ id: MATE1._id }).expect(200);
    const started = stateOf(await ws.next());
    expect(started.puzzle).toMatchObject({ puzzleId: MATE1._id, phase: 'move', errors: 0 });
    await expect(ws.next(700)).rejects.toThrow('no ws message');
    const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(now.version).toBe(started.version);
    expect(now.puzzle).toMatchObject({ puzzleId: MATE1._id, phase: 'move', errors: 0, recorded: false });
    expect((await stats()).total.attempts).toBe(0);
    ws.close();
  });

  it('with the engine down takes back a move it cannot check, records nothing and still accepts the solution', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ws, state } = await start(FORK);
    engine.down = true;
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    expect(stateOf(await ws.next()).puzzle?.phase).toBe('checking');
    const back = stateOf(await ws.next());
    expect(back.cursor).toBe(back.rootId);
    expect(back.nodes[back.rootId].children).toEqual([]);
    expect(back.puzzle).toMatchObject({ phase: 'move', errors: 0, feedback: { kind: 'unavailable', text: 'Не могу проверить ход: движок недоступен' } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('cannot check d5f6 in raduga:1-1-001');
    ws.send('move', { parentId: back.cursor, uci: 'd5c7' });
    expect(stateOf(await ws.next()).puzzle).toMatchObject({ phase: 'reply', feedback: { kind: 'correct' } });
    const replied = stateOf(await ws.next());
    ws.send('move', { parentId: replied.cursor, uci: 'c7a8' });
    expect(stateOf(await ws.next()).puzzle?.status).toBe('solved');
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });

  it('rejects an illegal move and navigation without failing the puzzle', async () => {
    const { ws, state } = await start(FORK);
    ws.send('move', { parentId: state.cursor, uci: 'd5d6' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'illegal' } });
    expect(stateOf(await ws.next()).puzzle?.status).toBe('solving');
    ws.send('navigate', { nodeId: state.rootId });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    await ws.next();
    ws.send('move', { parentId: 'n999', uci: 'd5c7' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'not_found' } });
    await ws.next();
    ws.send('puzzleRetry', {});
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen', message: 'nothing to retry: the puzzle waits for a move' } });
    await ws.next();
    expect((await stats()).total.attempts).toBe(0);
    ws.close();
  });

  it('rejects a move while the opponent reply is pending and still plays the reply', async () => {
    await withReplyDelay(400, async () => {
      const { ws, state } = await start(FORK);
      ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
      const moved = stateOf(await ws.next());
      ws.send('move', { parentId: moved.cursor, uci: 'e8d7' });
      expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen', message: 'wait for the opponent reply' } });
      await ws.next();
      const replied = stateOf(await ws.next(2000));
      expect(replied.nodes[replied.cursor].san).toBe('Kd7');
      ws.close();
    });
  });

  it('a pending reply does not land in a tree the coach replaced', async () => {
    await withReplyDelay(500, async () => {
      const { ws, state } = await start(FORK);
      ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
      await ws.next();
      const loaded = await board.load();
      expect(stateOf(await ws.next()).version).toBe(loaded.version);
      await expect(ws.next(900)).rejects.toThrow('no ws message');
      const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
      expect(now.version).toBe(loaded.version);
      expect(now.puzzle).toBeUndefined();
      expect((await stats()).total.attempts).toBe(0);
      ws.close();
    });
  });

  it('resumes the opponent reply after a server restart', async () => {
    // задержка с запасом: таймер нового приложения стартует в onModuleInit, раньше, чем откроется вкладка
    await withReplyDelay(1000, async () => {
      const { ws, state } = await start(FORK);
      ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
      await ws.next();
      ws.close();
      await board.restart();
      const again = await WsProbe.open(board.running.wsUrl);
      expect(stateOf(await again.next()).puzzle).toMatchObject({ done: 1, phase: 'reply' });
      const replied = stateOf(await again.next(3000));
      expect(replied.nodes[replied.cursor].san).toBe('Kd7');
      again.close();
    });
  });

  it('brings a puzzle with a mistake back before a solved one', async () => {
    const a = await start(MATE1);
    a.ws.send('move', { parentId: a.state.cursor, uci: 'h5f7' });
    expect(stateOf(await a.ws.next()).puzzle?.status).toBe('solved');
    a.ws.close();
    forkEngine();
    const b = await start(FORK);
    b.ws.send('move', { parentId: b.state.cursor, uci: 'd5f6' });
    await b.ws.until((s) => s.puzzle?.phase === 'feedback');
    b.ws.close();
    expect((await stats()).queue.map((q) => q.id)).toEqual([FORK._id, MATE1._id]);
  });

  it('updates the existing card on a second attempt: a mistake, then a clean solve', async () => {
    forkEngine();
    const first = await start(FORK);
    first.ws.send('move', { parentId: first.state.cursor, uci: 'd5f6' });
    await first.ws.until((s) => s.puzzle?.phase === 'feedback');
    first.ws.close();
    await stats();
    const second = await start(FORK);
    second.ws.send('move', { parentId: second.state.cursor, uci: 'd5c7' });
    await second.ws.next();
    const replied = stateOf(await second.ws.next());
    second.ws.send('move', { parentId: replied.cursor, uci: 'c7a8' });
    expect(stateOf(await second.ws.next()).puzzle?.status).toBe('solved');
    expect((await stats()).total).toEqual({ attempts: 2, solved: 1 });
    expect(await cardOf(FORK._id)).toMatchObject({
      reps: 2,
      lapses: 0,
      history: [
        { correct: false, grade: 'Again' },
        { correct: true, grade: 'Good' },
      ],
    });
    second.ws.close();
  });

  it('grades a correct but slow solve Hard', async () => {
    await seed(MATE1);
    await request(http()).post('/api/puzzles/next').send({ id: MATE1._id }).expect(200);
    const old = new Date(Date.now() - 120_000).toISOString();
    await withDb((db) => db.collection('boards').updateOne({}, { $set: { 'puzzle.startedAt': old } }));
    await board.restart();
    const ws = await WsProbe.open(board.running.wsUrl);
    const state = stateOf(await ws.next());
    ws.send('move', { parentId: state.cursor, uci: 'h5f7' });
    expect(stateOf(await ws.next()).puzzle?.status).toBe('solved');
    await stats();
    const saved = await cardOf(MATE1._id);
    expect(saved).toMatchObject({ history: [{ correct: true, grade: 'Hard' }] });
    expect((saved as unknown as { history: { ms: number }[] }).history[0].ms).toBeGreaterThan(60_000);
    ws.close();
  });

  it('ends a puzzle whose solution has an even length after the opponent reply', async () => {
    const { ws, state } = await start({ ...FORK, _id: 'raduga:1-1-009', solution: ['d5c7', 'e8d7'] });
    ws.send('move', { parentId: state.cursor, uci: 'd5c7' });
    await ws.next();
    const done = stateOf(await ws.next());
    expect(done).toMatchObject({ mode: 'free', puzzle: { status: 'solved', done: 2 } });
    expect(done.nodes[done.cursor].san).toBe('Kd7');
    expect((await stats()).total).toEqual({ attempts: 1, solved: 1 });
    ws.close();
  });
});
