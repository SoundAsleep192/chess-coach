import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename } from 'node:path';
import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { ImportReport } from '../report.ts';
import { PuzzleStore } from '../store.ts';
import { FakeEngine } from '../testing/fake-engine.ts';
import { useMongo } from '../testing/mongo.ts';
import { importGames } from './import.ts';
import type { ReviewFile } from './review.ts';

const mongo = useMongo();

/** Мат в 1 ладьёй a1-a8, пропущенный ходом Kf1; разные пешки b7/c7/d7 дают разные позиции. */
const pos = (pawn: 'b7' | 'c7' | 'd7') => `6k1/${{ b7: '1p3ppp', c7: '2p2ppp', d7: '3p1ppp' }[pawn]}/8/8/8/8/8/R5K1 w - - 0 1`;
const withEngine = (e: FakeEngine, fen: string) =>
  e.on(fen, [{ move: 'a1a8', mate: 1 }, { move: 'g1f1', cp: 0 }, { move: 'g1h1', cp: 0 }]);
const engineFor = (...fens: string[]) => fens.reduce(withEngine, new FakeEngine());

const review = (id: string, date: string | undefined, plies: [number, string][]): ReviewFile => ({
  id,
  meta: { color: 'white', ...(date ? { date } : {}), opponent: 'Rival' },
  moves: plies.map(([ply, fen]) => ({ ply, color: 'white', san: 'Kf1', uci: 'g1f1', fen_before: fen, class: 'blunder' })),
});

const run = async (reviews: ReviewFile[], engine: FakeEngine, game?: string) => {
  const store = await PuzzleStore.open(mongo.url());
  const report = new ImportReport('games');
  try {
    await importGames(reviews, engine, store, report, { game, concurrency: 2 });
    return { report, docs: await store.gamesPuzzles() };
  } finally {
    await store.close();
  }
};

const withDb = async <T>(fn: (c: MongoClient) => Promise<T>): Promise<T> => {
  const client = new MongoClient(mongo.url());
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
};

describe('importGames', () => {
  it('writes PuzzleDoc with source games, ref, gameId, ply, played, gameDate', async () => {
    const { docs, report } = await run([review('g1', '2025-11-09T10:00:00', [[5, pos('b7')]])], engineFor(pos('b7')));
    expect(docs).toEqual([
      {
        _id: 'games:g1-005',
        source: 'games',
        fen: pos('b7'),
        solution: ['a1a8'],
        themes: ['ownGame', 'missedWin', 'onlyMove', 'mate'],
        solutionFrom: 'engine',
        ref: 'Партия с Rival, 09.11.2025, 3.',
        gameId: 'g1',
        ply: 5,
        played: 'g1f1',
        gameDate: '2025-11-09T10:00:00',
      },
    ]);
    expect(report.total).toBe(1);
    expect(report.imported).toBe(1);
    expect(report.fromEngine).toBe(1);
  });

  it('same position in two games -> one puzzle, id of the earlier game, gameDate of the later', async () => {
    const later = review('late', '2025-03-01T00:00:00', [[7, pos('b7')]]);
    const earlierGame = review('early', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    const { docs, report } = await run([later, earlierGame], engineFor(pos('b7')));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ _id: 'games:early-005', gameId: 'early', ply: 5, gameDate: '2025-03-01T00:00:00' });
    expect(docs[0].ref).toContain('01.01.2025');
    expect(report.total).toBe(2);
    expect(report.imported).toBe(1);
    expect(report.toMarkdown()).toContain('склеено повторов позиции: 1');
  });

  it('full run takes gameDate only from this run, --game keeps the max with the stored date', async () => {
    const late = review('late', '2025-03-01T00:00:00', [[7, pos('b7')]]);
    const early = review('early', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    await run([late], engineFor(pos('b7')));
    const full = await run([early], engineFor(pos('b7')));
    expect(full.docs).toHaveLength(1);
    expect(full.docs[0]).toMatchObject({ _id: 'games:late-007', gameDate: '2025-01-01T00:00:00' });
    await run([late], engineFor(pos('b7')));
    const single = await run([early], engineFor(pos('b7')), 'early');
    expect(single.docs[0]).toMatchObject({ _id: 'games:late-007', gameDate: '2025-03-01T00:00:00' });
  });

  it('two OTB games with the same date -> earlier is the smaller game id', async () => {
    const date = '2025-11-09T00:00:00';
    const a = review('a-game', date, [[5, pos('b7')]]);
    const b = review('b-game', date, [[5, pos('b7')]]);
    for (const order of [[a, b], [b, a]]) {
      const { docs } = await run(order, engineFor(pos('b7')));
      expect(docs.map((d) => d._id)).toEqual(['games:a-game-005']);
      await withDb((c) => c.db().dropDatabase());
    }
  });

  it('existing puzzle keeps its id when a newer game repeats the position (--game)', async () => {
    await run([review('old', '2025-01-01T00:00:00', [[5, pos('b7')]])], engineFor(pos('b7')));
    await withDb((c) => c.db().collection('cards').insertOne({ _id: 'games:old-005' } as never));
    const { docs } = await run([review('new', '2025-03-01T00:00:00', [[9, pos('b7')]])], engineFor(pos('b7')), 'new');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ _id: 'games:old-005', gameId: 'old', ply: 5, gameDate: '2025-03-01T00:00:00' });
    expect(await withDb((c) => c.db().collection('cards').countDocuments({ _id: 'games:old-005' } as never))).toBe(1);
  });

  it('full run after --game keeps the existing id even if an earlier game has the position', async () => {
    const early = review('early', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    const late = review('late', '2025-03-01T00:00:00', [[7, pos('b7')]]);
    await run([late], engineFor(pos('b7')), 'late');
    const { docs } = await run([early, late], engineFor(pos('b7')));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ _id: 'games:late-007', gameId: 'late', ply: 7, gameDate: '2025-03-01T00:00:00' });
    // повтор полного прогона ничего не меняет
    const again = await run([early, late], engineFor(pos('b7')));
    expect(again.docs).toEqual(docs);
  });

  it('full run removes stale games puzzles but never touches cards', async () => {
    const a = review('a', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    const b = review('b', '2025-02-01T00:00:00', [[5, pos('c7')]]);
    await run([a, b], engineFor(pos('b7'), pos('c7')));
    await withDb(async (c) => {
      await c.db().collection('cards').insertMany([{ _id: 'games:b-005' }, { _id: 'games:a-005' }] as never);
      await c.db().collection('puzzles').insertOne({ _id: 'polgar:1', source: 'polgar', fen: 'x', solution: [], themes: [], solutionFrom: 'book' } as never);
    });
    const { docs } = await run([a], engineFor(pos('b7')));
    expect(docs.map((d) => d._id)).toEqual(['games:a-005']);
    await withDb(async (c) => {
      expect(await c.db().collection('cards').countDocuments()).toBe(2);
      expect(await c.db().collection('puzzles').countDocuments({ source: 'polgar' })).toBe(1);
    });
  });

  it('--game removes only stale puzzles of that game', async () => {
    const a = review('a', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    const b = review('b', '2025-02-01T00:00:00', [[5, pos('c7')]]);
    await run([a, b], engineFor(pos('b7'), pos('c7')));
    const fixed: ReviewFile = { ...a, moves: a.moves.map((m) => ({ ...m, class: 'ok' as const })) };
    const { docs } = await run([fixed], new FakeEngine(), 'a');
    expect(docs.map((d) => d._id)).toEqual(['games:b-005']);
  });

  it('engine error keeps the previous puzzle of that candidate', async () => {
    const a = review('a', '2025-01-01T00:00:00', [[5, pos('b7')]]);
    await run([a], engineFor(pos('b7')));
    const { docs, report } = await run([a], new FakeEngine());
    expect(docs.map((d) => d._id)).toEqual(['games:a-005']);
    expect(report.count('engine_error')).toBe(1);
    expect(report.imported).toBe(0);
  });

  it('rejections go to the report with reasons', async () => {
    const fine = pos('b7');
    const same = pos('c7');
    const noColor: ReviewFile = { id: 'nocolor', meta: {}, moves: [] };
    const engine = withEngine(new FakeEngine(), fine).on(same, [{ move: 'a1a8', mate: 1 }, { move: 'g1f1', mate: 1 }, { move: 'g1h1', cp: 0 }]);
    const r = review('g', undefined, [[1, fine], [3, same]]);
    const { report, docs } = await run([r, noColor], engine);
    expect(docs.map((d) => d._id)).toEqual(['games:g-001']);
    expect(report.count('no_class_drop')).toBe(1);
    expect(report.count('bad_review')).toBe(1);
    expect(report.total).toBe(2);
    const md = report.toMarkdown();
    expect(md).toContain('g · 3');
    expect(md).toContain('nocolor');
    expect(docs[0].gameDate).toBe('1970-01-01T00:00:00');
  });

  it('report file name: default import-games.md, explicit name for a single game', () => {
    const dir = mkdtempSync(`${tmpdir()}/report-`);
    try {
      const report = new ImportReport('games');
      expect(basename(report.write(dir))).toBe('import-games.md');
      expect(basename(report.write(dir, undefined, 'import-games-game.md'))).toBe('import-games-game.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
