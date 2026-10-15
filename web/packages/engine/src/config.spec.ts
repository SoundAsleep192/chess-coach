import { describe, expect, it } from 'vitest';
import { poolOptionsFromEnv } from './config';

describe('poolOptionsFromEnv', () => {
  it('reads the engine settings with defaults and rejects garbage', () => {
    expect(poolOptionsFromEnv({})).toEqual({ command: 'stockfish', workers: 4, hashMb: 64, nodes: 1_000_000 });
    expect(
      poolOptionsFromEnv({ ENGINE_PATH: '/usr/local/bin/stockfish', ENGINE_WORKERS: '2', ENGINE_HASH_MB: '32', ENGINE_NODES: '500000' }),
    ).toEqual({ command: '/usr/local/bin/stockfish', workers: 2, hashMb: 32, nodes: 500_000 });
    expect(() => poolOptionsFromEnv({ ENGINE_WORKERS: 'four' })).toThrow('ENGINE_WORKERS must be a positive integer, got "four"');
    expect(() => poolOptionsFromEnv({ ENGINE_NODES: '0' })).toThrow(/ENGINE_NODES/);
  });
});
