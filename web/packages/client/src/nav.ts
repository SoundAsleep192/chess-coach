import type { BoardNode, BoardState, NodeId } from '@board/shared';

export type NavKey = 'start' | 'prev' | 'next' | 'end' | 'up' | 'down';

/** Текущая линия: от корня до узла и дальше по первым детям до конца. */
export function currentLine(state: BoardState, nodeId: NodeId = state.cursor): NodeId[] {
  const back: NodeId[] = [];
  let cur: BoardNode | undefined = state.nodes[nodeId];
  while (cur) {
    back.unshift(cur.id);
    cur = cur.parent === null ? undefined : state.nodes[cur.parent];
  }
  let tail = state.nodes[nodeId];
  while (tail && tail.children.length) {
    tail = state.nodes[tail.children[0]];
    back.push(tail.id);
  }
  return back;
}

/** Куда переходит курсор по клавише или кнопке. null - переходить некуда. */
export function navTarget(state: BoardState, key: NavKey): NodeId | null {
  const node = state.nodes[state.cursor];
  if (!node) return null;
  let target: NodeId | null = null;
  switch (key) {
    case 'start':
      target = state.rootId;
      break;
    case 'prev':
      target = node.parent;
      break;
    case 'next':
      target = node.children[0] ?? null;
      break;
    case 'end':
      target = currentLine(state).at(-1) ?? null;
      break;
    case 'up':
    case 'down': {
      if (node.parent === null) return null;
      const siblings = state.nodes[node.parent].children;
      const i = siblings.indexOf(node.id) + (key === 'down' ? 1 : -1);
      target = siblings[Math.max(0, Math.min(siblings.length - 1, i))];
      break;
    }
  }
  return target === state.cursor ? null : target;
}

export function moveNumber(parentFen: string, force: boolean): string {
  const [, turn, , , , full] = parentFen.split(' ');
  if (turn === 'w') return `${full}.`;
  return force ? `${full}...` : '';
}

/** Кнопку удаления показываем у начала ветки ученика, если вся ветка его. */
export function canStudentDelete(state: BoardState, nodeId: NodeId): boolean {
  const node = state.nodes[nodeId];
  if (!node || node.author !== 'student' || node.parent === null) return false;
  if (state.nodes[node.parent].author === 'student') return false;
  const stack = [nodeId];
  while (stack.length) {
    const cur = state.nodes[stack.pop()!];
    if (cur.author !== 'student') return false;
    stack.push(...cur.children);
  }
  return true;
}
