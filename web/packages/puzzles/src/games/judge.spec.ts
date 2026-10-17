import { describe, expect, it } from 'vitest';
import type { AnalyseOptions, EngineLine } from '@board/shared';
import { FakeEngine } from '../testing/fake-engine.ts';
import { DEFAULT_SOLVE, type Engine } from '../engine/solution.ts';
import { judgeCandidate } from './judge.ts';
import type { Candidate } from './review.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ONE = { ...DEFAULT_SOLVE, maxSolverMoves: 1 };
const cand = (fen: string, played: string): Candidate => ({ gameId: 'g1', ply: 1, fen, played, gameDate: '2025-11-09T00:00:00', ref: 'Партия, 1.' });

describe('judgeCandidate', () => {
  it('same class as best -> no_class_drop', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 600 }, { move: 'd2d4', cp: 450 }, { move: 'a2a3', cp: 450 }]);
    const r = await judgeCandidate(e, cand(START, 'd2d4'), ONE);
    expect(r).toMatchObject({ ok: false, reason: 'no_class_drop' });
  });

  it('missed strike: best wins, played equal -> soft line, themes ownGame+missedWin', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 600 }, { move: 'd2d4', cp: 590 }, { move: 'a2a3', cp: 0 }]);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r).toEqual({ ok: true, fen: START, solution: ['g1f3'], themes: ['ownGame', 'missedWin'] });
  });

  it('defence: equal -> lost by played, second best also lost -> one move, themes ownGame+onlyMove+defensiveMove', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 0 }, { move: 'd2d4', cp: -600 }, { move: 'a2a3', cp: -700 }]);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r).toEqual({ ok: true, fen: START, solution: ['g1f3'], themes: ['ownGame', 'onlyMove', 'defensiveMove'] });
  });

  it('worse -> mated by played is a puzzle (new lost class)', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: -150 }, { move: 'd2d4', cp: -600 }], undefined).on(START, [{ move: 'a2a3', mate: -2 }], ['a2a3']);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r).toMatchObject({ ok: true, themes: ['ownGame', 'onlyMove', 'defensiveMove'] });
  });

  it('close second and no win -> not_puzzle', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 150 }, { move: 'd2d4', cp: 120 }, { move: 'a2a3', cp: -10 }]);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r).toMatchObject({ ok: false, reason: 'not_puzzle' });
  });

  it('mate strike gets theme mate', async () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const e = new FakeEngine().on(fen, [{ move: 'a1a8', mate: 1 }, { move: 'g1f1', cp: 0 }, { move: 'g1h1', cp: 0 }]);
    const r = await judgeCandidate(e, cand(fen, 'g1f1'));
    expect(r).toEqual({ ok: true, fen, solution: ['a1a8'], themes: ['ownGame', 'missedWin', 'onlyMove', 'mate'] });
  });

  it('played move outside top 3 is asked with searchmoves', async () => {
    const e = new FakeEngine()
      .on(START, [{ move: 'g1f3', cp: 600 }, { move: 'd2d4', cp: 590 }, { move: 'b1c3', cp: 580 }])
      .on(START, [{ move: 'a2a3', cp: 0 }], ['a2a3']);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r.ok).toBe(true);
    expect(e.calls.filter((c) => c.opts.searchmoves)).toEqual([{ fen: START, opts: { searchmoves: ['a2a3'] } }]);
    expect(e.calls[0]).toEqual({ fen: START, opts: { multipv: 3 } });
  });

  it('played move inside top 3 needs no searchmoves request', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 600 }, { move: 'd2d4', cp: 0 }, { move: 'a2a3', cp: 0 }]);
    await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(e.calls.some((c) => c.opts.searchmoves)).toBe(false);
  });

  it('castling and promotion played moves are legal', async () => {
    const castle = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const promo = '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1';
    const e = new FakeEngine()
      .on(castle, [{ move: 'h1h8', mate: 1 }, { move: 'h1h2', cp: 0 }], undefined)
      .on(castle, [{ move: 'e1g1', cp: 0 }], ['e1g1'])
      .on(promo, [{ move: 'e7e8q', cp: 900 }, { move: 'g7g6', cp: 0 }], undefined)
      .on(promo, [{ move: 'e7e8q', cp: -900 }], ['e7e8q']);
    expect((await judgeCandidate(e, cand(castle, 'e1g1'), ONE)).ok).toBe(true);
    const r = await judgeCandidate(e, cand(promo, 'e7e8q'), ONE);
    expect(r).toMatchObject({ ok: false, reason: 'no_class_drop' });
    expect(e.calls.some((c) => c.fen === promo)).toBe(true);
  });

  it('illegal played move -> illegal_position', async () => {
    const r = await judgeCandidate(new FakeEngine(), cand(START, 'e2e5'));
    expect(r).toMatchObject({ ok: false, reason: 'illegal_position' });
  });

  it('played move that ends in a draw scores cp 0 without asking the engine', async () => {
    const fen = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1';
    // движок считает e1e2 почти лучшим ходом (590): без ветки ничьей класс не упал бы и результат был бы no_class_drop
    const e = new FakeEngine().on(fen, [{ move: 'e1d1', cp: 600 }, { move: 'e1e2', cp: 590 }, { move: 'e1f1', cp: 0 }]);
    const r = await judgeCandidate(e, cand(fen, 'e1e2'), ONE);
    expect(r).toMatchObject({ ok: true, themes: ['ownGame', 'missedWin'] });
    expect(e.calls.some((c) => c.opts.searchmoves)).toBe(false);
  });

  it('played move that mates -> no_class_drop', async () => {
    const fen = '6k1/5ppp/8/8/8/8/1R6/R5K1 w - - 0 1';
    // движок считает b2b8 проигрышем (-900): без ветки мата результат был бы ok:true
    const e = new FakeEngine().on(fen, [{ move: 'a1a8', mate: 1 }, { move: 'b2b8', cp: -900 }]);
    expect(await judgeCandidate(e, cand(fen, 'b2b8'), ONE)).toMatchObject({ ok: false, reason: 'no_class_drop' });
    expect(e.calls.some((c) => c.opts.searchmoves)).toBe(false);
  });

  it('two mates in 1 -> no onlyMove theme', async () => {
    const fen = '6k1/5ppp/8/8/8/8/1R6/R5K1 w - - 0 1';
    const e = new FakeEngine().on(fen, [{ move: 'a1a8', mate: 1 }, { move: 'b2b8', mate: 1 }, { move: 'g1f1', cp: 0 }]);
    const r = await judgeCandidate(e, cand(fen, 'g1f1'), ONE);
    expect(r).toEqual({ ok: true, fen, solution: ['a1a8'], themes: ['ownGame', 'missedWin', 'mate'] });
  });

  it('engine error -> engine_error, not thrown', async () => {
    const e = new FakeEngine().on(START, [{ move: 'g1f3', cp: 600 }, { move: 'd2d4', cp: 590 }, { move: 'b1c3', cp: 580 }]);
    const r = await judgeCandidate(e, cand(START, 'a2a3'), ONE);
    expect(r).toMatchObject({ ok: false, reason: 'engine_error' });
    expect((r as { detail: string }).detail).toContain('FakeEngine');
  });

  it('strike falls back to [best.move] when the soft line starts with another move or is not winning', async () => {
    const top = (o: AnalyseOptions): EngineLine[] => {
      const all: EngineLine[] = [
        { move: 'g1f3', cp: 600, pv: ['g1f3'] },
        { move: 'd2d4', cp: 590, pv: ['d2d4'] },
        { move: 'a2a3', cp: 0, pv: ['a2a3'] },
      ];
      return all.slice(0, o.multipv ?? 1);
    };
    const diverging: Engine = { analyse: async (_f, o = {}) => (o.multipv === 1 ? [{ move: 'd2d4', cp: 700, pv: ['d2d4'] }] : top(o)) };
    const notWinning: Engine = { analyse: async (_f, o = {}) => (o.multipv === 1 ? [{ move: 'g1f3', cp: 0, pv: ['g1f3'] }] : top(o)) };
    for (const engine of [diverging, notWinning]) {
      const r = await judgeCandidate(engine, cand(START, 'a2a3'), ONE);
      expect(r).toMatchObject({ ok: true, solution: ['g1f3'] });
    }
  });

  it('defence falls back to [best.move] when extendLine disagrees with the verdict', async () => {
    const engine: Engine = {
      analyse: async (_f, o = {}) =>
        o.multipv === 2
          ? [{ move: 'd2d4', cp: 0, pv: ['d2d4'] }, { move: 'g1f3', cp: -600, pv: ['g1f3'] }]
          : [{ move: 'g1f3', cp: 0, pv: ['g1f3'] }, { move: 'd2d4', cp: -600, pv: ['d2d4'] }, { move: 'a2a3', cp: -700, pv: ['a2a3'] }].slice(0, o.multipv ?? 1),
    };
    const r = await judgeCandidate(engine, cand(START, 'a2a3'), ONE);
    expect(r).toMatchObject({ ok: true, solution: ['g1f3'] });
  });
});
