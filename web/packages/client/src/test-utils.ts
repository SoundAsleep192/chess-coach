import { Chess } from 'chess.js';
import type { Author, BoardNode, BoardState, LessonEntry, LessonView, Mode, NodeId, PuzzleSession, ServerMessage } from '@board/shared';
import type { SocketLike } from './useBoardSocket';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Сессия задачи «вилка» (Дорофеева, т.1 №1) в фазе move; поля можно переопределить. */
export function puzzleSession(over: Partial<PuzzleSession> = {}): PuzzleSession {
  return {
    puzzleId: 'raduga:1-001',
    label: 'Дорофеева, т.1 №1',
    side: 'white',
    solution: ['d5c7', 'e8d7', 'c7a8'],
    done: 0,
    status: 'solving',
    startedAt: '2026-10-11T10:00:00.000Z',
    phase: 'move',
    node: 'n1',
    onMain: true,
    errors: 0,
    weaker: 0,
    altBetter: false,
    recorded: false,
    rootAlternatives: [],
    found: [],
    bonus: false,
    ...over,
  };
}

/** Занятие у доски в фазе student с позиции n1, первая позиция из трёх (index с нуля); поля можно переопределить. */
export function lessonView(over: Partial<LessonView> = {}): LessonView {
  return {
    lessonId: 'L1',
    title: 'проверяй ответ соперника',
    status: 'running',
    index: 0,
    total: 3,
    label: 'Партия 1',
    phase: 'student',
    node: 'n1',
    transcript: [],
    seq: 0,
    online: true,
    ...over,
  };
}

/** Запись истории занятия. */
export function said(who: LessonEntry['who'], kind: LessonEntry['kind'], text: string): LessonEntry {
  return { who, kind, text, at: '2026-10-18T10:00:00.000Z' };
}

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

  /** Состояние в режиме lesson; узел занятия по умолчанию - корень. */
  lesson(cursor: NodeId, over: Partial<LessonView> = {}, version = 1): BoardState {
    return { ...this.build(cursor, 'lesson', version), lesson: lessonView({ node: this.rootId, ...over }) };
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
