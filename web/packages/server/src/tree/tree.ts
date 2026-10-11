import { Chess } from 'chess.js';
import pgnParser from '@mliebelt/pgn-parser';
import type { Author, BoardNode, NodeId, Tree } from '@board/shared';
import { TreeError } from './tree-error';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type GameInput = { pgn: string } | { fen?: string; moves?: string[] };
export interface FromGameOptions {
  /** Обрезать главную линию: остаются ходы с номером полухода меньше upto (позиция перед полуходом upto - последняя). */
  upto?: number;
  /** Номер полухода корня. По умолчанию выводится из FEN: (номер хода - 1) * 2 + (ход чёрных ? 1 : 0). */
  plyOffset?: number;
  /** С какого номера выдавать id узлов. Сервис передаёт seq текущего дерева, чтобы старые id не переиспользовались. */
  seqStart?: number;
}

type ParsedMove = ReturnType<typeof pgnParser.parseGame>['moves'][number];

function chessAt(fen: string): Chess {
  return new Chess(fen);
}

export function plyFromFen(fen: string): number {
  const parts = fen.split(' ');
  const fullmove = Number(parts[5] ?? '1') || 1;
  return (fullmove - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

function getNode(tree: Tree, id: NodeId): BoardNode {
  const node = tree.nodes[id];
  if (!node) throw new TreeError('not_found', `node ${id} not found`);
  return node;
}

function newId(tree: Tree): NodeId {
  tree.seq += 1;
  return `n${tree.seq}`;
}

function emptyTree(fen: string, ply: number, seqStart: number): Tree {
  try {
    chessAt(fen);
  } catch {
    throw new TreeError('bad_request', `bad FEN: ${fen}`);
  }
  const tree: Tree = { rootFen: fen, rootId: '', nodes: {}, cursor: '', seq: seqStart };
  const id = newId(tree);
  tree.nodes[id] = { id, parent: null, children: [], san: null, uci: null, fen, ply, author: 'game', arrows: [] };
  tree.rootId = id;
  tree.cursor = id;
  return tree;
}

/** Ход из узла в мутируемом дереве. move - SAN или UCI (e2e4, e7e8q). */
function pushMove(tree: Tree, parentId: NodeId, move: string, author: Author): BoardNode {
  const parent = getNode(tree, parentId);
  const chess = chessAt(parent.fen);
  let played;
  try {
    played = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
      ? chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
      : chess.move(move);
  } catch {
    const legal = chessAt(parent.fen).moves().join(' ');
    throw new TreeError('illegal', `illegal move ${move} in position ${parent.fen}; legal: ${legal}`);
  }
  const uci = played.lan;
  const existing = parent.children.map((c) => tree.nodes[c]).find((c) => c.uci === uci);
  if (existing) return existing;
  const id = newId(tree);
  const node: BoardNode = {
    id,
    parent: parent.id,
    children: [],
    san: played.san,
    uci,
    fen: chess.fen(),
    ply: parent.ply + 1,
    author,
    arrows: [],
  };
  tree.nodes[id] = node;
  parent.children.push(id);
  return node;
}

export function addMove(
  tree: Tree,
  parentId: NodeId,
  uci: string,
  author: Author,
): { tree: Tree; node: BoardNode; created: boolean } {
  const t = structuredClone(tree);
  const before = t.seq;
  const node = pushMove(t, parentId, uci, author);
  return { tree: t, node, created: t.seq !== before };
}

export function addLine(
  tree: Tree,
  parentId: NodeId,
  moves: string[],
  author: Author,
): { tree: Tree; nodes: BoardNode[] } {
  const t = structuredClone(tree);
  const nodes: BoardNode[] = [];
  let current = getNode(t, parentId).id;
  moves.forEach((move, i) => {
    try {
      const node = pushMove(t, current, move, author);
      nodes.push(node);
      current = node.id;
    } catch (e) {
      if (e instanceof TreeError && e.code === 'illegal') {
        throw new TreeError('illegal', `move ${i + 1} (${move}) is illegal: ${e.message}`);
      }
      throw e;
    }
  });
  return { tree: t, nodes };
}

function subtreeIds(tree: Tree, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    stack.push(...tree.nodes[cur].children);
  }
  return out;
}

export function deleteBranch(tree: Tree, nodeId: NodeId): Tree {
  const t = structuredClone(tree);
  const node = getNode(t, nodeId);
  if (node.parent === null) throw new TreeError('bad_request', 'cannot delete the root');
  const ids = subtreeIds(t, nodeId);
  const parent = t.nodes[node.parent];
  parent.children = parent.children.filter((c) => c !== nodeId);
  for (const id of ids) delete t.nodes[id];
  if (ids.includes(t.cursor)) t.cursor = parent.id;
  return t;
}

export function isSubtreeBy(tree: Tree, nodeId: NodeId, author: Author): boolean {
  return subtreeIds(tree, getNode(tree, nodeId).id).every((id) => tree.nodes[id].author === author);
}

export function pathTo(tree: Tree, nodeId: NodeId): BoardNode[] {
  const path: BoardNode[] = [];
  let cur: BoardNode | undefined = getNode(tree, nodeId);
  while (cur) {
    path.unshift(cur);
    cur = cur.parent === null ? undefined : tree.nodes[cur.parent];
  }
  return path;
}

export function mainLine(tree: Tree): BoardNode[] {
  const line: BoardNode[] = [];
  let cur: BoardNode | undefined = tree.nodes[tree.rootId];
  while (cur) {
    line.push(cur);
    cur = cur.children.length ? tree.nodes[cur.children[0]] : undefined;
  }
  return line;
}

/** Узел главной линии, в котором стоит позиция перед полуходом `ply` (нумерация review). Нет такого - null. */
export function mainLineNodeAtPly(tree: Tree, ply: number): BoardNode | null {
  return mainLine(tree).find((n) => n.ply === ply - 1) ?? null;
}

function moveNumberPrefix(parentFen: string, force: boolean): string | null {
  const [, turn, , , , full] = parentFen.split(' ');
  if (turn === 'w') return `${full}.`;
  return force ? `${full}...` : null;
}

function startsStudentRun(tree: Tree, node: BoardNode): boolean {
  return node.author === 'student' && node.parent !== null && tree.nodes[node.parent].author !== 'student';
}

function lineTokens(tree: Tree, first: BoardNode): string[] {
  const out: string[] = [];
  let node: BoardNode | undefined = first;
  let forceNumber = true;
  while (node) {
    const parent = tree.nodes[node.parent!];
    const num = moveNumberPrefix(parent.fen, forceNumber);
    if (num) out.push(num);
    out.push(node.san!);
    forceNumber = false;
    if (startsStudentRun(tree, node)) {
      out.push('{ученик}');
      forceNumber = true;
    }
    if (parent.children[0] === node.id) {
      for (const alt of parent.children.slice(1)) {
        out.push(`(${lineTokens(tree, tree.nodes[alt]).join(' ')})`);
        forceNumber = true;
      }
    }
    node = node.children.length ? tree.nodes[node.children[0]] : undefined;
  }
  return out;
}

export function toPgn(tree: Tree, headers: Record<string, string> = {}): string {
  const all: Record<string, string> = { ...headers };
  if (tree.rootFen !== START_FEN) {
    all.SetUp = '1';
    all.FEN = tree.rootFen;
  }
  const head = Object.entries(all)
    .map(([k, v]) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
    .join('\n');
  const root = tree.nodes[tree.rootId];
  const body = root.children.length ? [...lineTokens(tree, tree.nodes[root.children[0]]), '*'].join(' ') : '*';
  return head ? `${head}\n\n${body}\n` : `${body}\n`;
}

function addParsedLine(tree: Tree, parentId: NodeId, moves: ParsedMove[], author: Author, upto?: number): void {
  let current = parentId;
  for (const mv of moves) {
    const parentNode = tree.nodes[current];
    if (upto !== undefined && parentNode.ply + 1 >= upto) return;
    const node = pushMove(tree, current, mv.notation.notation, author);
    for (const variation of mv.variations) {
      addParsedLine(tree, parentNode.id, variation, 'coach');
    }
    current = node.id;
  }
}

export function fromGame(input: GameInput, opts: FromGameOptions = {}): Tree {
  const seqStart = opts.seqStart ?? 0;
  if ('pgn' in input) {
    let parsed;
    try {
      parsed = pgnParser.parseGame(input.pgn);
    } catch (e) {
      throw new TreeError('bad_request', `cannot parse PGN: ${(e as Error).message.split('\n')[0]}`);
    }
    const fen = (parsed.tags?.FEN as string | undefined) ?? START_FEN;
    const tree = emptyTree(fen, opts.plyOffset ?? plyFromFen(fen), seqStart);
    try {
      addParsedLine(tree, tree.rootId, parsed.moves, 'game', opts.upto);
    } catch (e) {
      if (e instanceof TreeError) throw new TreeError(e.code, `PGN: ${e.message}`);
      throw e;
    }
    tree.cursor = mainLine(tree).at(-1)!.id;
    return tree;
  }
  const fen = input.fen ?? START_FEN;
  const tree = emptyTree(fen, opts.plyOffset ?? plyFromFen(fen), seqStart);
  let current = tree.rootId;
  for (const move of input.moves ?? []) {
    if (opts.upto !== undefined && tree.nodes[current].ply + 1 >= opts.upto) break;
    current = pushMove(tree, current, move, 'game').id;
  }
  tree.cursor = current;
  return tree;
}
