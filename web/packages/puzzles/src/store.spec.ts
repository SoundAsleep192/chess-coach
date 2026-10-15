import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { PuzzleDoc } from '@board/shared';
import { PuzzleStore } from './store.ts';
import { useMongo } from './testing/mongo.ts';

const mongo = useMongo();

const doc = (id: string, fen = '7k/8/5K2/8/8/8/8/R7 w - - 0 1'): PuzzleDoc => ({
  _id: id,
  source: 'polgar',
  fen,
  solution: ['f6g6', 'h8g8', 'a1a8'],
  themes: ['mate', 'mateIn2'],
  ref: `Полгар №${id.slice(-4)}`,
  solutionFrom: 'book',
});

describe('PuzzleStore', () => {
  it('re-import replaces puzzles and keeps cards', async () => {
    const client = new MongoClient(mongo.url());
    const card = { _id: 'polgar:0001', due: new Date('2026-10-12T00:00:00Z'), history: [{ correct: false }] };
    await client.db().collection('cards').insertOne(card as never);
    const store = await PuzzleStore.open(mongo.url());
    try {
      await store.upsert([{ ...doc('polgar:0001'), disputed: true }]);
      await store.upsert([doc('polgar:0001')]);
      const saved = await store.puzzles.findOne({ _id: 'polgar:0001' });
      expect(saved).toEqual(doc('polgar:0001'));
      expect(await client.db().collection('cards').findOne({ _id: 'polgar:0001' } as never)).toEqual(card);
    } finally {
      await store.close();
      await client.close();
    }
  });

  it('removes stale book puzzles of one source only', async () => {
    const store = await PuzzleStore.open(mongo.url());
    try {
      await store.upsert([doc('polgar:0001'), doc('polgar:0002'), { ...doc('raduga:1-001'), source: 'raduga' }]);
      expect(await store.removeStale('polgar', ['polgar:0001'])).toBe(1);
      expect((await store.puzzles.find().toArray()).map((p) => p._id).sort()).toEqual(['polgar:0001', 'raduga:1-001']);
    } finally {
      await store.close();
    }
  });
});
