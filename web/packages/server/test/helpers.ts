import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { BoardState, PuzzleDoc, PuzzleStats, ServerMessage } from '@board/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure';
import { ENGINE_CLIENT } from '../src/engine/analysis.service';
import { FakeEngineClient } from './fake-engine';
import { WsProbe } from './ws-probe';

export const MONGO_VERSION = '9.0.2';
/** Поддельный сервис движка на файл тестов: записи сбрасываются перед каждым тестом. */
export const engine = new FakeEngineClient();
export const GAME = '[White "a"]\n[Black "b"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';

export interface Running {
  app: NestExpressApplication;
  http: ReturnType<NestExpressApplication['getHttpServer']>;
  wsUrl: string;
}

export async function startApp(): Promise<Running> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENGINE_CLIENT).useValue(engine).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, http: app.getHttpServer(), wsUrl: `ws://127.0.0.1:${port}/ws` };
}

export interface BoardHarness {
  readonly running: Running;
  readonly mongo: MongoMemoryServer;
  restart(): Promise<void>;
  load(body?: object): Promise<BoardState>;
}

/** Mongo в памяти на файл тестов, чистая коллекция и свежий сервер на каждый тест. */
export function setupBoardApp(): BoardHarness {
  let mongo: MongoMemoryServer;
  let running: Running;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: MONGO_VERSION } });
    process.env.MONGO_URL = mongo.getUri('board');
  });
  afterAll(async () => {
    await mongo.stop();
  });
  beforeEach(async () => {
    const client = new MongoClient(process.env.MONGO_URL!);
    await client.db().collection('boards').deleteMany({});
    await client.db().collection('puzzles').deleteMany({});
    await client.db().collection('cards').deleteMany({});
    await client.db().collection('inbox').deleteMany({});
    await client.close();
    engine.reset();
    running = await startApp();
  });
  afterEach(async () => {
    await running.app.close();
  });
  return {
    get running() {
      return running;
    },
    get mongo() {
      return mongo;
    },
    async restart() {
      await running.app.close();
      running = await startApp();
    },
    async load(body: object = { pgn: GAME, cursorPly: 3, orientation: 'black' }) {
      const res = await request(running.http).put('/api/board').send(body).expect(200);
      return res.body as BoardState;
    },
  };
}

/** Прямой доступ к базе теста: засеять задачи и карточки, проверить, что записал сервер. */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL!);
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

export function seed(...docs: PuzzleDoc[]): Promise<unknown> {
  return withDb((db) => db.collection<PuzzleDoc>('puzzles').insertMany(docs));
}

/** Сообщение сервера как состояние доски. */
export function stateOf(m: ServerMessage): BoardState {
  expect(m.event).toBe('state');
  return (m as { event: 'state'; data: BoardState }).data;
}

/** Засеять задачу, подключить сокет и поставить задачу на доску. */
export async function startPuzzle(board: BoardHarness, doc: PuzzleDoc): Promise<{ ws: WsProbe; state: BoardState }> {
  await withDb((db) => db.collection<PuzzleDoc>('puzzles').replaceOne({ _id: doc._id }, doc, { upsert: true }));
  const ws = await WsProbe.open(board.running.wsUrl);
  await ws.next();
  await request(board.running.http).post('/api/puzzles/next').send({ id: doc._id }).expect(200);
  return { ws, state: stateOf(await ws.next()) };
}

export async function puzzleStats(board: BoardHarness): Promise<PuzzleStats> {
  return (await request(board.running.http).get('/api/puzzles/stats').expect(200)).body as PuzzleStats;
}

export const cardOf = (id: string) => withDb((db) => db.collection('cards').findOne({ _id: id } as never));
