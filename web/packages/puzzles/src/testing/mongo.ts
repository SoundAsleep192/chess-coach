import { afterAll, beforeAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

export const MONGO_VERSION = '9.0.2';

/** Mongo в памяти на файл тестов; перед каждым тестом база board пустая. */
export function useMongo(): { url(): string } {
  let mongo: MongoMemoryServer;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: MONGO_VERSION } });
  });
  afterAll(async () => {
    await mongo.stop();
  });
  beforeEach(async () => {
    const client = new MongoClient(mongo.getUri('board'));
    await client.db().dropDatabase();
    await client.close();
  });
  return { url: () => mongo.getUri('board') };
}
