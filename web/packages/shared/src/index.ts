import type { LessonSayData, LessonView } from './lesson.ts';

export type NodeId = string;
export type Author = 'game' | 'coach' | 'student';
export type Mode = 'frozen' | 'free' | 'puzzle' | 'lesson';
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
  /** Задача на доске (режим puzzle) или итог последней задачи. */
  puzzle?: PuzzleSession;
  /** Панель рядом с доской; нет поля - выключена. */
  panel?: PanelSettings;
  /** Номер замены дерева; растёт при PUT /api/board и старте задачи. */
  treeEpoch?: number;
  /** Занятие у доски (режим lesson). */
  lesson?: LessonView;
}

/** stale - ответ на уже обработанное событие занятия. */
export type ErrorCode = 'illegal' | 'frozen' | 'not_found' | 'forbidden' | 'storage' | 'bad_request' | 'stale';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  version: number;
}

// WebSocket: сервер -> браузер
export type ServerMessage =
  | { event: 'state'; data: BoardState }
  | { event: 'error'; data: ErrorPayload }
  | { event: 'analysis'; data: AnalysisData };

// WebSocket: браузер -> сервер
export interface NavigateData { nodeId: NodeId }
export interface MoveData { parentId: NodeId; uci: string }
export interface DeleteBranchData { nodeId: NodeId }
/** Кнопки задачи: «Ещё раз», «Показать решение», «Найти другое». */
export type PuzzleCommand = Record<string, never>;
export type ClientMessage =
  | { event: 'navigate'; data: NavigateData }
  | { event: 'move'; data: MoveData }
  | { event: 'deleteBranch'; data: DeleteBranchData }
  | { event: 'puzzleRetry'; data: PuzzleCommand }
  | { event: 'puzzleGiveUp'; data: PuzzleCommand }
  | { event: 'puzzleAnother'; data: PuzzleCommand }
  | { event: 'lessonSay'; data: LessonSayData }
  | { event: 'lessonRetry'; data: Record<string, never> }
  | { event: 'lessonNext'; data: Record<string, never> };

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

// Задачи (этап 3)
export type PuzzleSource = 'lichess' | 'polgar' | 'raduga' | 'games';
export type SolutionFrom = 'lichess' | 'book' | 'engine';

/** Документ коллекции `puzzles`. `fen` - позиция с ходом решающего, `solution` - UCI: решающий, соперник, решающий, ... */
export interface PuzzleDoc {
  _id: string;
  source: PuzzleSource;
  fen: string;
  solution: string[];
  themes: string[];
  themesRaw?: string[];
  rating?: number;
  ref?: string;
  /** Страница PDF книги. */
  page?: number;
  solutionFrom: SolutionFrom;
  disputed?: boolean;
  /** Только source 'games': партия, полуход ошибки (нумерация review), сыгранный ход UCI, дата партии. */
  gameId?: string;
  ply?: number;
  played?: string;
  gameDate?: string;
}

export type PuzzleStatus = 'solving' | 'solved' | 'failed';
/** move - ждём ход решающего; checking - ход на доске, движок его оценивает; reply - ждём ответ соперника; feedback - после ошибки или хода «слабее» ждём «Ещё раз». */
export type PuzzlePhase = 'move' | 'checking' | 'reply' | 'feedback';
export type FeedbackKind = 'correct' | 'wrong' | 'weaker' | 'repeat' | 'unavailable';
export type PuzzleClassification = 'single' | 'multiple' | 'main+weaker';

export interface PuzzleFeedback {
  kind: FeedbackKind;
  /** Текст плашки: «Верно, продолжайте», описание ошибки, «Хороший ход, но есть сильнее...». */
  text: string;
}

/** Задача на доске. */
export interface PuzzleSession {
  puzzleId: string;
  label: string;
  side: Orientation;
  /** Записанное решение, UCI: решающий, соперник, решающий, ... */
  solution: string[];
  /** Сколько полуходов сыграно от корня по текущему пути. */
  done: number;
  status: PuzzleStatus;
  startedAt: string;
  phase: PuzzlePhase;
  /** Узел, где ходит решающий (или ходил, когда сделал проверяемый ход). */
  node: NodeId;
  /** Ученик идёт по записанному решению; после равноценной альтернативы - false, ожидаемый ход даёт движок. */
  onMain: boolean;
  feedback?: PuzzleFeedback;
  errors: number;
  weaker: number;
  /** Ученик сыграл ход сильнее записанного решения. */
  altBetter: boolean;
  /** Попытка уже записана в историю FSRS. */
  recorded: boolean;
  /** Другие первые ходы, равноценные первому ходу решения или сильнее его (UCI). */
  rootAlternatives: string[];
  /** Первые ходы, которыми задача уже решена в этой сессии. */
  found: string[];
  classification?: PuzzleClassification;
  /** Заход «Найти другое»: в историю не пишется. */
  bonus: boolean;
  /** Ответ соперника, который сервер сыграет в фазе reply (UCI). */
  reply?: string;
  /** Проверяемый (в фазе feedback - последний оценённый) ход ученика; created - узел появился ради этой проверки. */
  checking?: { moveNode: NodeId; created: boolean };
  /** После «Показать решение»: решение в SAN с номерами ходов. */
  answer?: string;
}

export type PuzzleGrade = 'Again' | 'Hard' | 'Good';

export interface PuzzleAttempt {
  at: string;
  correct: boolean;
  ms: number;
  grade: PuzzleGrade;
}

export interface PuzzleNextBody {
  id?: string;
  theme?: string;
  themes?: string[];
  source?: PuzzleSource;
  rating?: number;
}

export interface PuzzleInfo {
  id: string;
  source: PuzzleSource;
  ref?: string;
  page?: number;
  themes: string[];
  rating?: number;
  side: Orientation;
  kind: 'due' | 'new' | 'id';
  label: string;
}

export interface PuzzleNextResponse {
  puzzle: PuzzleInfo;
  state: BoardState;
}

export interface StatsRow {
  key: string;
  attempts: number;
  solved: number;
}

export interface PuzzleStats {
  since: string | null;
  total: { attempts: number; solved: number };
  byTheme: StatsRow[];
  bySource: StatsRow[];
  recent: {
    id: string;
    ref?: string;
    source: PuzzleSource;
    at: string;
    correct: boolean;
    ms: number;
    weaker?: number;
    altBetter?: boolean;
  }[];
  queue: { id: string; ref?: string; due: string; lastCorrect: boolean }[];
  counts: { source: PuzzleSource; puzzles: number; disputed: number }[];
}

export interface ThemeCount {
  theme: string;
  count: number;
}

export interface NoPuzzlePayload extends ErrorPayload {
  available: ThemeCount[];
}

// Панель и очередь (этап 2б)
export interface PanelSettings { eval: boolean; lines: 0 | 1 | 2 | 3; note?: string }
export const PANEL_OFF: PanelSettings = { eval: false, lines: 0 };
export interface PanelBody { eval?: boolean; lines?: number; note?: string | null }
/** Оценка со стороны белых, san с номерами ходов. */
export interface PanelLine { cp?: number; mate?: number; san: string[] }
export type AnalysisStatus = 'pending' | 'ready' | 'unavailable';
export interface AnalysisData { nodeId: NodeId; fen: string; status: AnalysisStatus; lines: PanelLine[]; depth?: number }
export type InboxKind = 'line' | 'delete' | 'puzzle' | 'lesson';
export interface InboxEvent { id: number; at: string; kind: InboxKind; text: string }
export interface InboxResponse { events: InboxEvent[]; more: number; cursor: string }
export interface InboxAckBody { upto: number }

export * from './engine.ts';
export * from './lesson.ts';
export * from './material.ts';
export * from './outcome.ts';
export * from './puzzle.ts';
export * from './validate.ts';
