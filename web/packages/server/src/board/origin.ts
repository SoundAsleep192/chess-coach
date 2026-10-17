/** Какие страницы могут подключаться к /ws. Без Origin подключаются не браузеры (тесты, скрипты), сервер слушает только 127.0.0.1. */
export const DEFAULT_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765', 'http://127.0.0.1:5173', 'http://localhost:5173'];

export function allowedOrigins(env: string | undefined = process.env.BOARD_ORIGINS): string[] {
  if (!env) return DEFAULT_ORIGINS;
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}
