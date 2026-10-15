import { DEFAULT_ENGINE_URL, EngineClient } from '@board/shared';

/** Клиент сервиса движка для импорта: приоритет batch, длинный таймаут. Без сервиса - понятная ошибка до начала работы. */
export async function connectEngine(url: string = process.env.ENGINE_URL ?? DEFAULT_ENGINE_URL): Promise<EngineClient> {
  const engine = new EngineClient(url, { priority: 'batch', timeoutMs: 120_000 });
  const fail = (reason: string) => new Error(`engine service is not running at ${url}: docker compose up -d engine (${reason})`);
  let health;
  try {
    health = await engine.health();
  } catch (e) {
    throw fail((e as Error).message);
  }
  if (!health.ok) throw fail('no live engine process');
  return engine;
}
