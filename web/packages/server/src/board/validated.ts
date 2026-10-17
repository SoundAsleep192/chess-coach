import { BoardError } from './board-error';

/** Проверить тело запроса до сервиса: неверное тело - 400 bad_request с текстом валидатора. */
export function validated<T>(body: unknown, check: (b: unknown) => string | null): T {
  const problem = check(body);
  if (problem) throw new BoardError('bad_request', problem);
  return body as T;
}
