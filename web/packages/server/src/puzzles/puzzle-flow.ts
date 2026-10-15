import { Chess } from 'chess.js';
import { alternativesLeft, type BoardState, type EngineLine, type NodeId, type PuzzleClassification, type PuzzleSession, type Tree } from '@board/shared';
import { BoardError } from '../board/board-error';
import { addLine, addMove, deleteBranch, fromGame, pathTo, promote } from '../tree/tree';
import { TreeError } from '../tree/tree-error';
import { arrow, describeWeaker, describeWrong, terminalAfter, type MoveVerdict, type Terminal } from './judge';
import { sanLine, sideOf } from './puzzle-logic';

/** Чистые переходы задачи на доске: каждая функция получает состояние и возвращает новое. Движок зовёт BoardService. */

export const CORRECT_TEXT = 'Верно, продолжайте';
export const UNAVAILABLE_TEXT = 'Не могу проверить ход: движок недоступен';
export const REPEAT_TEXT = 'Это решение вы уже нашли';

export interface PuzzleStart {
  puzzleId: string;
  fen: string;
  solution: string[];
  label: string;
}

/** Анализ корня при старте: равноценные первые ходы и классификация задачи. */
export interface RootInfo {
  rootAlternatives: string[];
  classification?: PuzzleClassification;
}

export interface PuzzleResult {
  puzzleId: string;
  correct: boolean;
  ms: number;
  at: Date;
  weaker: number;
  altBetter: boolean;
}

/** Ход ученика ждёт оценки движка; вердикт применяется только к той же задаче и тому же ходу. */
export interface CheckRequest {
  puzzleId: string;
  startedAt: string;
  moveNode: NodeId;
  /** Позиция узла, ходит решающий. */
  fen: string;
  uci: string;
  /** Ход решения в узле, пока ученик на записанной линии; иначе ожидаемый ход - лучший ход движка. */
  expected?: string;
  terminal: Terminal;
  /** Заход «Найти другое»: первый ход из решения или альтернатив засчитывается при любом вердикте, оценка нужна ради ответа соперника. */
  forced?: boolean;
}

export interface Verdict {
  verdict: MoveVerdict;
  expected: EngineLine;
  played: EngineLine;
}

export interface ReplyGuard {
  puzzleId: string;
  startedAt: string;
  done: number;
}

export interface Step {
  state: BoardState;
  finished: PuzzleResult | null;
  check?: CheckRequest;
}

export function treeOf(s: BoardState): Tree {
  const { rootFen, rootId, nodes, cursor, seq } = s;
  return { rootFen, rootId, nodes, cursor, seq };
}

const depth = (t: Tree, id: NodeId) => t.nodes[id].ply - t.nodes[t.rootId].ply;
const pathUcis = (t: Tree, id: NodeId) => pathTo(t, id).slice(1).map((n) => n.uci!);
const unchanged = (s: BoardState): Step => ({ state: s, finished: null });

/** UCI хода так, как его записывает chess.js (превращение - пятая буква), или TreeError('illegal'). */
function lanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).lan;
  } catch {
    throw new TreeError('illegal', `illegal move ${uci} in position ${fen}`);
  }
}

/** Попытка в историю: один раз за задачу и никогда в заходе «Найти другое». */
function record(pz: PuzzleSession, correct: boolean, now: Date): { pz: PuzzleSession; finished: PuzzleResult | null } {
  if (pz.recorded || pz.bonus) return { pz, finished: null };
  const ms = Math.max(0, now.getTime() - Date.parse(pz.startedAt));
  return {
    pz: { ...pz, recorded: true },
    finished: { puzzleId: pz.puzzleId, correct, ms, at: now, weaker: pz.weaker, altBetter: pz.altBetter },
  };
}

export function startSession(s: BoardState, p: PuzzleStart, root: RootInfo, now: Date): BoardState {
  const tree = fromGame({ fen: p.fen }, { seqStart: s.seq });
  const side = sideOf(p.fen);
  return {
    ...s,
    ...tree,
    mode: 'puzzle',
    orientation: side,
    meta: { title: p.label, plyOffset: tree.nodes[tree.rootId].ply },
    puzzle: {
      puzzleId: p.puzzleId,
      label: p.label,
      side,
      solution: [...p.solution],
      done: 0,
      status: 'solving',
      startedAt: now.toISOString(),
      phase: 'move',
      node: tree.rootId,
      onMain: true,
      errors: 0,
      weaker: 0,
      altBetter: false,
      recorded: false,
      rootAlternatives: root.rootAlternatives,
      found: [],
      ...(root.classification ? { classification: root.classification } : {}),
      bonus: false,
    },
  };
}

function solve(s: BoardState, tree: Tree, cursor: NodeId, pz: PuzzleSession, now: Date): Step {
  const first = pathTo(tree, cursor)[1]?.uci;
  const found = first && !pz.found.includes(first) ? [...pz.found, first] : pz.found;
  const solved: PuzzleSession = {
    ...pz,
    status: 'solved',
    phase: 'move',
    node: cursor,
    done: depth(tree, cursor),
    found,
    feedback: undefined,
    checking: undefined,
    reply: undefined,
  };
  const { pz: rec, finished } = record(solved, true, now);
  return { state: { ...s, ...tree, cursor, mode: 'free', puzzle: rec }, finished };
}

/**
 * Ход решающего засчитан. Конец задачи: мат или ничья на доске, конец записанного решения на главной линии,
 * вне её - столько же ходов решающего, сколько в решении; нет ответа соперника - тоже конец. Иначе ждём ответ.
 */
function accept(s: BoardState, tree: Tree, moveNode: NodeId, pz: PuzzleSession, reply: string | undefined, terminal: Terminal, now: Date): Step {
  const d = depth(tree, moveNode);
  const next: PuzzleSession = { ...pz, done: d, feedback: { kind: 'correct', text: CORRECT_TEXT }, checking: undefined };
  const lineDone = pz.onMain ? d >= pz.solution.length : Math.ceil(d / 2) >= Math.ceil(pz.solution.length / 2);
  if (terminal !== null || lineDone || !reply) return solve(s, tree, moveNode, next, now);
  return { state: { ...s, ...tree, cursor: moveNode, puzzle: { ...next, phase: 'reply', reply } }, finished: null };
}

/**
 * Ход ученика в фазе move. Ход решения на главной линии, лучший ход движка вне её (best - готовый анализ узла) и мат
 * засчитываются сразу. Остальные ходы встают на доску в фазе checking и возвращают запрос на оценку.
 */
export function playMove(
  s: BoardState,
  parentId: NodeId,
  uci: string,
  best: EngineLine | undefined,
  now: Date,
  /** Готовые линии узла (multipv 3): ответ на альтернативу берётся из её собственной линии. */
  lines: EngineLine[] = best ? [best] : [],
): Step {
  const pz = s.puzzle!;
  if (pz.phase === 'checking') throw new BoardError('frozen', 'wait: the move is being checked');
  if (pz.phase === 'reply') throw new BoardError('frozen', 'wait for the opponent reply');
  if (pz.phase === 'feedback') throw new BoardError('frozen', 'press «Ещё раз» to try again');
  if (parentId !== pz.node || parentId !== s.cursor || !s.nodes[parentId]) {
    throw new BoardError('not_found', `node ${parentId} is not the puzzle position (the board was probably replaced)`);
  }
  const tree = treeOf(s);
  const fen = s.nodes[pz.node].fen;
  const lan = lanOf(fen, uci);
  const done = depth(tree, pz.node);
  if (pz.bonus && done === 0 && pz.found.includes(lan)) {
    return unchanged({ ...s, puzzle: { ...pz, feedback: { kind: 'repeat', text: REPEAT_TEXT } } });
  }
  const terminal = terminalAfter(s.rootFen, [...pathUcis(tree, pz.node), lan]);
  const forced = pz.bonus && done === 0 && [pz.solution[0], ...pz.rootAlternatives].includes(lan);
  if (forced) {
    // заход «Найти другое»: первый ход, равноценный решению или сильнее его, засчитывается, даже если движок считает
    // лучшим другой ход; ответ соперника - из записанного решения или из готовой линии этого хода
    const onMain = lan === pz.solution[0];
    const line = lines.find((l) => l.move === lan);
    if (onMain || line) {
      const { tree: added, node } = addMove(tree, pz.node, lan, 'student');
      const reply = onMain ? pz.solution[1] : line!.pv[1];
      return accept(s, promote(added, node.id), node.id, { ...pz, onMain }, reply, terminal, now);
    }
  }
  const expected = pz.onMain ? pz.solution[done] : best?.move;
  const { tree: added, node, created } = addMove(tree, pz.node, lan, 'student');
  if (lan === expected || terminal === 'checkmate') {
    const onMain = pz.onMain && lan === pz.solution[done];
    const reply = onMain ? pz.solution[done + 1] : best?.pv[1];
    return accept(s, promote(added, node.id), node.id, { ...pz, onMain }, reply, terminal, now);
  }
  const check: CheckRequest = {
    puzzleId: pz.puzzleId,
    startedAt: pz.startedAt,
    moveNode: node.id,
    fen,
    uci: lan,
    ...(pz.onMain ? { expected: pz.solution[done] } : {}),
    terminal,
    ...(forced ? { forced: true } : {}),
  };
  const checking: PuzzleSession = { ...pz, phase: 'checking', feedback: undefined, checking: { moveNode: node.id, created } };
  return { state: { ...s, ...added, cursor: node.id, puzzle: checking }, finished: null, check };
}

/** Незаконченная проверка из сохранённого состояния (после перезапуска сервера). */
export function pendingCheck(s: BoardState): CheckRequest | null {
  const pz = s.puzzle;
  if (s.mode !== 'puzzle' || pz?.status !== 'solving' || pz.phase !== 'checking' || !pz.checking) return null;
  const move = s.nodes[pz.checking.moveNode];
  if (!move || !s.nodes[pz.node]) return null;
  const tree = treeOf(s);
  return {
    puzzleId: pz.puzzleId,
    startedAt: pz.startedAt,
    moveNode: move.id,
    fen: s.nodes[pz.node].fen,
    uci: move.uci!,
    ...(pz.onMain ? { expected: pz.solution[depth(tree, pz.node)] } : {}),
    terminal: terminalAfter(s.rootFen, pathUcis(tree, move.id)),
    ...(pz.bonus && depth(tree, pz.node) === 0 && [pz.solution[0], ...pz.rootAlternatives].includes(move.uci!) ? { forced: true } : {}),
  };
}

/** Проверка та же, но тренер успел удалить проверяемый узел: вердикт отбрасывается, задача ждёт хода в своём узле. */
function orphaned(s: BoardState, req: CheckRequest): BoardState | null {
  const pz = s.puzzle;
  if (!isPending(s, req) || s.nodes[req.moveNode]) return null;
  const cursor = s.nodes[pz!.node] ? pz!.node : s.rootId;
  return { ...s, cursor, puzzle: { ...pz!, phase: 'move', checking: undefined, feedback: undefined } };
}

function isPending(s: BoardState, req: CheckRequest): boolean {
  const pz = s.puzzle;
  return (
    s.mode === 'puzzle' &&
    pz?.status === 'solving' &&
    pz.phase === 'checking' &&
    pz.puzzleId === req.puzzleId &&
    pz.startedAt === req.startedAt &&
    pz.checking?.moveNode === req.moveNode
  );
}

/**
 * Вердикт движка. Равноценный или сильнее - как верный ход (вне главной линии, ответ - pv[1] линии хода).
 * Слабее - жёлтая плашка без ответа. Ошибка - опровержение веткой после хода ученика, стрелки на нём, запись попытки.
 */
export function applyVerdict(s: BoardState, req: CheckRequest, v: Verdict, now: Date): Step {
  if (!isPending(s, req)) return unchanged(s);
  const gone = orphaned(s, req);
  if (gone) return unchanged(gone);
  const pz = s.puzzle!;
  const tree = treeOf(s);
  const verdict = req.forced && (v.verdict === 'wrong' || v.verdict === 'weaker') ? 'equal' : v.verdict;
  if (verdict === 'equal' || verdict === 'better') {
    const next = { ...pz, onMain: false, altBetter: pz.altBetter || verdict === 'better' };
    return accept(s, promote(tree, req.moveNode), req.moveNode, next, v.played.pv[1], req.terminal, now);
  }
  if (verdict === 'weaker') {
    const feedback = { kind: 'weaker' as const, text: describeWeaker(v.expected, v.played) };
    return unchanged({ ...s, puzzle: { ...pz, phase: 'feedback', weaker: pz.weaker + 1, feedback } });
  }
  const { text, arrows } = describeWrong({ fen: req.fen, played: req.uci, playedLine: v.played, expected: v.expected });
  let t = tree;
  let cursor = req.moveNode;
  const refutation = v.played.pv[0] === req.uci ? v.played.pv[1] : undefined;
  if (refutation) {
    try {
      const added = addMove(t, req.moveNode, refutation, 'game');
      t = added.tree;
      cursor = added.node.id;
      t.nodes[cursor] = { ...t.nodes[cursor], arrows };
    } catch (e) {
      if (!(e instanceof TreeError)) throw e;
    }
  }
  const errored: PuzzleSession = { ...pz, phase: 'feedback', errors: pz.errors + 1, feedback: { kind: 'wrong', text } };
  const { pz: rec, finished } = record(errored, false, now);
  return { state: { ...s, ...t, cursor, puzzle: rec }, finished };
}

/** Движок не ответил: ход ученика снимается с доски (если узел появился ради проверки), попытка не пишется. */
export function applyUnavailable(s: BoardState, req: CheckRequest): BoardState {
  if (!isPending(s, req)) return s;
  const gone = orphaned(s, req);
  if (gone) return gone;
  const pz = s.puzzle!;
  const tree = pz.checking!.created ? deleteBranch(treeOf(s), req.moveNode) : treeOf(s);
  return {
    ...s,
    ...tree,
    cursor: pz.node,
    puzzle: { ...pz, phase: 'move', checking: undefined, feedback: { kind: 'unavailable', text: UNAVAILABLE_TEXT } },
  };
}

/** Ответ соперника применяется только к той же задаче в той же фазе и на том же полуходе. */
export function playReply(s: BoardState, g: ReplyGuard, now: Date): Step {
  const pz = s.puzzle;
  if (
    s.mode !== 'puzzle' ||
    pz?.status !== 'solving' ||
    pz.phase !== 'reply' ||
    !pz.reply ||
    pz.puzzleId !== g.puzzleId ||
    pz.startedAt !== g.startedAt ||
    pz.done !== g.done
  ) {
    return unchanged(s);
  }
  const { tree, node } = addMove(treeOf(s), s.cursor, pz.reply, 'game');
  const next: PuzzleSession = { ...pz, done: pz.done + 1, phase: 'move', node: node.id, reply: undefined };
  // решение чётной длины кончается ходом соперника; ход в позицию без ходов решающего - тоже конец
  if ((pz.onMain && next.done >= pz.solution.length) || new Chess(node.fen).isGameOver()) return solve(s, tree, node.id, next, now);
  return unchanged({ ...s, ...tree, cursor: node.id, puzzle: next });
}

/** «Ещё раз»: курсор в узел перед ошибкой или ходом «слабее», стрелки опровержения сняты. */
export function retry(s: BoardState): BoardState {
  const pz = s.puzzle;
  if (s.mode !== 'puzzle' || pz?.status !== 'solving' || pz.phase !== 'feedback') {
    throw new BoardError('frozen', 'nothing to retry: the puzzle waits for a move');
  }
  const nodes = structuredClone(s.nodes);
  const judged = pz.checking ? nodes[pz.checking.moveNode] : undefined;
  if (judged) {
    judged.arrows = [];
    for (const id of judged.children) nodes[id].arrows = [];
  }
  return {
    ...s,
    nodes,
    cursor: pz.node,
    puzzle: { ...pz, phase: 'move', done: depth(treeOf(s), pz.node), feedback: undefined, checking: undefined },
  };
}

/**
 * «Показать решение». На главной линии - остаток записанного решения, вне её - линия движка из анализа узла (best),
 * не длиннее оставшихся ходов решающего. Зелёная стрелка - первый ход, курсор в узле, режим free, попытка - ошибка,
 * если ещё не записана. В заходе «Найти другое» - стрелка на ненайденный первый ход, задача остаётся решённой.
 */
export function giveUp(s: BoardState, best: EngineLine | undefined, now: Date): Step {
  const pz = s.puzzle;
  if (s.mode !== 'puzzle' || pz?.status !== 'solving') throw new BoardError('frozen', 'no puzzle is being solved');
  let tree = treeOf(s);
  if (pz.bonus) {
    const left = [pz.solution[0], ...pz.rootAlternatives].find((m) => !pz.found.includes(m));
    tree.nodes = structuredClone(tree.nodes);
    tree.nodes[tree.rootId].arrows = left ? [arrow(left, 'green')] : [];
    const shown: PuzzleSession = {
      ...pz,
      status: 'solved',
      phase: 'move',
      node: tree.rootId,
      done: 0,
      feedback: undefined,
      checking: undefined,
      reply: undefined,
      ...(left ? { answer: sanLine(s.rootFen, [left]) } : {}),
    };
    return unchanged({ ...s, ...tree, cursor: tree.rootId, mode: 'free', puzzle: shown });
  }
  const base = pz.phase === 'reply' ? s.cursor : pz.node;
  const d = depth(tree, base);
  let rest: string[];
  if (pz.onMain) rest = pz.solution.slice(d);
  else if (pz.phase === 'reply') rest = pz.reply ? [pz.reply] : [];
  else {
    const left = Math.ceil(pz.solution.length / 2) - Math.ceil(d / 2);
    rest = best ? best.pv.slice(0, Math.max(1, 2 * left - 1)) : [];
  }
  let answer: string | undefined;
  if (rest.length > 0) {
    try {
      const added = addLine(tree, base, rest, 'game');
      tree = promote(added.tree, added.nodes[0].id);
      tree.nodes[base] = { ...tree.nodes[base], arrows: [arrow(rest[0], 'green')] };
      answer = sanLine(s.nodes[base].fen, rest);
    } catch (e) {
      if (!(e instanceof TreeError)) throw e;
    }
  }
  const failed: PuzzleSession = {
    ...pz,
    status: 'failed',
    phase: 'move',
    node: base,
    done: d,
    feedback: undefined,
    checking: undefined,
    reply: undefined,
    ...(answer ? { answer } : {}),
  };
  const { pz: rec, finished } = record(failed, false, now);
  return { state: { ...s, ...tree, cursor: base, mode: 'free', puzzle: rec }, finished };
}

/** «Найти другое»: после решения, если есть ненайденный равноценный первый ход. Заход в историю не пишется. */
export function another(s: BoardState): BoardState {
  const pz = s.puzzle;
  if (!pz || pz.status !== 'solved' || pz.bonus || !alternativesLeft(pz)) throw new BoardError('frozen', 'no other solution to find');
  const nodes = structuredClone(s.nodes);
  nodes[s.rootId].arrows = [];
  return {
    ...s,
    nodes,
    cursor: s.rootId,
    mode: 'puzzle',
    puzzle: {
      ...pz,
      status: 'solving',
      phase: 'move',
      node: s.rootId,
      done: 0,
      onMain: false,
      bonus: true,
      feedback: undefined,
      checking: undefined,
      reply: undefined,
    },
  };
}
