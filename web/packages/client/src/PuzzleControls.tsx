import { alternativesLeft, type ClientMessage, type PuzzleSession } from '@board/shared';

interface Props {
  puzzle: PuzzleSession;
  disabled: boolean;
  send(msg: ClientMessage): void;
}

/** Кнопки задачи: «Ещё раз» после ошибки или хода «слабее», «Показать решение» во время решения, «Найти другое» после. */
export function PuzzleControls({ puzzle, disabled, send }: Props) {
  const retry = puzzle.status === 'solving' && puzzle.phase === 'feedback';
  const giveUp = puzzle.status === 'solving';
  const another = puzzle.status === 'solved' && !puzzle.bonus && alternativesLeft(puzzle);
  if (!retry && !giveUp && !another) return null;
  return (
    <div className="puzzle-controls">
      {retry && (
        <button type="button" disabled={disabled} onClick={() => send({ event: 'puzzleRetry', data: {} })}>
          Ещё раз
        </button>
      )}
      {giveUp && (
        <button type="button" disabled={disabled} onClick={() => send({ event: 'puzzleGiveUp', data: {} })}>
          Показать решение
        </button>
      )}
      {another && (
        <button type="button" disabled={disabled} onClick={() => send({ event: 'puzzleAnother', data: {} })}>
          Найти другое
        </button>
      )}
    </div>
  );
}
