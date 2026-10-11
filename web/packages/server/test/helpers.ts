import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { BoardState } from '@board/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure';

export const MONGO_VERSION = '9.0.2';
export const GAME = '[White "a"]\n[Black "b"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';

export interface Running {
  app: NestExpressApplication;
  http: ReturnType<NestExpressApplication['getHttpServer']>;
  wsUrl: string;
}

export async function startApp(): Promise<Running> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await client.close();
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
