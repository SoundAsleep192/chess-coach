import type { Author, BoardNode, BoardState, InboxKind, NodeId } from '@board/shared';

export type PuzzleOutcome = 'wrong' | 'weaker' | 'solved' | 'gaveUp';

/** Документ коллекции inbox. */
export interface StoredEvent {
  _id: number;
  at: Date;
  kind: InboxKind;
  treeEpoch: number;
  read: boolean;
  text: string;
  // line
  fromNode?: NodeId;
  fromLabel?: string;
  nodes?: NodeId[];
  moves?: string[];
  // delete
  node?: NodeId;
  san?: string;
  plies?: number;
  // puzzle
  puzzleId?: string;
  label?: string;
  result?: PuzzleOutcome;
  banner?: string;
  errors?: number;
  bonus?: boolean;
  answer?: string;
}

/** Событие до записи: текст собирает eventText. */
export type Draft = Omit<StoredEvent, '_id' | 'at' | 'read' | 'text'>;

const AUTHOR: Record<Author, string> = { game: 'партия', coach: 'вариант тренера', student: 'ветка ученика' };

/** Ход с номером: "24.Nh6+"; ход чёрных - "23...Nf5" только если force, иначе "Kh8". */
export function moveToken(parentFen: string, san: string, force: boolean): string {
  const [, turn, , , , full] = parentFen.split(' ');
  if (turn === 'w') return `${full}.${san}`;
  return force ? `${full}...${san}` : san;
}

export function nodeLabel(s: BoardState, node: BoardNode): string {
  if (node.parent === null) return 'начальной позиции';
  return moveToken(s.nodes[node.parent].fen, node.san!, true);
}

function plural(n: number): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return 'полуход';
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'полухода';
  return 'полуходов';
}

const epochOf = (s: BoardState): number => s.treeEpoch ?? 0;

/** Новая ветка из одного хода. */
export function lineDraft(s: BoardState, node: BoardNode): Draft {
  const parent = s.nodes[node.parent!];
  return {
    kind: 'line',
    treeEpoch: epochOf(s),
    fromNode: parent.id,
    fromLabel: nodeLabel(s, parent),
    nodes: [node.id],
    moves: [moveToken(parent.fen, node.san!, true)],
  };
}

/** Дописать ход к последнему событию-ветке; null - склеить нельзя. */
export function appendToLine(last: StoredEvent, s: BoardState, node: BoardNode): StoredEvent | null {
  if (last.kind !== 'line' || last.read || last.treeEpoch !== epochOf(s)) return null;
  if (!last.nodes?.length || node.parent !== last.nodes.at(-1)) return null;
  const moves = [...last.moves!, moveToken(s.nodes[node.parent!].fen, node.san!, false)];
  const next = { ...last, nodes: [...last.nodes, node.id], moves };
  return { ...next, text: eventText(next) };
}

function subtreeSize(s: BoardState, id: NodeId): number {
  let n = 0;
  const stack = [id];
  while (stack.length) {
    const cur = s.nodes[stack.pop()!];
    n += 1;
    stack.push(...cur.children);
  }
  return n;
}

/** s - состояние до удаления. */
export function deleteDraft(s: BoardState, nodeId: NodeId): Draft {
  const node = s.nodes[nodeId];
  return {
    kind: 'delete',
    treeEpoch: epochOf(s),
    node: nodeId,
    san: moveToken(s.nodes[node.parent!].fen, node.san!, true),
    plies: subtreeSize(s, nodeId),
  };
}

/** Итог задачи по разнице состояний; null - ничего записывать не нужно. */
export function puzzleDraft(prev: BoardState, next: BoardState): Draft | null {
  const np = next.puzzle;
  const pp = prev.puzzle;
  if (!np || !pp || np.puzzleId !== pp.puzzleId) return null;
  const base = { kind: 'puzzle' as const, treeEpoch: epochOf(next), puzzleId: np.puzzleId, label: np.label };
  const gaveUp = (np.answer && !pp.answer) || (pp.status === 'solving' && np.status === 'failed');
  if (gaveUp) return { ...base, result: 'gaveUp', ...(np.answer ? { answer: np.answer } : {}) };
  if (pp.status === 'solving' && np.status === 'solved') {
    return { ...base, result: 'solved', errors: np.errors, bonus: np.bonus };
  }
  const kind = np.feedback?.kind;
  if (np.phase === 'feedback' && pp.phase !== 'feedback' && (kind === 'wrong' || kind === 'weaker')) {
    const moved = np.checking ? next.nodes[np.checking.moveNode] : undefined;
    if (!moved || moved.parent === null) return null;
    return {
      ...base,
      result: kind,
      san: moveToken(next.nodes[moved.parent].fen, moved.san!, true),
      banner: np.feedback!.text,
    };
  }
  return null;
}

export function eventText(e: Draft): string {
  if (e.kind === 'line') {
    const nodes = e.nodes!;
    const where = nodes.length > 1 ? `узлы ${nodes[0]}-${nodes.at(-1)}` : `узел ${nodes[0]}`;
    return `ветка ученика от ${e.fromLabel}: ${e.moves!.join(' ')} (${where})`;
  }
  if (e.kind === 'delete') return `ученик удалил ветку ${e.san} (${e.plies} ${plural(e.plies!)})`;
  const head = `задача ${e.puzzleId}: `;
  switch (e.result) {
    case 'wrong':
      return `${head}ошибка, ход ${e.san}, «${e.banner}»`;
    case 'weaker':
      return `${head}ход «слабее»: ${e.san}, «${e.banner}»`;
    case 'gaveUp':
      return e.answer ? `${head}показано решение ${e.answer}` : `${head}показано решение (линии нет)`;
    default:
      return `${head}решено${e.errors ? `, ошибок ${e.errors}` : ''}${e.bonus ? ' (второе решение)' : ''}`;
  }
}

export function cursorLine(s: BoardState): string {
  if (s.mode === 'puzzle' && s.puzzle?.status === 'solving') return `на доске задача ${s.puzzle.puzzleId}, решается`;
  const node = s.nodes[s.cursor];
  if (node.parent === null) return `курсор в начальной позиции, режим ${s.mode}`;
  return `курсор после ${moveToken(s.nodes[node.parent].fen, node.san!, true)} (${AUTHOR[node.author]}), режим ${s.mode}`;
}
