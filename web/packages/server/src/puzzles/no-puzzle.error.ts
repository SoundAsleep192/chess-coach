import type { ThemeCount } from '@board/shared';
import { BoardError } from '../board/board-error';

/** 404 на next: подходящих задач нет; available - темы, по которым задачи есть. */
export class NoPuzzleError extends BoardError {
  constructor(
    message: string,
    readonly available: ThemeCount[],
  ) {
    super('not_found', message);
    this.name = 'NoPuzzleError';
  }
}
