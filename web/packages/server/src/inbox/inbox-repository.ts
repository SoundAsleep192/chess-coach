import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient, type Collection } from 'mongodb';
import type { StoredEvent } from './inbox-format';

@Injectable()
export class InboxRepository implements OnApplicationShutdown {
  private readonly client: MongoClient;
  private readonly events: Collection<StoredEvent>;

  constructor() {
    const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/board';
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 3000, ignoreUndefined: true });
    this.events = this.client.db().collection<StoredEvent>('inbox');
  }

  last(): Promise<StoredEvent | null> {
    return this.events.findOne({}, { sort: { _id: -1 } });
  }

  async insert(e: StoredEvent): Promise<void> {
    await this.events.insertOne(e);
  }

  async replace(e: StoredEvent): Promise<void> {
    await this.events.replaceOne({ _id: e._id }, e);
  }

  async unread(limit: number): Promise<{ events: StoredEvent[]; total: number }> {
    const events = await this.events.find({ read: false }).sort({ _id: 1 }).limit(limit).toArray();
    const total = await this.events.countDocuments({ read: false });
    return { events, total };
  }

  async ack(upto: number): Promise<void> {
    await this.events.updateMany({ _id: { $lte: upto }, read: false }, { $set: { read: true } });
  }

  /** Оставить `keep` самых новых событий. */
  async trim(keep: number): Promise<void> {
    const edge = await this.events.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).skip(keep - 1).limit(1).next();
    if (edge) await this.events.deleteMany({ _id: { $lt: edge._id } });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
