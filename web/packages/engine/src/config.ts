import type { PoolOptions } from './pool';

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

/** Настройки пула из окружения: ENGINE_PATH, ENGINE_WORKERS, ENGINE_HASH_MB, ENGINE_NODES. */
export function poolOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PoolOptions {
  return {
    command: env.ENGINE_PATH || 'stockfish',
    workers: positiveInt(env, 'ENGINE_WORKERS', 4),
    hashMb: positiveInt(env, 'ENGINE_HASH_MB', 64),
    nodes: positiveInt(env, 'ENGINE_NODES', 1_000_000),
  };
}
