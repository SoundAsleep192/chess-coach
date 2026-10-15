import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BoardState, PuzzleNextResponse, PuzzleStats } from '@board/shared';
import { card, DISPUTED, FORK, HIGH, MATE1, MATE2, TWO_ROOKS } from './puzzle-fixtures';
import { seed, setupBoardApp, withDb } from './helpers';

const board = setupBoardApp();
const http = () => board.running.http;
const next = async (body: object, status = 200) =>
  (await request(http()).post('/api/puzzles/next').send(body).expect(status)).body as PuzzleNextResponse;

describe('puzzles REST', () => {
  it('puts a puzzle on the board in puzzle mode with the solver at the bottom', async () => {
    await seed(FORK);
    const res = await next({ theme: 'fork' });
    expect(res.puzzle).toMatchObject({ id: FORK._id, kind: 'new', side: 'white', label: FORK.ref, ref: FORK.ref, page: 7 });
    expect(res.state).toMatchObject({ mode: 'puzzle', orientation: 'white', rootFen: FORK.fen, meta: { title: FORK.ref } });
    expect(res.state.puzzle).toMatchObject({ puzzleId: FORK._id, done: 0, status: 'solving', solution: FORK.solution });
    expect(res.state.cursor).toBe(res.state.rootId);
    const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(now.version).toBe(res.state.version);
  });

  it('serves due cards first, never serves disputed puzzles and lists available themes on 404', async () => {
    await seed(MATE1, MATE2, DISPUTED);
    await withDb((db) => db.collection('cards').insertOne(card(MATE2._id, 'polgar', MATE2.themes, new Date(Date.now() - 60_000)) as never));
    expect((await next({ theme: 'mate' })).puzzle).toMatchObject({ id: MATE2._id, kind: 'due' });
    const res = await request(http()).post('/api/puzzles/next').send({ theme: 'fork' }).expect(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
    expect(res.body.message).toContain('fork');
    expect(res.body.available).toEqual(expect.arrayContaining([{ theme: 'mate', count: 2 }, { theme: 'mateIn2', count: 1 }]));
    expect(res.body.available.map((t: { theme: string }) => t.theme)).not.toContain('fork');
  });

  it('serves new book puzzles before Lichess, Lichess when the books have none, and Lichess at once on request', async () => {
    await seed(MATE1, HIGH, TWO_ROOKS, FORK);
    // у Полгар больше попыток, чем у Lichess, но книги всё равно идут первыми
    await withDb((db) => db.collection('cards').insertOne(card('polgar:9999', 'polgar', ['mate'], new Date(Date.now() + 86_400_000)) as never));
    expect((await next({ theme: 'mate', rating: 2250 })).puzzle.id).toBe(TWO_ROOKS._id);
    // по вилке есть только «Радуга»; по мату в книгах больше ничего нет - дальше Lichess
    expect((await next({ theme: 'fork' })).puzzle.id).toBe(FORK._id);
    await withDb((db) => db.collection('cards').insertOne(card(TWO_ROOKS._id, 'polgar', TWO_ROOKS.themes, new Date(Date.now() + 86_400_000)) as never));
    expect((await next({ theme: 'mate', rating: 2250 })).puzzle.id).toBe(HIGH._id);
    expect((await next({ theme: 'mate', rating: 1500, source: 'lichess' })).puzzle.id).toBe(MATE1._id);
  });

  it('picks Lichess puzzles without themes by rating window, widening it, and skips attempted ones', async () => {
    await seed(MATE1, HIGH);
    expect((await next({ source: 'lichess', rating: 1450 })).puzzle.id).toBe(MATE1._id);
    expect((await next({ source: 'lichess', rating: 2000 })).puzzle.id).toBe(HIGH._id);
    expect((await next({ source: 'lichess', rating: 2600 })).puzzle.id).toBe(HIGH._id);
    await withDb((db) => db.collection('cards').insertOne(card(MATE1._id, 'lichess', MATE1.themes, new Date(Date.now() + 86_400_000)) as never));
    expect((await next({ source: 'lichess', rating: 1450 })).puzzle.id).toBe(HIGH._id);
    expect((await next({ source: 'lichess', theme: 'mate', rating: 1450 })).puzzle.id).toBe(HIGH._id);
  });

  it('never serves a disputed puzzle from a due card', async () => {
    await seed(DISPUTED, MATE2);
    const past = (ms: number) => new Date(Date.now() - ms);
    await withDb((db) => db.collection('cards').insertOne(card(DISPUTED._id, 'raduga', DISPUTED.themes, past(120_000)) as never));
    await request(http()).post('/api/puzzles/next').send({ theme: 'fork' }).expect(404);
    await withDb((db) => db.collection('cards').insertOne(card(MATE2._id, 'polgar', MATE2.themes, past(60_000)) as never));
    expect((await next({})).puzzle).toMatchObject({ id: MATE2._id, kind: 'due' });
  });

  it('never serves a disputed Lichess puzzle, with and without a theme', async () => {
    await seed(MATE1, { ...MATE1, _id: 'lichess:d', disputed: true });
    for (let i = 0; i < 12; i++) {
      expect((await next({ source: 'lichess', rating: 1500 })).puzzle.id).toBe(MATE1._id);
      expect((await next({ source: 'lichess', theme: 'mate', rating: 1500 })).puzzle.id).toBe(MATE1._id);
    }
  });

  it('keeps to the rating window when a near puzzle exists, with and without a theme', async () => {
    await seed({ ...MATE1, _id: 'lichess:near', rating: 1480 }, { ...MATE1, _id: 'lichess:far', rating: 1900 });
    // the random pivot lands above 1480 in about half of the runs: that exercises the downward fallback
    for (let i = 0; i < 20; i++) {
      expect((await next({ source: 'lichess', theme: 'mate', rating: 1500 })).puzzle.id).toBe('lichess:near');
      expect((await next({ source: 'lichess', rating: 1500 })).puzzle.id).toBe('lichess:near');
    }
  });

  it('never reuses node ids between two puzzles and grows the version', async () => {
    await seed(FORK, MATE2);
    const a = await next({ id: FORK._id });
    const b = await next({ id: MATE2._id });
    expect(b.state.rootId).not.toBe(a.state.rootId);
    expect(Object.keys(b.state.nodes).some((id) => id in a.state.nodes)).toBe(false);
    expect(b.state.version).toBeGreaterThan(a.state.version);
  });

  it('starts a puzzle by id, also a disputed one, and answers 404 for an unknown id', async () => {
    await seed(DISPUTED);
    expect((await next({ id: DISPUTED._id })).puzzle).toMatchObject({ id: DISPUTED._id, kind: 'id' });
    await request(http()).post('/api/puzzles/next').send({ id: 'lichess:none' }).expect(404);
  });

  it('rejects bad bodies and a bad date', async () => {
    await request(http()).post('/api/puzzles/next').send({ source: 'chesscom' }).expect(400);
    await request(http()).post('/api/puzzles/next').send({ themes: 'fork' }).expect(400);
    await request(http()).post('/api/puzzles/next').send({ rating: 'high' }).expect(400);
    await request(http()).get('/api/puzzles/stats?since=11.10.2026').expect(400);
  });

  it('reports stats by theme and source, the queue by due date and counts per source', async () => {
    await seed(MATE2, FORK, DISPUTED);
    await withDb((db) =>
      db.collection('cards').insertMany([
        card(MATE2._id, 'polgar', MATE2.themes, new Date('2026-10-12T10:00:00Z'), [
          { at: new Date('2026-10-01T10:00:00Z'), correct: true, ms: 4000 },
          { at: new Date('2026-10-05T10:00:00Z'), correct: false, ms: 9000 },
        ], MATE2.ref),
        card(FORK._id, 'raduga', FORK.themes, new Date('2026-10-11T10:00:00Z'), [
          { at: new Date('2026-10-06T10:00:00Z'), correct: true, ms: 7000 },
        ], FORK.ref),
      ] as never[]),
    );
    const all = (await request(http()).get('/api/puzzles/stats').expect(200)).body as PuzzleStats;
    expect(all.since).toBeNull();
    expect(all.total).toEqual({ attempts: 3, solved: 2 });
    expect(all.bySource).toEqual([
      { key: 'polgar', attempts: 2, solved: 1 },
      { key: 'raduga', attempts: 1, solved: 1 },
    ]);
    expect(all.byTheme[0]).toEqual({ key: 'mate', attempts: 2, solved: 1 });
    expect(all.recent[0]).toMatchObject({ id: FORK._id, ref: FORK.ref, correct: true, ms: 7000 });
    expect(all.queue.map((q) => q.id)).toEqual([FORK._id, MATE2._id]);
    expect(all.queue[1].lastCorrect).toBe(false);
    expect(all.counts).toEqual([
      { source: 'polgar', puzzles: 1, disputed: 0 },
      { source: 'raduga', puzzles: 2, disputed: 1 },
    ]);
    const since = (await request(http()).get('/api/puzzles/stats?since=2026-10-04').expect(200)).body as PuzzleStats;
    expect(since.total).toEqual({ attempts: 2, solved: 1 });
  });

  it('coach board load ends the puzzle mode', async () => {
    await seed(FORK);
    await next({});
    const s = await board.load();
    expect(s.mode).toBe('free');
    expect(s.puzzle).toBeUndefined();
  });
});
