import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { commandLog, fakePool } from '../test/fake-engine';
import { EnginePool, QueueFull } from './pool';

const FEN = '8/8/8/8/8/8/8/K6k w - - 0 1';

describe('EnginePool', () => {
  it('serves interactive requests before batch ones, in order inside a priority', async () => {
    const pool = await EnginePool.start(fakePool({ flags: ['--delay', '60'] }));
    try {
      const done: string[] = [];
      const ask = (name: string, priority: 'interactive' | 'batch') =>
        pool.analyse({ fen: FEN, searchmoves: [name], priority }).then((lines) => done.push(lines[0].move));
      await Promise.all([
        ask('a1a2', 'batch'),
        ask('b1b2', 'batch'),
        ask('c1c2', 'interactive'),
        ask('d1d2', 'batch'),
        ask('e1e2', 'interactive'),
      ]);
      expect(done).toEqual(['a1a2', 'c1c2', 'e1e2', 'b1b2', 'd1d2']);
    } finally {
      await pool.close();
    }
  });

  it('answers QueueFull when the queue is at its limit and no worker is free', async () => {
    const pool = await EnginePool.start(fakePool({ flags: ['--delay', '100'], maxQueue: 2 }));
    try {
      const running = [pool.analyse({ fen: FEN }), pool.analyse({ fen: FEN }), pool.analyse({ fen: FEN })];
      expect(pool.stats()).toEqual({ workers: 1, busy: 1, queued: 2 });
      await expect(pool.analyse({ fen: FEN })).rejects.toThrow(QueueFull);
      await Promise.all(running);
      expect(pool.stats()).toEqual({ workers: 1, busy: 0, queued: 0 });
    } finally {
      await pool.close();
    }
  });

  it('fails the request of a crashed worker, restarts it and keeps serving', async () => {
    const pool = await EnginePool.start(fakePool());
    try {
      const crashed = pool.analyse({ fen: 'crash' });
      const next = pool.analyse({ fen: FEN });
      await expect(crashed).rejects.toThrow(/exited/);
      expect((await next)[0].move).toBe('e2e4');
      expect(pool.alive()).toBe(true);
    } finally {
      await pool.close();
    }
  });

  it('kills a worker that hangs, fails its request and restarts it', async () => {
    const pool = await EnginePool.start(fakePool({ timeoutMs: 300, startTimeoutMs: 30_000 }));
    try {
      await expect(pool.analyse({ fen: 'hang' })).rejects.toThrow(/timed out/);
      expect((await pool.analyse({ fen: FEN }))[0].move).toBe('e2e4');
    } finally {
      await pool.close();
    }
  });

  it('uses the pool node limit unless the request sets its own and spreads work over the workers', async () => {
    const log = commandLog();
    const pool = await EnginePool.start(fakePool({ workers: 2, nodes: 1234, flags: ['--log', log.path, '--delay', '50'] }));
    try {
      expect(pool.version).toBe('FakeFish 1');
      await Promise.all([pool.analyse({ fen: FEN }), pool.analyse({ fen: FEN, nodes: 4321 })]);
    } finally {
      await pool.close();
    }
    const go = log.lines().filter((l) => l.startsWith('go '));
    expect(go.sort()).toEqual(['go nodes 1234', 'go nodes 4321']);
  });

  it('rejects queued requests when closed', async () => {
    const pool = await EnginePool.start(fakePool({ flags: ['--delay', '100'] }));
    const first = pool.analyse({ fen: FEN });
    const queued = pool.analyse({ fen: FEN });
    const closing = pool.close();
    await expect(queued).rejects.toThrow(/closed/);
    await expect(first).rejects.toThrow(/engine exited/);
    await closing;
    await expect(pool.analyse({ fen: FEN })).rejects.toThrow(/closed/);
  });

  it('notices an idle worker that died and restarts it before the next request', async () => {
    const log = commandLog();
    const pids = () => [...new Set(readFileSync(log.path, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]))];
    const pool = await EnginePool.start(fakePool({ flags: ['--log', log.path] }));
    try {
      const [first] = pids();
      process.kill(Number(first), 'SIGKILL');
      const deadline = Date.now() + 10_000;
      while (pids().length < 2) {
        if (Date.now() > deadline) throw new Error('the dead worker was never restarted');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect((await pool.analyse({ fen: FEN }))[0].move).toBe('e2e4');
      expect(pool.alive()).toBe(true);
      const go = readFileSync(log.path, 'utf8').trim().split('\n').filter((l) => l.includes(' go '));
      expect(go).toHaveLength(1);
      expect(go[0].split(' ')[0]).not.toBe(first);
    } finally {
      await pool.close();
    }
  });

  it('rejects at once when no worker is alive and restarts keep failing', async () => {
    const log = commandLog();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = await EnginePool.start(fakePool({ flags: ['--once', `${log.path}.started`], restartDelayMs: 60_000 }));
    try {
      await expect(pool.analyse({ fen: 'crash' })).rejects.toThrow(/exited/);
      const deadline = Date.now() + 10_000;
      while (errors.mock.calls.length === 0) {
        if (Date.now() > deadline) throw new Error('the failed restart was never reported');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(errors.mock.calls[0][0]).toMatch(/cannot restart a worker/);
      expect(pool.alive()).toBe(false);
      await expect(pool.analyse({ fen: FEN })).rejects.toThrow(/engine is not running/);
    } finally {
      errors.mockRestore();
      await pool.close();
    }
  });
});
