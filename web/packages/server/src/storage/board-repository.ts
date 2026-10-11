import type { BoardState } from '@board/shared';

/** Хранилище одного документа доски. Реализация для Mongo - MongoBoardRepository. */
export abstract class BoardRepository {
  abstract load(): Promise<BoardState | null>;
  abstract save(state: BoardState): Promise<void>;
  abstract ping(): Promise<void>;
}
