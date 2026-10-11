import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient, type Collection } from 'mongodb';
import type { BoardState } from '@board/shared';
import { BoardRepository } from './board-repository';

export const BOARD_ID = 'main';
type BoardDoc = Omit<BoardState, 'updatedAt'> & { _id: string; updatedAt: Date };

@Injectable()
export class MongoBoardRepository extends BoardRepository implements OnApplicationShutdown {
  private readonly client: MongoClient;
  private readonly boards: Collection<BoardDoc>;

  constructor() {
    super();
    const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/board';
    // ignoreUndefined: необязательные поля (meta.title, meta.gameId) не должны превращаться в null.
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 3000, ignoreUndefined: true });
    this.boards = this.client.db().collection<BoardDoc>('boards');
  }

  async load(): Promise<BoardState | null> {
    const doc = await this.boards.findOne({ _id: BOARD_ID });
    if (!doc) return null;
    const { _id, updatedAt, ...rest } = doc;
    return { ...rest, updatedAt: updatedAt.toISOString() };
  }

  async save(state: BoardState): Promise<void> {
    const doc: BoardDoc = { ...state, _id: BOARD_ID, updatedAt: new Date(state.updatedAt) };
    await this.boards.replaceOne({ _id: BOARD_ID }, doc, { upsert: true });
  }

  async ping(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
