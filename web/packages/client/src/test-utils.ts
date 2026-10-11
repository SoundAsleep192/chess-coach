import { Chess } from 'chess.js';
import type { Author, BoardNode, BoardState, Mode, NodeId, ServerMessage } from '@board/shared';
import type { SocketLike } from './useBoardSocket';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Построитель состояния для тестов: ходы в SAN, id узлов n1 (корень), n2, ... */
export class StateBuilder {
  readonly nodes: Record<NodeId, BoardNode> = {};
  private seq = 0;
  readonly rootId: NodeId;

  constructor(fen = START) {
    this.rootId = this.make(null, null, null, fen, 'game');
  }

  private make(parent: NodeId | null, san: string | null, uci: string | null, fen: string, author: Author): NodeId {
    const id = `n${++this.seq}`;
    const ply = parent ? this.nodes[parent].ply + 1 : 0;
    this.nodes[id] = { id, parent, children: [], san, uci, fen, ply, author, arrows: [] };
    if (parent) this.nodes[parent].children.push(id);
    return id;
  }

  /** Добавить линию от узла, вернуть id новых узлов. */
  line(from: NodeId, sans: string[], author: Author): NodeId[] {
    const ids: NodeId[] = [];
    let cur = from;
    for (const san of sans) {
      const chess = new Chess(this.nodes[cur].fen);
      const mv = chess.move(san);
      cur = this.make(cur, mv.san, mv.lan, chess.fen(), author);
      ids.push(cur);
    }
    return ids;
  }

  build(cursor: NodeId, mode: Mode = 'free', version = 1): BoardState {
    return {
      rootFen: this.nodes[this.rootId].fen,
      rootId: this.rootId,
      nodes: structuredClone(this.nodes),
      cursor,
      seq: this.seq,
      version,
      mode,
      orientation: 'white',
      meta: { plyOffset: 0, title: 'Test' },
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
  }
}

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: unknown[] = [];

  constructor() {
    FakeSocket.all.push(this);
  }
  static last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1];
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
}

export const fakeFactory = () => new FakeSocket();
