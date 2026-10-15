import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { MongoClient, type Collection, type Document, type Filter } from 'mongodb';
import type { PuzzleDoc, PuzzleGrade, PuzzleSource, ThemeCount } from '@board/shared';
import { puzzleFilter } from './puzzle-logic';

export interface CardHistory {
  at: Date;
  correct: boolean;
  ms: number;
  grade: PuzzleGrade;
  /** Ходов «хороший, но слабее» в попытке. В записях до v2 поля нет. */
  weaker?: number;
  /** Ученик сыграл ход сильнее записанного решения. */
  altBetter?: boolean;
}

/** Карточка FSRS (поля ts-fsrs) и история попыток. _id - id задачи; source, themes и ref - для статистики. */
export interface CardDoc {
  _id: string;
  source: PuzzleSource;
  themes: string[];
  ref?: string;
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: Date;
  history: CardHistory[];
}

const CANDIDATES = 20;
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomId(): string {
  return Array.from({ length: 5 }, () => ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]).join('');
}

@Injectable()
export class PuzzleRepository implements OnModuleInit, OnApplicationShutdown {
  private readonly client: MongoClient;
  readonly puzzles: Collection<PuzzleDoc>;
  readonly cards: Collection<CardDoc>;

  constructor() {
    const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/board';
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 3000, ignoreUndefined: true });
    this.puzzles = this.client.db().collection<PuzzleDoc>('puzzles');
    this.cards = this.client.db().collection<CardDoc>('cards');
  }

  async onModuleInit(): Promise<void> {
    await this.puzzles.createIndex({ themes: 1, source: 1, rating: 1 });
    await this.cards.createIndex({ due: 1 });
  }

  getPuzzle(id: string): Promise<PuzzleDoc | null> {
    return this.puzzles.findOne({ _id: id });
  }

  /** Самая просроченная карточка нужных тем и источника. */
  async firstDue(now: Date, themes: string[], source?: PuzzleSource): Promise<PuzzleDoc | null> {
    const [row] = await this.cards
      .aggregate<{ p: PuzzleDoc }>([
        { $match: { due: { $lte: now } } },
        { $sort: { due: 1, _id: 1 } },
        { $lookup: { from: 'puzzles', localField: '_id', foreignField: '_id', as: 'p' } },
        { $unwind: '$p' },
        { $match: puzzleFilter(themes, source, 'p.') },
        { $limit: 1 },
        { $project: { p: 1 } },
      ])
      .toArray();
    return row?.p ?? null;
  }

  async attemptedIds(): Promise<string[]> {
    return (await this.cards.find({}, { projection: { _id: 1 } }).toArray()).map((c) => c._id);
  }

  async attemptsBySource(): Promise<Partial<Record<PuzzleSource, number>>> {
    const rows = await this.cards
      .aggregate<{ _id: PuzzleSource; n: number }>([{ $group: { _id: '$source', n: { $sum: { $size: '$history' } } } }])
      .toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  /**
   * Книги идут по порядку: _id вида polgar:0123 и raduga:3-1-021 сортируется как номера книги.
   * Диапазон по префиксу _id не даёт обходить 1.6M задач Lichess, которые идут в _id раньше.
   */
  firstNewBook(source: PuzzleSource, themes: string[], exclude: string[]): Promise<PuzzleDoc | null> {
    const { source: _source, ...rest } = puzzleFilter(themes, source);
    const filter = { ...rest, _id: { $gte: `${source}:`, $lt: `${source};`, $nin: exclude } } as Filter<PuzzleDoc>;
    return this.puzzles.find(filter).sort({ _id: 1 }).limit(1).next();
  }

  /**
   * Случайная новая задача Lichess в окне рейтинга ±100, ±200, ±400, затем любая. Без выборки по всей коллекции:
   * с темами идём по индексу {themes, source, rating} от случайного рейтинга окна, без тем - по _id от случайной точки
   * (_id у Lichess случайные, так что отбор равномерный и быстрый на любой доле подходящих задач).
   */
  async sampleNewLichess(themes: string[], exclude: string[], rating?: number): Promise<PuzzleDoc | null> {
    const windows = rating === undefined ? [Infinity] : [100, 200, 400, Infinity];
    for (const w of windows) {
      const range = rating !== undefined && w !== Infinity ? { lo: rating - w, hi: rating + w } : undefined;
      const doc = themes.length > 0 ? await this.sampleByRating(themes, exclude, range) : await this.sampleById(exclude, range);
      if (doc) return doc;
    }
    return null;
  }

  private pickOne(docs: PuzzleDoc[]): PuzzleDoc | null {
    return docs.length > 0 ? docs[Math.floor(Math.random() * docs.length)] : null;
  }

  private async sampleByRating(themes: string[], exclude: string[], range?: { lo: number; hi: number }): Promise<PuzzleDoc | null> {
    const lo = range?.lo ?? 600;
    const hi = range?.hi ?? 2800;
    const pivot = lo + Math.floor(Math.random() * (hi - lo + 1));
    const base = { ...puzzleFilter(themes, 'lichess'), _id: { $nin: exclude } };
    const find = (rating: Document, sort: 1 | -1) =>
      this.puzzles
        .find({ ...base, rating } as Filter<PuzzleDoc>, { hint: 'themes_1_source_1_rating_1' })
        .sort({ rating: sort })
        .limit(CANDIDATES)
        .toArray();
    const up = await find(range ? { $gte: pivot, $lte: range.hi } : { $gte: pivot }, 1);
    if (up.length > 0) return this.pickOne(up);
    return this.pickOne(await find(range ? { $gte: range.lo, $lt: pivot } : { $lt: pivot }, -1));
  }

  private async sampleById(exclude: string[], range?: { lo: number; hi: number }): Promise<PuzzleDoc | null> {
    const base: Document = { ...puzzleFilter([], 'lichess') };
    if (range) base.rating = { $gte: range.lo, $lte: range.hi };
    const pivot = `lichess:${randomId()}`;
    const find = (id: Document, sort: 1 | -1) =>
      this.puzzles
        .find({ ...base, _id: { ...id, $nin: exclude } } as Filter<PuzzleDoc>, { hint: { _id: 1 } })
        .sort({ _id: sort })
        .limit(CANDIDATES)
        .toArray();
    const up = await find({ $gte: pivot, $lt: 'lichess;' }, 1);
    if (up.length > 0) return this.pickOne(up);
    return this.pickOne(await find({ $gte: 'lichess:', $lt: pivot }, 1));
  }

  async availableThemes(source?: PuzzleSource): Promise<ThemeCount[]> {
    const rows = await this.puzzles
      .aggregate<{ _id: string; count: number }>([
        { $match: puzzleFilter([], source) },
        { $unwind: '$themes' },
        { $group: { _id: '$themes', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .toArray();
    return rows.map((r) => ({ theme: r._id, count: r.count }));
  }

  getCard(id: string): Promise<CardDoc | null> {
    return this.cards.findOne({ _id: id });
  }

  async saveCard(card: CardDoc): Promise<void> {
    await this.cards.replaceOne({ _id: card._id }, card, { upsert: true });
  }

  /** Карточек столько, сколько задач ученик пробовал, - сотни, а не миллионы: статистика считается в коде. */
  allCards(): Promise<CardDoc[]> {
    return this.cards.find({}).toArray();
  }

  async countsBySource(): Promise<{ source: PuzzleSource; puzzles: number; disputed: number }[]> {
    const rows = await this.puzzles
      .aggregate<{ _id: PuzzleSource; puzzles: number; disputed: number }>([
        {
          $group: {
            _id: '$source',
            puzzles: { $sum: 1 },
            disputed: { $sum: { $cond: [{ $eq: ['$disputed', true] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    return rows.map((r) => ({ source: r._id, puzzles: r.puzzles, disputed: r.disputed }));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
