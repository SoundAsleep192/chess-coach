import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import type {
  AddLineBody,
  At,
  BoardNode,
  BoardState,
  CursorBody,
  EngineLine,
  Mode,
  NodeId,
  ReplaceBody,
} from '@board/shared';
import { BoardRepository } from '../storage/board-repository';
import {
  addLine,
  addMove,
  deleteBranch,
  fromGame,
  isSubtreeBy,
  mainLine,
  mainLineNodeAtPly,
  toPgn,
} from '../tree/tree';
import {
  another,
  applyUnavailable,
  applyVerdict,
  giveUp,
  pendingCheck,
  playMove,
  playReply,
  retry,
  startSession,
  treeOf,
  type CheckRequest,
  type PuzzleResult,
  type PuzzleStart,
  type ReplyGuard,
  type Step,
} from '../puzzles/puzzle-flow';
import { PuzzleSolver } from '../puzzles/puzzle-solver';
import { TreeError } from '../tree/tree-error';
import { BoardError } from './board-error';

@Injectable()
export class BoardService implements OnModuleInit, OnApplicationShutdown {
  readonly changes = new Subject<BoardState>();
  private state!: BoardState;
  private queue: Promise<unknown> = Promise.resolve();
  readonly puzzleFinished = new Subject<PuzzleResult>();
  private replyTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly replyMs = Number(process.env.PUZZLE_REPLY_MS ?? 500);
  private closed = false;

  constructor(
    private readonly repo: BoardRepository,
    private readonly solver: PuzzleSolver,
  ) {}

  async onModuleInit(): Promise<void> {
    const saved = await this.repo.load();
    if (saved && saved.puzzle && !saved.puzzle.phase) {
      // сессия задачи формата v1 (без phase): не продолжаем, доска остаётся с деревом
      saved.mode = saved.mode === 'puzzle' ? 'free' : saved.mode;
      saved.puzzle = undefined;
    }
    if (saved) {
      this.state = saved;
      // перезапуск во время проверки хода: проверить заново; во время ответа соперника - снова завести таймер
      const check = pendingCheck(saved);
      if (check) this.runCheck(check);
      this.afterPuzzleChange();
      return;
    }
    const tree = fromGame({});
    this.state = {
      ...tree,
      version: 1,
      mode: 'free',
      orientation: 'white',
      meta: { plyOffset: 0 },
      updatedAt: new Date().toISOString(),
    };
    await this.repo.save(this.state);
  }

  get current(): BoardState {
    return this.state;
  }

  pgn(): string {
    const cursor = this.state.nodes[this.state.cursor];
    const headers: Record<string, string> = { Event: this.state.meta.title ?? 'Coach board' };
    if (this.state.meta.gameId) headers.GameId = this.state.meta.gameId;
    headers.Cursor = cursor.id;
    headers.CursorAt = String(cursor.ply + 1);
    headers.Mode = this.state.mode;
    return toPgn(treeOf(this.state), headers);
  }

  async health(): Promise<boolean> {
    try {
      await this.repo.ping();
      return true;
    } catch {
      return false;
    }
  }

  replace(body: ReplaceBody): Promise<BoardState> {
    return this.mutate((s) => {
      if (!body.pgn && body.fen === undefined && !body.moves) {
        throw new BoardError('bad_request', 'PUT /api/board needs pgn or fen/moves');
      }
      const input = body.pgn ? { pgn: body.pgn } : { fen: body.fen, moves: body.moves };
      const tree = fromGame(input, { upto: body.upto, plyOffset: body.plyOffset, seqStart: s.seq });
      if (body.cursorPly !== undefined) {
        const line = mainLine(tree);
        const wanted = body.cursorPly - 1;
        tree.cursor = (line.find((n) => n.ply === wanted) ?? (wanted < line[0].ply ? line[0] : line.at(-1)!)).id;
      }
      return {
        ...s,
        ...tree,
        orientation: body.orientation ?? s.orientation,
        mode: s.mode === 'puzzle' ? 'free' : s.mode,
        puzzle: undefined,
        meta: { title: body.title, gameId: body.gameId, plyOffset: tree.nodes[tree.rootId].ply },
      };
    });
  }

  /** Задача на доске: корень - позиция задачи, ход решающего снизу. Анализ корня - до первого состояния, не дольше PUZZLE_ROOT_MS. */
  async startPuzzle(p: PuzzleStart): Promise<BoardState> {
    const root = await this.solver.rootInfo(p.fen, p.solution[0]);
    const state = await this.mutate((s) => startSession(s, p, root, new Date()));
    this.afterPuzzleChange();
    return state;
  }

  addCoachLine(body: AddLineBody): Promise<BoardState> {
    return this.mutate((s) => {
      if (!Array.isArray(body.moves) || body.moves.length === 0) {
        throw new BoardError('bad_request', 'moves must be a non-empty array');
      }
      const from = this.resolveAt(s, body.at);
      const { tree, nodes } = addLine(treeOf(s), from.id, body.moves, 'coach');
      if (body.caption !== undefined) tree.nodes[nodes.at(-1)!.id].caption = body.caption;
      return { ...s, ...tree };
    });
  }

  setCursor(body: CursorBody): Promise<BoardState> {
    return this.mutate((s) => {
      const target = this.resolveAt(s, body.at);
      const nodes = structuredClone(s.nodes);
      if (body.arrows !== undefined) nodes[target.id].arrows = body.arrows;
      if (body.caption !== undefined) nodes[target.id].caption = body.caption;
      return { ...s, nodes, cursor: target.id };
    });
  }

  setMode(mode: Mode): Promise<BoardState> {
    return this.mutate((s) => {
      if (mode !== 'free' && mode !== 'frozen') throw new BoardError('bad_request', `bad mode ${String(mode)}`);
      return { ...s, mode, puzzle: undefined };
    });
  }

  deleteNode(nodeId: NodeId): Promise<BoardState> {
    return this.mutate((s) => ({ ...s, ...deleteBranch(treeOf(s), nodeId) }));
  }

  studentNavigate(nodeId: NodeId): Promise<BoardState> {
    return this.mutate((s) => {
      this.assertFree(s);
      if (!s.nodes[nodeId]) throw new BoardError('not_found', `node ${nodeId} not found`);
      return { ...s, cursor: nodeId };
    });
  }

  studentMove(parentId: NodeId, uci: string): Promise<BoardState> {
    return this.step((s) => {
      if (s.mode === 'puzzle' && s.puzzle?.status === 'solving') {
        const node = s.nodes[s.puzzle.node];
        const lines = node ? this.solver.cachedLines(node.fen) : undefined;
        return playMove(s, parentId, uci, lines?.[0], new Date(), lines);
      }
      this.assertFree(s);
      if (!s.nodes[parentId]) {
        throw new BoardError('not_found', `node ${parentId} not found (the board was probably replaced)`);
      }
      const { tree, node } = addMove(treeOf(s), parentId, uci, 'student');
      return { state: { ...s, ...tree, cursor: node.id }, finished: null };
    });
  }

  /** «Ещё раз» после ошибки или хода «слабее». */
  puzzleRetry(): Promise<BoardState> {
    return this.step((s) => ({ state: retry(s), finished: null }));
  }

  /** «Показать решение». Вне записанной линии нужна линия движка из узла: она берётся до изменения состояния. */
  async puzzleGiveUp(): Promise<BoardState> {
    const pz = this.state.puzzle;
    let best: EngineLine | undefined;
    if (pz?.status === 'solving' && !pz.onMain && !pz.bonus && pz.phase !== 'reply' && this.state.nodes[pz.node]) {
      best = await this.solver.best(this.state.nodes[pz.node].fen).catch((e: unknown) => {
        console.error(`board: cannot get the engine line to show for ${pz.puzzleId}: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      });
    }
    return this.step((s) => giveUp(s, best, new Date()));
  }

  /** «Найти другое» после решения. */
  puzzleAnother(): Promise<BoardState> {
    return this.step((s) => ({ state: another(s), finished: null }));
  }

  studentDelete(nodeId: NodeId): Promise<BoardState> {
    return this.mutate((s) => {
      this.assertFree(s);
      if (!s.nodes[nodeId]) throw new BoardError('not_found', `node ${nodeId} not found`);
      if (!isSubtreeBy(treeOf(s), nodeId, 'student')) {
        throw new BoardError('forbidden', `branch ${nodeId} is not entirely the student's`);
      }
      return { ...s, ...deleteBranch(treeOf(s), nodeId) };
    });
  }

  onApplicationShutdown(): void {
    this.closed = true;
    clearTimeout(this.replyTimer);
  }

  /** Изменение с шагом задачи: после записи - попытка в историю, проверка хода движком, ответ соперника, анализ узла. */
  private step(change: (s: BoardState) => Step): Promise<BoardState> {
    let step: Step | null = null;
    return this.mutate((s) => {
      step = change(s);
      return step.state;
    }).then((state) => {
      this.afterStep(step);
      return state;
    });
  }

  private afterStep(step: Step | null): void {
    if (!step) return;
    if (step.finished) this.puzzleFinished.next(step.finished);
    if (step.check) this.runCheck(step.check);
    this.afterPuzzleChange();
  }

  /** Оценка хода движком вне очереди изменений; вердикт - вторым изменением, только для той же задачи и того же хода. */
  private runCheck(req: CheckRequest): void {
    this.solver
      .verdict(req)
      .then(
        (v) => {
          if (this.closed) return;
          return this.step((s) => applyVerdict(s, req, v, new Date()));
        },
        (e: unknown) => {
          if (this.closed) return;
          console.error(`board: cannot check ${req.uci} in ${req.puzzleId}: ${e instanceof Error ? e.message : String(e)}`);
          return this.mutate((s) => applyUnavailable(s, req)).then(() => this.afterPuzzleChange());
        },
      )
      .catch((e: unknown) => {
        if (!this.closed) console.error(`board: cannot apply the check of ${req.uci} in ${req.puzzleId}: ${String(e)}`);
      });
  }

  /** Фаза reply - ответ соперника через replyMs; фаза move - анализ нового узла заранее. */
  private afterPuzzleChange(): void {
    const pz = this.state.puzzle;
    if (this.closed || this.state.mode !== 'puzzle' || pz?.status !== 'solving') return;
    if (pz.phase === 'reply') {
      const guard: ReplyGuard = { puzzleId: pz.puzzleId, startedAt: pz.startedAt, done: pz.done };
      clearTimeout(this.replyTimer);
      this.replyTimer = setTimeout(() => {
        this.step((s) => playReply(s, guard, new Date())).catch((e: unknown) =>
          console.error(`board: cannot play the opponent reply for ${guard.puzzleId}: ${String(e)}`),
        );
      }, this.replyMs);
    } else if (pz.phase === 'move') {
      const node = this.state.nodes[pz.node];
      if (node) this.solver.prefetch(node.fen);
    }
  }

  private assertFree(s: BoardState): void {
    if (s.mode === 'frozen') throw new BoardError('frozen', 'the board is frozen by the coach');
    if (s.mode === 'puzzle') throw new BoardError('frozen', 'a puzzle is being solved: only a move from the puzzle position counts');
  }

  private resolveAt(s: BoardState, at: At): BoardNode {
    if (typeof at === 'number') {
      const node = mainLineNodeAtPly(treeOf(s), at);
      if (!node) {
        const line = mainLine(treeOf(s));
        throw new BoardError(
          'not_found',
          `position ${at} is outside the main line: available ${line[0].ply + 1}..${line.at(-1)!.ply + 1}`,
        );
      }
      return node;
    }
    const node = s.nodes[at];
    if (!node) throw new BoardError('not_found', `node ${at} not found`);
    return node;
  }

  /** Изменения по очереди: вычислить новое состояние, сохранить, только потом подменить и разослать. */
  private mutate(change: (s: BoardState) => BoardState): Promise<BoardState> {
    const run = async (): Promise<BoardState> => {
      let next: BoardState;
      try {
        next = change(this.state);
      } catch (e) {
        if (e instanceof TreeError) throw new BoardError(e.code, e.message);
        throw e;
      }
      if (next === this.state) return next;
      next = { ...next, version: this.state.version + 1, updatedAt: new Date().toISOString() };
      try {
        await this.repo.save(next);
      } catch (e) {
        throw new BoardError('storage', `storage error: ${(e as Error).message}`);
      }
      this.state = next;
      this.changes.next(next);
      return next;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
