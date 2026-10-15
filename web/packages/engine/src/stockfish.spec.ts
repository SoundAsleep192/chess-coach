import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnginePool } from './pool';

/** Настоящий Stockfish из PATH; без него тесты пропускаются. */
const stockfish = (process.env.PATH ?? '')
  .split(delimiter)
  .filter(Boolean)
  .map((dir) => join(dir, 'stockfish'))
  .find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

describe.skipIf(!stockfish)('EnginePool with the real Stockfish', () => {
  it('finds mate in 1 and gives identical answers to identical requests on different workers', async () => {
    const pool = await EnginePool.start({ command: stockfish!, workers: 2, hashMb: 16, nodes: 300_000 });
    try {
      expect(pool.version).toMatch(/^Stockfish /);
      const mate = await pool.analyse({ fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1', multipv: 2 });
      expect(mate).toHaveLength(2);
      expect(mate[0]).toMatchObject({ move: 'a1a8', mate: 1 });
      const italian = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
      const [a, b] = await Promise.all([pool.analyse({ fen: italian, multipv: 3 }), pool.analyse({ fen: italian, multipv: 3 })]);
      expect(a).toHaveLength(3);
      expect(b).toEqual(a);
    } finally {
      await pool.close();
    }
  });
});
