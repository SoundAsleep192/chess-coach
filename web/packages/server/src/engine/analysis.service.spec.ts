import { describe, expect, it } from 'vitest';
import type { AnalyseOptions, EngineLine } from '@board/shared';
import { AnalysisService, CACHE_SIZE, type EngineLike } from './analysis.service';

/** Считает вызовы; ответ - один ход с fen в поле move, чтобы различать позиции. */
class CountingEngine implements EngineLike {
  readonly calls: { fen: string; opts?: AnalyseOptions }[] = [];
  failNext = false;

  async analyse(fen: string, opts?: AnalyseOptions): Promise<EngineLine[]> {
    this.calls.push({ fen, opts });
    await Promise.resolve();
    if (this.failNext) {
      this.failNext = false;
      throw new Error('engine down');
    }
    return [{ move: fen, cp: 0, pv: [fen] }];
  }
}

describe('AnalysisService', () => {
  it('asks with interactive priority and caches by fen, multipv and searchmoves', async () => {
    const engine = new CountingEngine();
    const analysis = new AnalysisService(engine);
    expect(analysis.cached('a', { multipv: 3 })).toBeUndefined();
    await analysis.analyse('a', { multipv: 3 });
    await analysis.analyse('a', { multipv: 3 });
    await analysis.analyse('a', { searchmoves: ['e2e4'] });
    await analysis.analyse('a');
    expect(engine.calls).toEqual([
      { fen: 'a', opts: { multipv: 3, priority: 'interactive' } },
      { fen: 'a', opts: { searchmoves: ['e2e4'], priority: 'interactive' } },
      { fen: 'a', opts: { priority: 'interactive' } },
    ]);
    expect(analysis.cached('a', { multipv: 3 })).toEqual([{ move: 'a', cp: 0, pv: ['a'] }]);
  });

  it('joins identical requests in flight and does not cache a failure', async () => {
    const engine = new CountingEngine();
    const analysis = new AnalysisService(engine);
    const [x, y] = await Promise.all([analysis.analyse('b'), analysis.analyse('b')]);
    expect(x).toBe(y);
    expect(engine.calls).toHaveLength(1);
    engine.failNext = true;
    await expect(analysis.analyse('c')).rejects.toThrow('engine down');
    expect(await analysis.analyse('c')).toHaveLength(1);
    expect(engine.calls).toHaveLength(3);
  });

  it(`keeps the last ${CACHE_SIZE} answers and refreshes an entry on use`, async () => {
    const engine = new CountingEngine();
    const analysis = new AnalysisService(engine);
    for (let i = 0; i < CACHE_SIZE; i++) await analysis.analyse(`p${i}`);
    await analysis.analyse('p0');
    await analysis.analyse('extra');
    expect(engine.calls).toHaveLength(CACHE_SIZE + 1);
    expect(analysis.cached('p0')).toBeDefined();
    expect(analysis.cached('p1')).toBeUndefined();
  });
});
