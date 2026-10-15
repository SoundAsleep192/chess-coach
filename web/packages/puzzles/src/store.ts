import { MongoClient, type Collection } from 'mongodb';
import type { PuzzleDoc, PuzzleSource } from '@board/shared';

export const DEFAULT_MONGO_URL = 'mongodb://127.0.0.1:27018/board';

/** Запись задач в базу доски. Коллекцию cards (FSRS) импорт не трогает никогда. */
export class PuzzleStore {
  readonly puzzles: Collection<PuzzleDoc>;
  private readonly client: MongoClient;

  private constructor(client: MongoClient) {
    this.client = client;
    this.puzzles = client.db().collection<PuzzleDoc>('puzzles');
  }

  static async open(url: string = process.env.MONGO_URL ?? DEFAULT_MONGO_URL): Promise<PuzzleStore> {
    // ignoreUndefined: необязательные поля (rating, ref, disputed) не превращаются в null
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000, ignoreUndefined: true });
    await client.connect();
    const store = new PuzzleStore(client);
    await store.puzzles.createIndex({ themes: 1, source: 1, rating: 1 });
    return store;
  }

  /** Задача заменяется целиком по _id: снятый disputed или новое решение не тянут старые поля. */
  async upsert(docs: PuzzleDoc[]): Promise<void> {
    if (docs.length === 0) return;
    await this.puzzles.bulkWrite(
      docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
      { ordered: false },
    );
  }

  /** Удалить задачи источника, которых нет в этом импорте (позиция ушла в отчёт). */
  async removeStale(source: PuzzleSource, keep: string[]): Promise<number> {
    const res = await this.puzzles.deleteMany({ source, _id: { $nin: keep } });
    return res.deletedCount;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
