import { describe, expect, it } from 'vitest';
import { commandLog, FAKE_UCI } from '../test/fake-engine';
import { parseInfo, UciEngine } from './uci';

describe('parseInfo', () => {
  it('reads multipv, depth, score and pv and skips bounds, strings and lines without pv', () => {
    expect(
      parseInfo('info depth 20 seldepth 30 multipv 2 score cp -35 nodes 1000 nps 1 tbhits 0 time 5 pv e7e5 g1f3 b8c6'),
    ).toEqual({ multipv: 2, depth: 20, move: 'e7e5', cp: -35, pv: ['e7e5', 'g1f3', 'b8c6'] });
    expect(parseInfo('info depth 12 multipv 1 score mate -3 pv h8g8 a1a8')).toMatchObject({ mate: -3, move: 'h8g8', depth: 12 });
    expect(parseInfo('info depth 20 score cp 40 lowerbound nodes 5 pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
    expect(parseInfo('info depth 0 score mate 0')).toBeNull();
  });
});

describe('UciEngine', () => {
  it('reads the engine name, sets one thread and starts every analysis with ucinewgame', async () => {
    const log = commandLog();
    const engine = await UciEngine.start(process.execPath, { args: [FAKE_UCI, '--log', log.path], hashMb: 16 });
    try {
      expect(engine.version).toBe('FakeFish 1');
      const lines = await engine.analyse('8/8/8/8/8/8/8/K6k w - - 0 1', { multipv: 2, nodes: 5000 });
      expect(lines).toEqual([
        { move: 'e2e4', cp: 99, depth: 7, pv: ['e2e4', 'e7e5'] },
        { move: 'd2d4', cp: 98, depth: 7, pv: ['d2d4', 'e7e5'] },
      ]);
      await engine.analyse('8/8/8/8/8/8/8/K6k w - - 0 1', { searchmoves: ['a1a2'], nodes: 7000 });
    } finally {
      await engine.close();
    }
    expect(log.lines()).toEqual([
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 16',
      'isready',
      'setoption name MultiPV value 2',
      'ucinewgame',
      'isready',
      'position fen 8/8/8/8/8/8/8/K6k w - - 0 1',
      'go nodes 5000',
      'setoption name MultiPV value 1',
      'ucinewgame',
      'isready',
      'position fen 8/8/8/8/8/8/8/K6k w - - 0 1',
      'go nodes 7000 searchmoves a1a2',
      'quit',
    ]);
  });

  it('rejects instead of crashing when the binary does not exist', async () => {
    await expect(UciEngine.start('/nonexistent/sf', { hashMb: 16 })).rejects.toThrow(/failed to start|ENOENT/);
  });

  it('times out on a search that never ends and kills the process', async () => {
    const engine = await UciEngine.start(process.execPath, { args: [FAKE_UCI], hashMb: 16, timeoutMs: 300 });
    await expect(engine.analyse('hang', { nodes: 1000 })).rejects.toThrow(/timed out/);
    await expect(engine.analyse('8/8/8/8/8/8/8/K6k w - - 0 1', { nodes: 1000 })).rejects.toThrow(/timed out/);
    await engine.close();
  });
});
