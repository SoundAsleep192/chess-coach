import { describe, expect, it } from 'vitest';
import { fenAfter } from '../chess-utils.ts';
import { FakeEngine } from '../testing/fake-engine.ts';
import { DEFAULT_SOLVE, NOT_WINNING, resolveSoft, resolveSolution } from './solution.ts';

const KR = '7k/8/5K2/8/8/8/8/R7 w - - 0 1'; // мат в 2: Kg6 Kg8 Ra8#
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const after = (fen: string, ...moves: string[]) => fenAfter(fen, moves);

describe('resolveSolution without a book answer', () => {
  it('builds a mate line where every solver move is the only one', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }, { move: 'a1a7', mate: 3 }])
      .on(after(KR, 'f6g6'), [{ move: 'h8g8', mate: -1 }])
      .on(after(KR, 'f6g6', 'h8g8'), [{ move: 'a1a8', mate: 1 }]);
    expect(await resolveSolution(engine, KR, null)).toEqual({
      ok: true,
      solution: ['f6g6', 'h8g8', 'a1a8'],
      from: 'engine',
      disputed: false,
      extended: false,
    });
  });

  it('stops at +3 and rejects a position whose first move is not the only one', async () => {
    const winning = new FakeEngine().on(START, [{ move: 'e2e4', cp: 350 }, { move: 'd2d4', cp: 20 }]);
    expect(await resolveSolution(winning, START, null)).toMatchObject({ ok: true, solution: ['e2e4'] });
    const quiet = new FakeEngine().on(START, [{ move: 'e2e4', cp: 30 }, { move: 'd2d4', cp: 25 }]);
    expect(await resolveSolution(quiet, START, null)).toMatchObject({ ok: false });
  });

  it('cuts the line before a solver move that is not the only one', async () => {
    const engine = new FakeEngine()
      .on(START, [{ move: 'e2e4', cp: 120 }, { move: 'd2d4', cp: -200 }])
      .on(after(START, 'e2e4'), [{ move: 'e7e5', cp: -120 }])
      .on(after(START, 'e2e4', 'e7e5'), [{ move: 'g1f3', cp: 100 }, { move: 'f1c4', cp: 95 }]);
    expect(await resolveSolution(engine, START, null)).toMatchObject({ ok: true, solution: ['e2e4'] });
  });
});

describe('resolveSolution with a book answer', () => {
  it('keeps the book line and marks a weak first move disputed', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }])
      .on(KR, [{ move: 'a1a7', cp: 50 }], ['a1a7'])
      .on(after(KR, 'a1a7'), [{ move: 'h8g8', cp: -50 }])
      .on(after(KR, 'a1a7', 'h8g8'), [{ move: 'f6g6', cp: 80 }, { move: 'a7b7', cp: 70 }]);
    const res = await resolveSolution(engine, KR, ['a1a7']);
    expect(res).toMatchObject({ ok: true, solution: ['a1a7'], from: 'book', disputed: true, extended: false });
    expect(res.ok && res.detail).toMatch(/a1a7.*f6g6/);
  });

  it('extends a book line that stops before the mate', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }])
      .on(KR, [{ move: 'f6g6', mate: 2 }], ['f6g6'])
      .on(after(KR, 'f6g6'), [{ move: 'h8g8', mate: -1 }])
      .on(after(KR, 'f6g6', 'h8g8'), [{ move: 'a1a8', mate: 1 }]);
    expect(await resolveSolution(engine, KR, ['f6g6', 'h8g8'])).toEqual({
      ok: true,
      solution: ['f6g6', 'h8g8', 'a1a8'],
      from: 'book',
      disputed: false,
      extended: true,
    });
  });

  it('does not touch a book line that already ends in mate', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }])
      .on(KR, [{ move: 'f6g6', mate: 2 }], ['f6g6']);
    expect(await resolveSolution(engine, KR, ['f6g6', 'h8g8', 'a1a8'])).toMatchObject({
      ok: true,
      solution: ['f6g6', 'h8g8', 'a1a8'],
      extended: false,
    });
    expect(engine.calls).toHaveLength(2);
  });
});

describe('resolveSolution rules that must not drift', () => {
  const MATE1 = '7k/8/6K1/8/8/8/8/R7 w - - 0 1';

  it('stops at the solver-move cap', async () => {
    const engine = new FakeEngine()
      .on(START, [{ move: 'e2e4', cp: 120 }, { move: 'd2d4', cp: -200 }])
      .on(after(START, 'e2e4'), [{ move: 'e7e5', cp: -120 }])
      .on(after(START, 'e2e4', 'e7e5'), [{ move: 'g1f3', cp: 100 }, { move: 'd2d4', cp: -200 }]);
    const res = await resolveSolution(engine, START, null, { ...DEFAULT_SOLVE, maxSolverMoves: 2 });
    expect(res).toMatchObject({ ok: true, solution: ['e2e4', 'e7e5', 'g1f3'] });
  });

  it('stops at +3 after a later solver move', async () => {
    const engine = new FakeEngine()
      .on(START, [{ move: 'e2e4', cp: 120 }, { move: 'd2d4', cp: -200 }])
      .on(after(START, 'e2e4'), [{ move: 'e7e5', cp: -120 }])
      .on(after(START, 'e2e4', 'e7e5'), [{ move: 'g1f3', cp: 350 }, { move: 'd2d4', cp: 0 }]);
    expect(await resolveSolution(engine, START, null)).toMatchObject({
      ok: true,
      solution: ['e2e4', 'e7e5', 'g1f3'],
    });
  });

  it('rejects a mate that is not the only one of the same or shorter length', async () => {
    const same = new FakeEngine().on(KR, [{ move: 'f6g6', mate: 2 }, { move: 'a1a7', mate: 2 }]);
    expect(await resolveSolution(same, KR, null)).toMatchObject({ ok: false });
    const shorter = new FakeEngine().on(KR, [{ move: 'f6g6', mate: 3 }, { move: 'a1a7', mate: 2 }]);
    expect(await resolveSolution(shorter, KR, null)).toMatchObject({ ok: false });
    const slower = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }, { move: 'a1a7', mate: 5 }])
      .on(after(KR, 'f6g6'), [{ move: 'h8g8', mate: -1 }])
      .on(after(KR, 'f6g6', 'h8g8'), [{ move: 'a1a8', mate: 1 }]);
    expect(await resolveSolution(slower, KR, null)).toMatchObject({ ok: true });
  });

  it('accepts mate in 1 even when another mate in 1 competes', async () => {
    const engine = new FakeEngine().on(MATE1, [{ move: 'a1a8', mate: 1 }, { move: 'a1a7', mate: 1 }]);
    expect(await resolveSolution(engine, MATE1, null)).toMatchObject({ ok: true, solution: ['a1a8'] });
  });

  const stuck = () =>
    new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }])
      .on(KR, [{ move: 'f6g6', mate: 2 }], ['f6g6'])
      .on(after(KR, 'f6g6'), [{ move: 'h8g8', cp: -50 }])
      .on(after(KR, 'f6g6', 'h8g8'), [{ move: 'a1a8', cp: 80 }, { move: 'a1a7', cp: 70 }]);

  it('trims an even book line and leaves extended false when the engine cannot extend', async () => {
    expect(await resolveSolution(stuck(), KR, ['f6g6', 'h8g8'])).toEqual({
      ok: true,
      solution: ['f6g6'],
      from: 'book',
      disputed: false,
      extended: false,
    });
  });

  it('keeps an odd book line whole and leaves extended false when the engine cannot extend', async () => {
    expect(await resolveSolution(stuck(), KR, ['f6g6'])).toMatchObject({
      solution: ['f6g6'],
      extended: false,
    });
  });

  it('does not extend a book line that already has the maximum solver moves', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }])
      .on(KR, [{ move: 'f6g6', mate: 2 }], ['f6g6']);
    const res = await resolveSolution(engine, KR, ['f6g6'], { ...DEFAULT_SOLVE, maxSolverMoves: 1 });
    expect(res).toMatchObject({ ok: true, solution: ['f6g6'], extended: false });
    expect(engine.calls).toHaveLength(2);
  });

  it('caps the extension of a book line at the solver-move limit', async () => {
    const engine = new FakeEngine()
      .on(START, [{ move: 'e2e4', cp: 120 }])
      .on(START, [{ move: 'e2e4', cp: 120 }], ['e2e4'])
      .on(after(START, 'e2e4'), [{ move: 'e7e5', cp: -120 }])
      .on(after(START, 'e2e4', 'e7e5'), [{ move: 'g1f3', cp: 100 }, { move: 'd2d4', cp: -200 }]);
    const res = await resolveSolution(engine, START, ['e2e4'], { ...DEFAULT_SOLVE, maxSolverMoves: 2 });
    expect(res).toMatchObject({ ok: true, solution: ['e2e4', 'e7e5', 'g1f3'], extended: true });
  });

  it('returns ok:false for an illegal or garbled book line instead of throwing', async () => {
    const engine = new FakeEngine();
    expect(await resolveSolution(engine, KR, ['a1a9'])).toMatchObject({ ok: false });
    expect(await resolveSolution(engine, KR, ['zz'])).toMatchObject({ ok: false });
    expect(await resolveSolution(engine, KR, ['f6g6', 'h8h1', 'a1a8'])).toMatchObject({ ok: false });
    expect(engine.calls).toHaveLength(0);
  });
});

describe('resolveSoft', () => {
  // 1.Re8 Kxe8 2.Nc7+ Kd7 3.Nxa8: жертва ладьи, вилка, ферзь выигран; после 1.Re8 движок уже видит +7
  const SAC = 'q7/5k2/8/3N4/8/8/7P/4R1K1 w - - 0 1';
  const sacrifice = () =>
    new FakeEngine()
      .on(SAC, [{ move: 'e1e8', cp: 700 }])
      .on(after(SAC, 'e1e8'), [{ move: 'f7e8', cp: -700 }])
      .on(after(SAC, 'e1e8', 'f7e8'), [{ move: 'd5c7', cp: 700 }])
      .on(after(SAC, 'e1e8', 'f7e8', 'd5c7'), [{ move: 'e8d7', cp: -700 }])
      .on(after(SAC, 'e1e8', 'f7e8', 'd5c7', 'e8d7'), [{ move: 'c7a8', cp: 700 }])
      .on(after(SAC, 'e1e8', 'f7e8', 'd5c7', 'e8d7', 'c7a8'), [{ move: 'd7c8', cp: -700 }]);

  it('plays a sacrifice through to the won material and drops the last reply', async () => {
    expect(await resolveSoft(sacrifice(), SAC)).toEqual({
      ok: true,
      solution: ['e1e8', 'f7e8', 'd5c7', 'e8d7', 'c7a8'],
      from: 'engine',
      disputed: false,
      extended: false,
    });
  });

  it('rejects a position whose best first move only gives an advantage', async () => {
    const engine = new FakeEngine().on(START, [{ move: 'e2e4', cp: 150 }]);
    expect(await resolveSoft(engine, START)).toEqual({ ok: false, detail: NOT_WINNING });
    expect(engine.calls).toHaveLength(1);
  });

  it('accepts a first move that is not the only one and follows a mate to the end', async () => {
    const engine = new FakeEngine()
      .on(KR, [{ move: 'f6g6', mate: 2 }, { move: 'a1a7', mate: 2 }])
      .on(after(KR, 'f6g6'), [{ move: 'h8g8', mate: -1 }])
      .on(after(KR, 'f6g6', 'h8g8'), [{ move: 'a1a8', mate: 1 }]);
    expect(await resolveSoft(engine, KR)).toMatchObject({ ok: true, solution: ['f6g6', 'h8g8', 'a1a8'] });
  });

  it('stops at the solver-move cap with an odd line', async () => {
    expect(await resolveSoft(sacrifice(), SAC, { ...DEFAULT_SOLVE, maxSolverMoves: 2 })).toMatchObject({
      ok: true,
      solution: ['e1e8', 'f7e8', 'd5c7'],
    });
  });

  it('measures won material against the start, so an already winning position does not stop after the first move', async () => {
    // белые уже на шесть пешек впереди; линия идёт, пока баланс не вырастет ещё на две
    const AHEAD = 'q3k3/8/8/3N4/8/8/6PP/1R3RK1 w - - 0 1';
    const engine = new FakeEngine()
      .on(AHEAD, [{ move: 'd5c7', cp: 900 }])
      .on(after(AHEAD, 'd5c7'), [{ move: 'e8d7', cp: -900 }])
      .on(after(AHEAD, 'd5c7', 'e8d7'), [{ move: 'c7a8', cp: 1500 }])
      .on(after(AHEAD, 'd5c7', 'e8d7', 'c7a8'), [{ move: 'd7c8', cp: -1500 }]);
    expect(await resolveSoft(engine, AHEAD)).toMatchObject({ ok: true, solution: ['d5c7', 'e8d7', 'c7a8'] });
  });
});
