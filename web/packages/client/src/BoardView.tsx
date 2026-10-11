import type { CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import type { ArrowColor, BoardNode, Orientation } from '@board/shared';

export const ARROW_COLORS: Record<ArrowColor, string> = {
  green: 'rgba(63, 163, 77, 0.8)',
  red: 'rgba(214, 69, 69, 0.8)',
  blue: 'rgba(59, 125, 216, 0.8)',
};
const LAST_MOVE = { backgroundColor: 'rgba(255, 210, 60, 0.45)' };

interface Props {
  node: BoardNode;
  orientation: Orientation;
  canMove: boolean;
  onDrop(from: string, to: string): void;
}

export function BoardView({ node, orientation, canMove, onDrop }: Props) {
  const squareStyles: Record<string, CSSProperties> = node.uci
    ? { [node.uci.slice(0, 2)]: LAST_MOVE, [node.uci.slice(2, 4)]: LAST_MOVE }
    : {};
  return (
    <Chessboard
      options={{
        id: 'coach-board',
        position: node.fen,
        boardOrientation: orientation,
        allowDragging: canMove,
        arrows: node.arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: ARROW_COLORS[a.color] })),
        squareStyles,
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          if (targetSquare && targetSquare !== sourceSquare) onDrop(sourceSquare, targetSquare);
          // Фигуру всегда возвращаем: позицию после хода пришлёт сервер, отклонённый ход просто не изменит её.
          return false;
        },
      }}
    />
  );
}
