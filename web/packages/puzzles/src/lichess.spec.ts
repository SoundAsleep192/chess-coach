import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireTool } from './config.ts';
import { importLichess, lichessToDoc, parseLichessLine } from './lichess.ts';
import { ImportReport } from './report.ts';
import { PuzzleStore } from './store.ts';
import { useMongo } from './testing/mongo.ts';

const mongo = useMongo();
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
const AFTER = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
const CSV = [
  'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags',
  `t0001,${FEN},g8f6 h5f7,1200,75,95,5000,mate mateIn1 opening short,https://lichess.org/abcdefgh#5,Italian_Game`,
  `t0002,${FEN},g8f6 h5f7,1300,75,85,5000,mate mateIn1,https://lichess.org/abcdefgh#5,`,
  `t0003,${FEN},g8f6 h5f7,2500,75,95,5000,mate mateIn1,https://lichess.org/abcdefgh#5,`,
  '',
].join('\r\n');

function csvFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'lichess-')), 'puzzles.csv');
  writeFileSync(path, CSV);
  return path;
}

const zstd = (() => {
  try {
    return requireTool('zstd');
  } catch {
    return null;
  }
})();

describe('Lichess CSV', () => {
  it('applies the opponent first move so the position has the solver to move', () => {
    const row = parseLichessLine(CSV.split('\r\n')[1])!;
    expect(row).toMatchObject({ id: 't0001', rating: 1200, popularity: 95, nbPlays: 5000 });
    expect(lichessToDoc(row)).toEqual({
      _id: 'lichess:t0001',
      source: 'lichess',
      fen: AFTER,
      solution: ['h5f7'],
      themes: ['mate', 'mateIn1', 'opening', 'short'],
      rating: 1200,
      solutionFrom: 'lichess',
    });
    expect(parseLichessLine(CSV.split('\r\n')[0])).toBeNull();
    expect(() => lichessToDoc({ ...row, moves: ['g8f6', 'h5h8'] })).toThrow(/h5h8/);
  });

  it('imports three CSV rows with CRLF and keeps only the ones that pass the quality filter', async () => {
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('lichess');
    try {
      await importLichess(csvFile(), store, report);
      expect(await store.puzzles.find().toArray()).toEqual([expect.objectContaining({ _id: 'lichess:t0001', fen: AFTER })]);
    } finally {
      await store.close();
    }
    expect(report).toMatchObject({ total: 3, imported: 1 });
    expect(report.count('filtered')).toBe(2);
    expect(report.toMarkdown()).toContain('| не прошла фильтр качества | 2 |');
  });

  it.skipIf(!zstd)('reads the same rows from a .zst file through zstd -dc', async () => {
    const csv = csvFile();
    execFileSync(zstd!, ['-q', csv, '-o', `${csv}.zst`]);
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('lichess');
    try {
      await importLichess(`${csv}.zst`, store, report);
    } finally {
      await store.close();
    }
    expect(report).toMatchObject({ total: 3, imported: 1 });
  });
});
