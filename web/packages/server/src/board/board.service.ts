import { Injectable, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import type {
  AddLineBody,
  At,
  BoardNode,
  BoardState,
  CursorBody,
  Mode,
  NodeId,
  ReplaceBody,
  Tree,
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
import { TreeError } from '../tree/tree-error';
import { BoardError } from './board-error';

function treeOf(state: BoardState): Tree {
  const { rootFen, rootId, nodes, cursor, seq } = state;
  return { rootFen, rootId, nodes, cursor, seq };
}

@Injectable()
export class BoardService implements OnModuleInit {
  readonly changes = new Subject<BoardState>();
  private state!: BoardState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly repo: BoardRepository) {}

  async onModuleInit(): Promise<void> {
    const saved = await this.repo.load();
    if (saved) {
      this.state = saved;
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
        meta: { title: body.title, gameId: body.gameId, plyOffset: tree.nodes[tree.rootId].ply },
      };
    });
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
      return { ...s, mode };
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
    return this.mutate((s) => {
      this.assertFree(s);
      if (!s.nodes[parentId]) {
        throw new BoardError('not_found', `node ${parentId} not found (the board was probably replaced)`);
      }
      const { tree, node } = addMove(treeOf(s), parentId, uci, 'student');
      return { ...s, ...tree, cursor: node.id };
    });
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

  private assertFree(s: BoardState): void {
    if (s.mode === 'frozen') throw new BoardError('frozen', 'the board is frozen by the coach');
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
