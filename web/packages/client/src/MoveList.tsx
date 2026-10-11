import type { ReactNode } from 'react';
import type { BoardNode, BoardState, NodeId } from '@board/shared';
import { canStudentDelete, moveNumber } from './nav';

interface Props {
  state: BoardState;
  disabled: boolean;
  onSelect(nodeId: NodeId): void;
  onDelete(nodeId: NodeId): void;
}

export function MoveList({ state, disabled, onSelect, onDelete }: Props) {
  const root = state.nodes[state.rootId];
  if (root.children.length === 0) return <div className="moves empty">Ходов нет</div>;

  const renderLine = (firstId: NodeId, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let id: NodeId | undefined = firstId;
    let force = true;
    while (id) {
      const node: BoardNode = state.nodes[id];
      const parent = state.nodes[node.parent!];
      const current = node.id === state.cursor;
      out.push(
        <span key={node.id} className="move-wrap">
          <button
            type="button"
            className={`move author-${node.author}${current ? ' current' : ''}`}
            data-node-id={node.id}
            aria-current={current ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onSelect(node.id)}
          >
            {moveNumber(parent.fen, force)}
            {node.san}
          </button>
          {canStudentDelete(state, node.id) && (
            <button
              type="button"
              className="delete"
              aria-label={`удалить ветку ${node.san}`}
              disabled={disabled}
              onClick={() => onDelete(node.id)}
            >
              ×
            </button>
          )}
        </span>,
      );
      force = false;
      if (parent.children[0] === node.id && parent.children.length > 1) {
        out.push(
          <div key={`${node.id}-vars`} className="variations" style={{ marginLeft: `${(depth + 1) * 12}px` }}>
            {parent.children.slice(1).map((alt) => (
              <div key={alt} className="variation" data-variation={alt}>
                {renderLine(alt, depth + 1)}
              </div>
            ))}
          </div>,
        );
        force = true;
      }
      id = node.children[0];
    }
    return out;
  };

  return <div className="moves">{renderLine(root.children[0], 0)}</div>;
}
