export type NodeId = string;
export type Author = 'game' | 'coach' | 'student';
export type Mode = 'frozen' | 'free';
export type Orientation = 'white' | 'black';
export type ArrowColor = 'green' | 'red' | 'blue';

export interface Arrow {
  from: string;
  to: string;
  color: ArrowColor;
}

/** Узел дерева ходов. В спецификации называется `Node`; переименован, чтобы не пересекаться с DOM `Node`. */
export interface BoardNode {
  id: NodeId;
  parent: NodeId | null;
  children: NodeId[];
  san: string | null;
  uci: string | null;
  fen: string;
  ply: number;
  author: Author;
  arrows: Arrow[];
  caption?: string;
}

/** Дерево, с которым работают чистые функции. `seq` - счётчик id, растёт и не сбрасывается при замене дерева. */
export interface Tree {
  rootFen: string;
  rootId: NodeId;
  nodes: Record<NodeId, BoardNode>;
  cursor: NodeId;
  seq: number;
}

export interface BoardMeta {
  title?: string;
  gameId?: string;
  plyOffset: number;
}

/** То, что получает браузер и `GET /api/board`: документ без `_id`, дата строкой. */
export interface BoardState extends Tree {
  version: number;
  mode: Mode;
  orientation: Orientation;
  meta: BoardMeta;
  updatedAt: string;
}

export type ErrorCode = 'illegal' | 'frozen' | 'not_found' | 'forbidden' | 'storage' | 'bad_request';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  version: number;
}

// WebSocket: сервер -> браузер
export type ServerMessage =
  | { event: 'state'; data: BoardState }
  | { event: 'error'; data: ErrorPayload };

// WebSocket: браузер -> сервер
export interface NavigateData { nodeId: NodeId }
export interface MoveData { parentId: NodeId; uci: string }
export interface DeleteBranchData { nodeId: NodeId }
export type ClientMessage =
  | { event: 'navigate'; data: NavigateData }
  | { event: 'move'; data: MoveData }
  | { event: 'deleteBranch'; data: DeleteBranchData };

// HTTP: тренер -> сервер
export type At = number | NodeId;
export interface ReplaceBody {
  pgn?: string;
  fen?: string;
  moves?: string[];
  cursorPly?: number;
  upto?: number;
  orientation?: Orientation;
  title?: string;
  gameId?: string;
  plyOffset?: number;
}
export interface AddLineBody { at: At; moves: string[]; caption?: string }
export interface CursorBody { at: At; arrows?: Arrow[]; caption?: string }
export interface ModeBody { mode: Mode }
