import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EnginePool, type PoolOptions } from '../src/pool';
import { fakePool } from './fake-engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BARE = 'k7/8/8/8/8/8/8/7K w - - 0 1';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(opts: PoolOptions): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EnginePool)
    .useFactory({ factory: () => EnginePool.start(opts) })
    .compile();
  app = mod.createNestApplication();
  await app.init();
  return app;
}

describe('engine service', () => {
  it('analyses a position and reports health', async () => {
    const a = await start(fakePool({ nodes: 1000 }));
    const res = await request(a.getHttpServer()).post('/analyse').send({ fen: START, multipv: 2 }).expect(200);
    expect(res.body).toEqual({
      fen: START,
      nodes: 1000,
      lines: [
        { move: 'e2e4', cp: 99, depth: 7, pv: ['e2e4', 'e7e5'] },
        { move: 'd2d4', cp: 98, depth: 7, pv: ['d2d4', 'e7e5'] },
      ],
    });
    const only = await request(a.getHttpServer()).post('/analyse').send({ fen: START, searchmoves: ['g1f3'], nodes: 5000 }).expect(200);
    expect(only.body).toMatchObject({ nodes: 5000, lines: [{ move: 'g1f3' }] });
    expect((await request(a.getHttpServer()).get('/health').expect(200)).body).toEqual({
      ok: true,
      version: 'FakeFish 1',
      workers: 1,
      busy: 0,
      queued: 0,
    });
  });

  it('answers 400 with a clear text for a bad FEN, an illegal searchmove and bad limits', async () => {
    const a = await start(fakePool());
    const bad = async (body: object, text: RegExp) => {
      const res = await request(a.getHttpServer()).post('/analyse').send(body).expect(400);
      expect(res.body.message).toMatch(text);
    };
    await bad({ fen: 'not a fen' }, /^bad FEN: /);
    await bad({ fen: START, searchmoves: ['e2e5'] }, /^illegal searchmove e2e5 in /);
    await bad({ fen: START, searchmoves: [] }, /searchmoves must be a non-empty array/);
    await bad({ fen: START, multipv: 6 }, /multipv must be an integer 1..5/);
    await bad({ fen: START, nodes: 5_000_001 }, /nodes must be an integer 1..5000000/);
    await bad({ fen: START, priority: 'urgent' }, /priority must be interactive or batch/);
    await bad({ multipv: 1 }, /fen must be a string/);
  });

  it('answers an empty line list for a mate or stalemate without asking the engine', async () => {
    const a = await start(fakePool({ flags: ['--crash', 'R6k'] }));
    const mated = await request(a.getHttpServer()).post('/analyse').send({ fen: 'R6k/8/6K1/8/8/8/8/8 b - - 0 1' }).expect(200);
    expect(mated.body.lines).toEqual([]);
    const stalemate = await request(a.getHttpServer()).post('/analyse').send({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }).expect(200);
    expect(stalemate.body.lines).toEqual([]);
  });

  it('answers 503 when the queue is full and 500 when the engine dies', async () => {
    const a = await start(fakePool({ maxQueue: 0, flags: ['--delay', '200', '--crash', BARE.split(' ')[0]] }));
    const busy = request(a.getHttpServer()).post('/analyse').send({ fen: START }).then((r) => r.status);
    // ждём, пока движок возьмёт первый запрос: опрос /health с пределом по времени
    const deadline = Date.now() + 5000;
    while ((await request(a.getHttpServer()).get('/health')).body.busy !== 1) {
      if (Date.now() > deadline) throw new Error('the engine never became busy');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const full = await request(a.getHttpServer()).post('/analyse').send({ fen: START }).expect(503);
    expect(full.body.message).toMatch(/queue is full/);
    expect(await busy).toBe(200);
    const dead = await request(a.getHttpServer()).post('/analyse').send({ fen: BARE }).expect(500);
    expect(dead.body.message).toMatch(/^engine failed: engine exited/);
  });

  it('answers 503 with the same JSON from /health when no engine process is alive', async () => {
    const dead = { close: async () => undefined, alive: () => false, version: 'FakeFish 1', stats: () => ({ workers: 1, busy: 0, queued: 0 }) };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EnginePool).useValue(dead).compile();
    app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({ ok: false, version: 'FakeFish 1', workers: 1, busy: 0, queued: 0 });
  });
});
