# Доска, этап 2б: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Очередь действий ученика на доске с командой `coach inbox` и хуком Claude Code, панель с оценкой, линиями движка и заметкой тренера, закрытые хвосты ревью 2а.

**Architecture:** Сервер доски (Nest, `web/packages/server`) пишет события ученика в коллекцию Mongo `inbox` и отдаёт их по `GET /api/inbox`; Python-CLI печатает их, хук `UserPromptSubmit` вызывает CLI. Панель - настройки в документе доски плюс эфемерное сообщение WebSocket `analysis`, которое считает существующий `AnalysisService` через сервис движка. Валидаторы тел запросов - чистые функции в `@board/shared`.

**Tech Stack:** TypeScript 7, Nest, `ws` через `@nestjs/platform-ws`, MongoDB 9 (`mongodb` драйвер, в тестах `mongodb-memory-server`), React + Vite, vitest 5, `chess.js`; Python 3 (`coach`, стандартная библиотека, pytest).

**Spec:** `docs/superpowers/specs/2026-10-15-board-stage2b-design.md`

## Global Constraints

- Коммитов нет: ученик коммитит только по явной просьбе. Шаг «Commit» в задачах заменён на «оставить изменения в рабочем дереве».
- Новых npm- и Python-зависимостей нет. Валидаторы пишутся руками, без `class-validator`.
- `@board/shared` без зависимостей: всё, что требует `chess.js`, живёт в сервере.
- Тексты для ученика и тренера по-русски, ходы в SAN с номерами (`24.Nh6+`, `23...Nf5`), как `sanLine` в `web/packages/server/src/puzzles/puzzle-logic.ts`.
- В тексте документов и строках интерфейса не использовать символ длинного тире, только `-`.
- Оценка на шкале и в линиях панели - со стороны белых (`+1.2`, `−0.4`, `#3`, `#−2`), как на Lichess.
- Разрешённые Origin по умолчанию: `http://127.0.0.1:8765`, `http://localhost:8765`, `http://127.0.0.1:5173`, `http://localhost:5173`; переменная `BOARD_ORIGINS` (через запятую) заменяет список. Подключение без `Origin` разрешено.
- Очередь хранит не больше 500 событий; `GET /api/inbox` отдаёт не больше 50.
- Задержка анализа панели после сдвига курсора 300 мс; линий 0-3, в линии не больше 8 полуходов; заметка до 2000 символов.
- Хук: `uv run --quiet coach inbox --hook`, таймаут хука 10 с, таймаут запроса в `--hook` 2 с.
- Тесты: `cd web && npm test` (все пакеты), `cd web && npm run typecheck`, `uv run pytest`. Тест `raduga.books.spec.ts` медленный (до 600 с) и к этому этапу не относится; при нехватке времени пакет `puzzles` можно гонять отдельно в конце.

## Review Focus

1. Ход ученика при недоступной Mongo-коллекции `inbox` (ошибка записи события) - ход всё равно применяется и рассылается, ошибка только в логе. Тест в задаче 3.
2. Ученик ходит в свободном режиме после «Показать решение» (режим становится `free`) - ходы попадают в очередь как `line`, а итог задачи как `puzzle`, без дублей. Тест в задаче 3.
3. Старый документ доски в Mongo без полей `panel` и `treeEpoch` - сервер стартует, панель выключена, склейка работает. Тест в задаче 4.
4. Панель включена, тренер делает `board load` с `--upto` - в браузер не уходит ни одного `analysis` для новой позиции. Тест в задаче 4.
5. `coach inbox --hook`, когда сервер отвечает ошибкой 500 или мусором - ничего не печатает, код 0. Тест в задаче 6.

---

## Карта файлов

| Файл | Что | Задача |
|---|---|---|
| `web/packages/shared/src/index.ts` | типы панели, анализа, очереди, `treeEpoch` | 1 |
| `web/packages/shared/src/validate.ts` (+ `.spec.ts`) | валидаторы тел запросов | 1 |
| `web/packages/server/src/board/board.controller.ts`, `src/puzzles/puzzles.controller.ts` | применение валидаторов | 2 |
| `web/packages/server/src/board/origin.ts` (+ `.spec.ts`), `board.gateway.ts` | проверка Origin | 2 |
| `web/packages/server/src/tree/tree.ts`, `tree.spec.ts` | обрезка вариантов по `upto` | 2 |
| `docker-compose.yml` | healthcheck `board` | 2 |
| `web/packages/server/src/inbox/*` | очередь: формат, склейка, хранение, сервис, контроллер | 3 |
| `web/packages/server/src/board/board.service.ts` | события ученика, `treeEpoch`, настройки панели | 3, 4 |
| `web/packages/server/src/panel/*` | анализ для панели | 4 |
| `web/packages/client/src/Panel.tsx`, `useBoardSocket.ts`, `App.tsx`, `styles.css` | панель в браузере | 5 |
| `coach/boardclient.py`, `coach/boardcmd.py`, `coach/inboxcmd.py`, `coach/cli.py`, `tests/test_inbox_cli.py`, `tests/test_board_cli.py` | CLI | 6 |
| `.claude/settings.json`, `CLAUDE.md`, `ROADMAP.md`, `SETUP.md` | хук и документы | 7 |

---

### Task 1: Общие типы и валидаторы

**Files:**
- Modify: `web/packages/shared/src/index.ts`
- Create: `web/packages/shared/src/validate.ts`
- Test: `web/packages/shared/src/validate.spec.ts`

**Interfaces:**
- Consumes: существующие `ReplaceBody`, `AddLineBody`, `CursorBody`, `ModeBody`, `PuzzleNextBody`, `PuzzleSource`.
- Produces (экспорт из `@board/shared`):

```ts
export interface PanelSettings { eval: boolean; lines: 0 | 1 | 2 | 3; note?: string }
export const PANEL_OFF: PanelSettings;            // { eval: false, lines: 0 }
// в BoardState добавить: panel?: PanelSettings; treeEpoch?: number;
export interface PanelBody { eval?: boolean; lines?: number; note?: string | null }
export interface PanelLine { cp?: number; mate?: number; san: string[] } // со стороны белых, san с номерами
export type AnalysisStatus = 'pending' | 'ready' | 'unavailable';
export interface AnalysisData { nodeId: NodeId; fen: string; status: AnalysisStatus; lines: PanelLine[] }
// ServerMessage += | { event: 'analysis'; data: AnalysisData }
export type InboxKind = 'line' | 'delete' | 'puzzle';
export interface InboxEvent { id: number; at: string; kind: InboxKind; text: string }
export interface InboxResponse { events: InboxEvent[]; more: number; cursor: string }
export interface InboxAckBody { upto: number }

// validate.ts: каждая функция возвращает null или текст ошибки по-английски, как остальные сообщения сервера
export function validateReplaceBody(b: unknown): string | null;
export function validateAddLineBody(b: unknown): string | null;
export function validateCursorBody(b: unknown): string | null;
export function validateModeBody(b: unknown): string | null;
export function validatePanelBody(b: unknown): string | null;
export function validatePuzzleNextBody(b: unknown): string | null;
export function validateInboxAckBody(b: unknown): string | null;
export const PUZZLE_SOURCES: readonly PuzzleSource[]; // ['lichess', 'polgar', 'raduga']
```

- [ ] **Step 1: Write the failing test**

`web/packages/shared/src/validate.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  validateAddLineBody,
  validateCursorBody,
  validateInboxAckBody,
  validateModeBody,
  validatePanelBody,
  validatePuzzleNextBody,
  validateReplaceBody,
} from './validate';

describe('validateReplaceBody', () => {
  it('accepts pgn, fen with moves, and all optional fields', () => {
    expect(validateReplaceBody({ pgn: '1. e4 *', cursorPly: 3, upto: 5, plyOffset: 0, orientation: 'black', title: 't', gameId: 'g' })).toBeNull();
    expect(validateReplaceBody({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['Kb1'] })).toBeNull();
    expect(validateReplaceBody({ moves: ['e4'] })).toBeNull();
  });
  it('rejects bad fields', () => {
    expect(validateReplaceBody(null)).toMatch(/object/);
    expect(validateReplaceBody({ pgn: '1. e4 *', fen: 'x' })).toMatch(/pgn or fen/);
    expect(validateReplaceBody({ pgn: 5 })).toMatch(/pgn/);
    expect(validateReplaceBody({ moves: 'e4' })).toMatch(/moves/);
    expect(validateReplaceBody({ moves: [1] })).toMatch(/moves/);
    expect(validateReplaceBody({ pgn: 'x', upto: 0 })).toMatch(/upto/);
    expect(validateReplaceBody({ pgn: 'x', cursorPly: 1.5 })).toMatch(/cursorPly/);
    expect(validateReplaceBody({ pgn: 'x', plyOffset: -1 })).toMatch(/plyOffset/);
    expect(validateReplaceBody({ pgn: 'x', orientation: 'up' })).toMatch(/orientation/);
    expect(validateReplaceBody({ pgn: 'x', title: 'a'.repeat(201) })).toMatch(/title/);
  });
});

describe('validateAddLineBody and validateCursorBody', () => {
  it('accepts ply numbers and node ids', () => {
    expect(validateAddLineBody({ at: 0, moves: ['e4'], caption: 'c' })).toBeNull();
    expect(validateAddLineBody({ at: 'n17', moves: ['e4'] })).toBeNull();
    expect(validateCursorBody({ at: 4, arrows: [{ from: 'e2', to: 'e4', color: 'green' }], caption: 'x' })).toBeNull();
  });
  it('rejects bad at, moves, arrows and captions', () => {
    expect(validateAddLineBody({ at: -1, moves: ['e4'] })).toMatch(/at/);
    expect(validateAddLineBody({ at: '', moves: ['e4'] })).toMatch(/at/);
    expect(validateAddLineBody({ at: 1, moves: [] })).toMatch(/moves/);
    expect(validateAddLineBody({ at: 1, moves: ['e4'], caption: 'a'.repeat(501) })).toMatch(/caption/);
    expect(validateCursorBody({ at: 1, arrows: 'e2e4' })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: [{ from: 'e9', to: 'e4', color: 'green' }] })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: [{ from: 'e2', to: 'e4', color: 'pink' }] })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: Array(21).fill({ from: 'e2', to: 'e4', color: 'red' }) })).toMatch(/arrows/);
  });
});

describe('validateModeBody, validatePanelBody, validatePuzzleNextBody, validateInboxAckBody', () => {
  it('mode is frozen or free', () => {
    expect(validateModeBody({ mode: 'free' })).toBeNull();
    expect(validateModeBody({ mode: 'frozen' })).toBeNull();
    expect(validateModeBody({ mode: 'puzzle' })).toMatch(/mode/);
  });
  it('panel needs at least one valid field', () => {
    expect(validatePanelBody({ eval: true })).toBeNull();
    expect(validatePanelBody({ lines: 3 })).toBeNull();
    expect(validatePanelBody({ note: null })).toBeNull();
    expect(validatePanelBody({ note: 'план: f4-f5' })).toBeNull();
    expect(validatePanelBody({})).toMatch(/at least one/);
    expect(validatePanelBody({ eval: 'on' })).toMatch(/eval/);
    expect(validatePanelBody({ lines: 4 })).toMatch(/lines/);
    expect(validatePanelBody({ note: 'a'.repeat(2001) })).toMatch(/note/);
  });
  it('puzzle next fields', () => {
    expect(validatePuzzleNextBody({})).toBeNull();
    expect(validatePuzzleNextBody({ id: 'polgar:0001', theme: 'fork', themes: ['pin'], source: 'raduga', rating: 1500 })).toBeNull();
    expect(validatePuzzleNextBody({ source: 'chesscom' })).toMatch(/source/);
    expect(validatePuzzleNextBody({ themes: 'fork' })).toMatch(/themes/);
    expect(validatePuzzleNextBody({ rating: '1500' })).toMatch(/rating/);
  });
  it('inbox ack upto', () => {
    expect(validateInboxAckBody({ upto: 0 })).toBeNull();
    expect(validateInboxAckBody({ upto: -1 })).toMatch(/upto/);
    expect(validateInboxAckBody({})).toMatch(/upto/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run packages/shared/src/validate.spec.ts`
Expected: FAIL, модуль `./validate` не найден.

- [ ] **Step 3: Write the types and validators**

В `web/packages/shared/src/index.ts`:
- добавить в `BoardState` поля `panel?: PanelSettings;` (комментарий: «Панель рядом с доской; нет поля - выключена») и `treeEpoch?: number;` (комментарий: «Номер замены дерева; растёт при PUT /api/board и старте задачи»);
- добавить в `ServerMessage` вариант `| { event: 'analysis'; data: AnalysisData }`;
- добавить блок `// Панель и очередь (этап 2б)` с интерфейсами из раздела Interfaces и `export const PANEL_OFF: PanelSettings = { eval: false, lines: 0 };`;
- в конце файла `export * from './validate';` (рядом с существующими реэкспортами, если они есть; иначе новой строкой).

`web/packages/shared/src/validate.ts`:

```ts
import type { PuzzleSource } from './index';

/** Валидаторы тел HTTP-запросов: null - тело годится, строка - что не так. Лишние поля не проверяются. */
export const PUZZLE_SOURCES: readonly PuzzleSource[] = ['lichess', 'polgar', 'raduga'];
const SQUARE = /^[a-h][1-8]$/;
const COLORS = ['green', 'red', 'blue'];

type Obj = Record<string, unknown>;
const isObj = (b: unknown): b is Obj => typeof b === 'object' && b !== null && !Array.isArray(b);
const isInt = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const isStrArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function first(...checks: (string | null | false)[]): string | null {
  for (const c of checks) if (c) return c;
  return null;
}
const opt = (b: Obj, key: string, ok: (v: unknown) => boolean, what: string) =>
  b[key] !== undefined && !ok(b[key]) ? `${key} must be ${what}` : null;

function validateAt(b: Obj): string | null {
  const at = b.at;
  if (isInt(at, 0) || (typeof at === 'string' && at.length > 0 && at.length <= 50)) return null;
  return 'at must be a ply number >= 0 or a node id';
}

export function validateReplaceBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    b.pgn !== undefined && b.fen !== undefined && 'give pgn or fen, not both',
    opt(b, 'pgn', (v) => typeof v === 'string', 'a string'),
    opt(b, 'fen', (v) => typeof v === 'string', 'a string'),
    opt(b, 'moves', isStrArray, 'an array of strings'),
    opt(b, 'cursorPly', (v) => isInt(v, 1), 'an integer >= 1'),
    opt(b, 'upto', (v) => isInt(v, 1), 'an integer >= 1'),
    opt(b, 'plyOffset', (v) => isInt(v, 0), 'an integer >= 0'),
    opt(b, 'orientation', (v) => v === 'white' || v === 'black', '"white" or "black"'),
    opt(b, 'title', (v) => isStr(v, 200), 'a string up to 200 characters'),
    opt(b, 'gameId', (v) => isStr(v, 200), 'a string up to 200 characters'),
  );
}

export function validateAddLineBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    validateAt(b),
    !(isStrArray(b.moves) && (b.moves as string[]).length > 0) && 'moves must be a non-empty array of strings',
    opt(b, 'caption', (v) => isStr(v, 500), 'a string up to 500 characters'),
  );
}

const isArrow = (a: unknown) =>
  isObj(a) && typeof a.from === 'string' && SQUARE.test(a.from) && typeof a.to === 'string' && SQUARE.test(a.to) && COLORS.includes(a.color as string);

export function validateCursorBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    validateAt(b),
    opt(b, 'arrows', (v) => Array.isArray(v) && v.length <= 20 && v.every(isArrow), 'up to 20 arrows {from, to: a1..h8, color: green|red|blue}'),
    opt(b, 'caption', (v) => isStr(v, 500), 'a string up to 500 characters'),
  );
}

export function validateModeBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return b.mode === 'frozen' || b.mode === 'free' ? null : 'mode must be "frozen" or "free"';
}

export function validatePanelBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  if (b.eval === undefined && b.lines === undefined && b.note === undefined) return 'give at least one of eval, lines, note';
  return first(
    opt(b, 'eval', (v) => typeof v === 'boolean', 'true or false'),
    opt(b, 'lines', (v) => isInt(v, 0) && (v as number) <= 3, 'an integer 0..3'),
    opt(b, 'note', (v) => v === null || isStr(v, 2000), 'a string up to 2000 characters or null'),
  );
}

export function validatePuzzleNextBody(b: unknown): string | null {
  if (b === undefined || b === null) return null;
  if (!isObj(b)) return 'body must be a JSON object';
  return first(
    opt(b, 'id', (v) => isStr(v, 200), 'a string'),
    opt(b, 'theme', (v) => isStr(v, 100), 'a string'),
    opt(b, 'themes', isStrArray, 'an array of strings'),
    opt(b, 'source', (v) => PUZZLE_SOURCES.includes(v as PuzzleSource), PUZZLE_SOURCES.join(' | ')),
    opt(b, 'rating', (v) => isInt(v, 0), 'an integer'),
  );
}

export function validateInboxAckBody(b: unknown): string | null {
  if (!isObj(b)) return 'body must be a JSON object';
  return isInt(b.upto, 0) ? null : 'upto must be an integer >= 0';
}
```

Если `index.ts` импортирует из `validate.ts`, а `validate.ts` - тип из `index.ts`, это циклический импорт только типов (`import type`) - он безопасен.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd web && npx vitest run packages/shared && npm run typecheck`
Expected: PASS; typecheck без ошибок (новые необязательные поля `BoardState` не ломают клиент и сервер). Если typecheck клиента ругается на `ServerMessage` в `useBoardSocket.ts` (ветка `else` теперь получает и `analysis`), в этой задаче поправить только тип: в ветке `else` проверять `msg.event === 'error'`. Поведение панели - задача 5.

- [ ] **Step 5: Leave changes in the working tree** (без коммита).

---

### Task 2: Хвосты ревью 2а: проверка тел, Origin, обрезка вариантов, healthcheck

**Files:**
- Modify: `web/packages/server/src/board/board.controller.ts`, `web/packages/server/src/puzzles/puzzles.controller.ts`
- Create: `web/packages/server/src/board/validated.ts`, `web/packages/server/src/board/origin.ts`, `web/packages/server/src/board/origin.spec.ts`
- Modify: `web/packages/server/src/board/board.gateway.ts`
- Modify: `web/packages/server/src/tree/tree.ts:235-246`, `web/packages/server/src/tree/tree.spec.ts`
- Modify: `docker-compose.yml` (сервис `board`)
- Test: `web/packages/server/test/http.e2e.spec.ts`, `web/packages/server/test/ws.e2e.spec.ts`

**Interfaces:**
- Consumes: валидаторы из Task 1; `BoardError('bad_request', msg)` из `src/board/board-error.ts`.
- Produces:

```ts
// src/board/validated.ts
export function validated<T>(body: unknown, check: (b: unknown) => string | null): T; // бросает BoardError('bad_request', msg)
// src/board/origin.ts
export const DEFAULT_ORIGINS: string[];
export function allowedOrigins(env?: string): string[];            // env = process.env.BOARD_ORIGINS
export function originAllowed(origin: string | undefined, allowed: string[]): boolean;
```

- [ ] **Step 1: Write the failing tests**

`src/board/origin.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, allowedOrigins, originAllowed } from './origin';

describe('origin check', () => {
  it('defaults to the board and the Vite dev server on both hostnames', () => {
    expect(allowedOrigins(undefined)).toEqual(DEFAULT_ORIGINS);
    expect(DEFAULT_ORIGINS).toEqual(['http://127.0.0.1:8765', 'http://localhost:8765', 'http://127.0.0.1:5173', 'http://localhost:5173']);
  });
  it('BOARD_ORIGINS replaces the list, trims and drops empties', () => {
    expect(allowedOrigins(' http://a:1 ,,http://b:2 ')).toEqual(['http://a:1', 'http://b:2']);
  });
  it('allows a missing origin and listed origins, rejects others', () => {
    expect(originAllowed(undefined, DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://localhost:8765', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://evil.example', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('null', DEFAULT_ORIGINS)).toBe(false);
  });
});
```

В `src/tree/tree.spec.ts` добавить:

```ts
it('fromGame with upto cuts variations at the same ply as the main line', () => {
  const pgn = '1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 *';
  const tree = fromGame({ pgn }, { upto: 4 });
  const plies = Object.values(tree.nodes).map((n) => n.ply);
  expect(Math.max(...plies)).toBe(3);
  const sans = Object.values(tree.nodes).map((n) => n.san);
  expect(sans).toContain('c5');
  expect(sans).toContain('Nf3');
  expect(sans).not.toContain('d6');
  expect(sans).not.toContain('d4');
});
```

В `test/http.e2e.spec.ts` добавить (в существующий `describe` с `setupBoardApp()`; имя харнесса взять из файла):

```ts
it('rejects malformed bodies with 400 bad_request', async () => {
  const http = board.running.http;
  const bad: [string, string, object][] = [
    ['put', '/api/board', { pgn: 5 }],
    ['put', '/api/board', { pgn: '1. e4 *', orientation: 'up' }],
    ['post', '/api/board/lines', { at: 1, moves: [] }],
    ['patch', '/api/board/cursor', { at: 1, arrows: [{ from: 'z9', to: 'e4', color: 'green' }] }],
    ['patch', '/api/board/mode', { mode: 'puzzle' }],
    ['post', '/api/puzzles/next', { source: 'chesscom' }],
  ];
  for (const [method, path, body] of bad) {
    const res = await (request(http) as any)[method](path).send(body);
    expect(res.status, `${method} ${path}`).toBe(400);
    expect(res.body.code).toBe('bad_request');
  }
});
```

В `test/ws.e2e.spec.ts` добавить:

```ts
import WebSocket from 'ws';

it('rejects a foreign Origin and accepts the board origin and no origin', async () => {
  const url = board.running.wsUrl;
  const status = await new Promise<number>((resolve) => {
    const ws = new WebSocket(url, { headers: { Origin: 'http://evil.example' } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => resolve(101));
  });
  expect(status).toBe(403);
  for (const headers of [{ Origin: 'http://127.0.0.1:8765' }, {}]) {
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('unexpected-response', () => resolve(false));
    });
    expect(opened).toBe(true);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run --root packages/server src/board/origin.spec.ts src/tree/tree.spec.ts test/http.e2e.spec.ts test/ws.e2e.spec.ts`
Expected: FAIL: нет `./origin`; в дереве есть `d6`; неверные тела проходят дальше (например, `pgn: 5` даёт не 400 или 400 по другой причине - тест проверяет только код, поэтому часть случаев может уже проходить, это нормально); чужой Origin получает 101.

- [ ] **Step 3: Implement**

`src/board/validated.ts`:

```ts
import { BoardError } from './board-error';

/** Проверить тело запроса до сервиса: неверное тело - 400 bad_request с текстом валидатора. */
export function validated<T>(body: unknown, check: (b: unknown) => string | null): T {
  const problem = check(body);
  if (problem) throw new BoardError('bad_request', problem);
  return body as T;
}
```

В `board.controller.ts` каждое тело пропустить через `validated`: `replace(@Body() body: unknown)` -> `this.board.replace(validated<ReplaceBody>(body, validateReplaceBody))`, так же `addLine` (`validateAddLineBody`), `cursor` (`validateCursorBody`), `mode` (`validateModeBody`, затем `.mode`). В `puzzles.controller.ts`: `this.puzzles.next(validated<PuzzleNextBody>(body ?? {}, validatePuzzleNextBody))`. Ошибка `BoardError` уже превращается в ответ фильтром `BoardErrorFilter`, который висит на обоих контроллерах.

`src/board/origin.ts`:

```ts
/** Какие страницы могут подключаться к /ws. Без Origin подключаются не браузеры (тесты, скрипты), сервер слушает только 127.0.0.1. */
export const DEFAULT_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765', 'http://127.0.0.1:5173', 'http://localhost:5173'];

export function allowedOrigins(env: string | undefined = process.env.BOARD_ORIGINS): string[] {
  if (!env) return DEFAULT_ORIGINS;
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}
```

В `board.gateway.ts` декоратор:

```ts
@WebSocketGateway({
  path: '/ws',
  // Рукопожатие с чужой страницы отклоняется до подключения (403).
  verifyClient: (info: { origin?: string }, done: (ok: boolean, code?: number, message?: string) => void) =>
    originAllowed(info.origin || undefined, allowedOrigins()) ? done(true) : done(false, 403, 'Forbidden origin'),
})
```

`@nestjs/platform-ws` передаёт опции шлюза в `ws.WebSocketServer`, а `ws` вызывает `verifyClient` при `handleUpgrade`. Если e2e-тест покажет, что опция не доходит (внешняя библиотека могла измениться), проверить исходник `node_modules/@nestjs/platform-ws/adapters/ws-adapter.js` и при необходимости проверять Origin в `handleConnection(client, req)`: `client.close(1008)` для чужого Origin; тогда тест ждать закрытия с кодом 1008 вместо 403 и записать это отклонение в отчёт.

В `tree.ts` `addParsedLine` передавать `upto` в рекурсию для вариантов:

```ts
for (const variation of mv.variations) {
  addParsedLine(tree, parentNode.id, variation, 'coach', upto);
}
```

Проверка в начале цикла (`parentNode.ply + 1 >= upto`) уже обрезает вариант на нужном полуходе. Обновить комментарий к `FromGameOptions.upto`: «Обрезать партию и её варианты: ...».

`docker-compose.yml`, сервис `board`, добавить:

```yaml
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8765/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run --root packages/server && npm run typecheck`
Expected: все тесты сервера PASS, typecheck чистый. Затем `docker compose config -q` (из корня репозитория) - без ошибок.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 3: Очередь событий ученика

**Files:**
- Create: `web/packages/server/src/inbox/inbox-format.ts`, `inbox-format.spec.ts`, `inbox-repository.ts`, `inbox.service.ts`, `inbox.controller.ts`
- Modify: `web/packages/server/src/board/board.service.ts`, `web/packages/server/src/app.module.ts`
- Modify: `web/packages/server/test/helpers.ts` (чистить коллекцию `inbox` в `beforeEach`)
- Test: `web/packages/server/test/inbox.e2e.spec.ts`

**Interfaces:**
- Consumes: `BoardState`, `BoardNode`, `Tree`, `InboxEvent`, `InboxResponse`, `InboxAckBody`, `validateInboxAckBody` (Task 1); `validated` (Task 2); `treeOf` из `src/puzzles/puzzle-flow.ts`; `pathTo` из `src/tree/tree.ts`.
- Produces:

```ts
// inbox-format.ts (чистые функции)
export interface StoredEvent {           // документ коллекции inbox
  _id: number; at: Date; kind: InboxKind; treeEpoch: number; read: boolean; text: string;
  fromNode?: NodeId; nodes?: NodeId[]; moves?: string[];          // line
  node?: NodeId; san?: string; plies?: number;                    // delete
  puzzleId?: string; label?: string; result?: PuzzleOutcome; banner?: string; // puzzle
}
export type PuzzleOutcome = 'wrong' | 'weaker' | 'solved' | 'gaveUp';
export type Draft = Omit<StoredEvent, '_id' | 'at' | 'read' | 'text'>;  // text собирает eventText
export function moveToken(parentFen: string, san: string, force: boolean): string; // "24.Nh6+" | "23...Nf5" | "Kh8"
export function nodeLabel(tree: Tree, node: BoardNode): string;   // "23...Nf5" или "начальной позиции" для корня
export function lineDraft(s: BoardState, node: BoardNode): Draft; // новая ветка из одного хода
export function appendToLine(last: StoredEvent, s: BoardState, node: BoardNode): StoredEvent | null; // null - склеить нельзя
export function deleteDraft(s: BoardState, nodeId: NodeId): Draft;  // s - состояние ДО удаления
export function puzzleDraft(prev: BoardState, next: BoardState): Draft | null; // итог задачи по разнице состояний
export function eventText(e: Draft): string;
export function cursorLine(s: BoardState): string;
// inbox-repository.ts
export class InboxRepository { last(): Promise<StoredEvent | null>; insert(e: StoredEvent): Promise<void>; replace(e: StoredEvent): Promise<void>;
  unread(limit: number): Promise<{ events: StoredEvent[]; total: number }>; ack(upto: number): Promise<void>; trim(keep: number): Promise<void> }
// inbox.service.ts
export class InboxService {
  recordMove(s: BoardState, nodeId: NodeId): void;           // s - состояние после хода
  recordDelete(before: BoardState, nodeId: NodeId): void;
  recordPuzzle(prev: BoardState, next: BoardState): void;
  read(): Promise<InboxResponse>;
  ack(upto: number): Promise<void>;
  /** Для тестов: дождаться записи всех событий. */
  flush(): Promise<void>;
}
export const INBOX_KEEP = 500; export const INBOX_PAGE = 50;
```

Тексты событий (точные шаблоны):
- `line`: `ветка ученика от ${nodeLabel(from)}: ${moves.join(' ')} (узлы ${first}-${last})`; для одного узла `(узел ${id})`.
- `delete`: `ученик удалил ветку ${moveToken(parentFen, san, true)} (${plies} ${полуход|полухода|полуходов})`.
- `puzzle`: `задача ${puzzleId}: ${итог}` где итог: `ошибка, ход ${san}, «${banner}»` | `ход «слабее»: ${san}, «${banner}»` | `решено` (+ `, ошибок ${errors}` если errors > 0, + ` (второе решение)` в заходе bonus) | `показано решение ${answer}`.
- `cursorLine`: задача решается - `на доске задача ${puzzleId}, решается`; корень - `курсор в начальной позиции, режим ${mode}`; иначе `курсор после ${moveToken(parent.fen, san, true)} (${партия|вариант тренера|ветка ученика}), режим ${mode}`.

- [ ] **Step 1: Write the failing unit tests**

`src/inbox/inbox-format.spec.ts` (использовать `fromGame` и `addMove` из `../tree/tree` для построения состояний):

```ts
import { describe, expect, it } from 'vitest';
import type { BoardState, PuzzleSession } from '@board/shared';
import { addMove, fromGame } from '../tree/tree';
import { appendToLine, cursorLine, deleteDraft, eventText, lineDraft, moveToken, puzzleDraft, type StoredEvent } from './inbox-format';

const state = (moves: string[], extra: Partial<BoardState> = {}): BoardState => ({
  ...fromGame({ moves }),
  version: 1, mode: 'free', orientation: 'white', meta: { plyOffset: 0 }, updatedAt: '', treeEpoch: 3, ...extra,
});
const stored = (d: object): StoredEvent => ({ _id: 1, at: new Date(), read: false, text: '', ...(d as any) });

describe('moveToken', () => {
  it('numbers white moves always and black moves when forced', () => {
    expect(moveToken('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 24', 'Nh6+', false)).toBe('24.Nh6+');
    expect(moveToken('8/8/8/8/8/8/8/K6k b - - 0 23', 'Nf5', true)).toBe('23...Nf5');
    expect(moveToken('8/8/8/8/8/8/8/K6k b - - 0 23', 'Kh8', false)).toBe('Kh8');
  });
});

describe('line events', () => {
  it('starts a branch with the position it grew from and glues the next move', () => {
    const s0 = state(['e4', 'e5']);
    const from = s0.cursor;
    const a = addMove(fromGame({ moves: ['e4', 'e5'] }), from, 'Nf3', 'student');
    const s1 = { ...s0, ...a.tree, cursor: a.node.id };
    const d = lineDraft(s1, a.node);
    expect(d).toMatchObject({ kind: 'line', fromNode: from, nodes: [a.node.id], moves: ['2.Nf3'], treeEpoch: 3 });
    expect(eventText(d)).toBe(`ветка ученика от 1...e5: 2.Nf3 (узел ${a.node.id})`);
    const b = addMove(a.tree, a.node.id, 'Nc6', 'student');
    const s2 = { ...s1, ...b.tree, cursor: b.node.id };
    const glued = appendToLine(stored(d), s2, b.node)!;
    expect(glued.moves).toEqual(['2.Nf3', 'Nc6']);
    expect(glued.text).toBe(`ветка ученика от 1...e5: 2.Nf3 Nc6 (узлы ${a.node.id}-${b.node.id})`);
  });
  it('does not glue after a read event, another tree, or a move from elsewhere', () => {
    const s0 = state(['e4']);
    const a = addMove(fromGame({ moves: ['e4'] }), s0.cursor, 'e5', 'student');
    const s1 = { ...s0, ...a.tree };
    const d = stored(lineDraft(s1, a.node));
    const b = addMove(a.tree, a.node.id, 'Nf3', 'student');
    const s2 = { ...s1, ...b.tree };
    expect(appendToLine({ ...d, read: true }, s2, b.node)).toBeNull();
    expect(appendToLine({ ...d, treeEpoch: 2 }, s2, b.node)).toBeNull();
    const c = addMove(b.tree, s0.cursor, 'c5', 'student');
    expect(appendToLine(d, { ...s2, ...c.tree }, c.node)).toBeNull();
  });
  it('a branch from the root says so', () => {
    const s0 = state([]);
    const a = addMove(fromGame({}), s0.rootId, 'd4', 'student');
    expect(eventText(lineDraft({ ...s0, ...a.tree }, a.node))).toBe(`ветка ученика от начальной позиции: 1.d4 (узел ${a.node.id})`);
  });
});

describe('delete events', () => {
  it('names the first move and counts plies with the right word form', () => {
    const s0 = state(['e4']);
    let t = addMove(fromGame({ moves: ['e4'] }), s0.cursor, 'c5', 'student');
    const first = t.node.id;
    t = addMove(t.tree, first, 'Nf3', 'student');
    const s = { ...s0, ...t.tree };
    expect(eventText(deleteDraft(s, first))).toBe('ученик удалил ветку 1...c5 (2 полухода)');
  });
});

describe('puzzle events', () => {
  const pz = (over: Partial<PuzzleSession>): PuzzleSession => ({
    puzzleId: 'polgar:0310', label: 'Полгар №310', side: 'white', solution: ['h3h2'], done: 0, status: 'solving',
    startedAt: '', phase: 'move', node: 'n1', onMain: true, errors: 0, weaker: 0, altBetter: false, recorded: false,
    rootAlternatives: [], found: [], bonus: false, ...over,
  });
  it('reports a wrong move with its SAN and banner', () => {
    const s = state(['e4']);
    const prev = { ...s, mode: 'puzzle' as const, puzzle: pz({ phase: 'checking', checking: { moveNode: s.cursor, created: true } }) };
    const next = { ...prev, puzzle: pz({ phase: 'feedback', errors: 1, checking: { moveNode: s.cursor, created: true }, feedback: { kind: 'wrong', text: 'Мат упущен.' } }) };
    expect(eventText(puzzleDraft(prev, next)!)).toBe('задача polgar:0310: ошибка, ход 1.e4, «Мат упущен.»');
  });
  it('reports weaker, solved with errors, and shown solution; nothing for a correct step', () => {
    const s = state(['e4']);
    const base = { ...s, mode: 'puzzle' as const };
    const checking = { moveNode: s.cursor, created: true };
    const weaker = puzzleDraft({ ...base, puzzle: pz({ phase: 'checking', checking }) },
      { ...base, puzzle: pz({ phase: 'feedback', weaker: 1, checking, feedback: { kind: 'weaker', text: 'Хороший ход, но есть сильнее.' } }) });
    expect(eventText(weaker!)).toBe('задача polgar:0310: ход «слабее»: 1.e4, «Хороший ход, но есть сильнее.»');
    const solved = puzzleDraft({ ...base, puzzle: pz({ errors: 1 }) }, { ...base, mode: 'free', puzzle: pz({ status: 'solved', errors: 1 }) });
    expect(eventText(solved!)).toBe('задача polgar:0310: решено, ошибок 1');
    const shown = puzzleDraft({ ...base, puzzle: pz({}) }, { ...base, mode: 'free', puzzle: pz({ status: 'failed', answer: '1.Rh2#' }) });
    expect(eventText(shown!)).toBe('задача polgar:0310: показано решение 1.Rh2#');
    expect(puzzleDraft({ ...base, puzzle: pz({ phase: 'checking', checking }) }, { ...base, puzzle: pz({ phase: 'reply', feedback: { kind: 'correct', text: 'Верно, продолжайте' } }) })).toBeNull();
  });
});

describe('cursorLine', () => {
  it('describes the cursor node author and mode, the root, and a puzzle', () => {
    const s = state(['e4', 'e5']);
    expect(cursorLine(s)).toBe('курсор после 1...e5 (партия), режим free');
    expect(cursorLine({ ...s, cursor: s.rootId })).toBe('курсор в начальной позиции, режим free');
    expect(cursorLine({ ...s, mode: 'puzzle', puzzle: { puzzleId: 'polgar:0310', status: 'solving' } as PuzzleSession })).toBe('на доске задача polgar:0310, решается');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run --root packages/server src/inbox`
Expected: FAIL, нет `./inbox-format`.

- [ ] **Step 3: Implement `inbox-format.ts`**

Ключевые места (остальное по шаблонам из Interfaces):

```ts
const AUTHOR: Record<Author, string> = { game: 'партия', coach: 'вариант тренера', student: 'ветка ученика' };

export function moveToken(parentFen: string, san: string, force: boolean): string {
  const [, turn, , , , full] = parentFen.split(' ');
  if (turn === 'w') return `${full}.${san}`;
  return force ? `${full}...${san}` : san;
}

export function nodeLabel(tree: Tree, node: BoardNode): string {
  if (node.parent === null) return 'начальной позиции';
  return moveToken(tree.nodes[node.parent].fen, node.san!, true);
}

function plural(n: number): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return 'полуход';
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'полухода';
  return 'полуходов';
}

export function appendToLine(last: StoredEvent, s: BoardState, node: BoardNode): StoredEvent | null {
  if (last.kind !== 'line' || last.read || last.treeEpoch !== (s.treeEpoch ?? 0)) return null;
  if (!last.nodes?.length || node.parent !== last.nodes.at(-1)) return null;
  const moves = [...last.moves!, moveToken(s.nodes[node.parent!].fen, node.san!, false)];
  const next = { ...last, nodes: [...last.nodes, node.id], moves };
  return { ...next, text: eventText(next) };
}
```

`puzzleDraft(prev, next)`: вернуть `null`, если у `next` нет `puzzle` или `puzzleId` у `prev` и `next` разный (новая задача). Иначе по порядку:
1. `next.puzzle.answer` есть, а у `prev.puzzle` нет - `gaveUp`.
2. `prev.puzzle.status === 'solving'` и `next.puzzle.status === 'solved'` - `solved` (запомнить `errors`, `bonus`).
3. `next.puzzle.phase === 'feedback'` и `next.puzzle.feedback?.kind` - `wrong` или `weaker`, а у `prev` фаза не `feedback` - событие с `san` узла `next.puzzle.checking.moveNode` (через `moveToken(parent.fen, san, true)`) и `banner = feedback.text`.
4. Иначе `null`.

Поля для текста храни в `Draft`: `puzzleId`, `label`, `result`, `san`, `banner`, плюс `errors?: number`, `bonus?: boolean`, `answer?: string` (добавить их в `StoredEvent`).

- [ ] **Step 4: Run unit tests**

Run: `cd web && npx vitest run --root packages/server src/inbox`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e test**

`test/inbox.e2e.spec.ts` (по образцу `ws.e2e.spec.ts` и `puzzle-actions.e2e.spec.ts`; в `helpers.ts` добавить `await client.db().collection('inbox').deleteMany({});` в `beforeEach`):

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupBoardApp, startPuzzle, withDb } from './helpers';
import { WsProbe } from './ws-probe';
// фикстура задачи - из ./puzzle-fixtures (взять ту, что используют puzzle-actions тесты)

describe('inbox', () => {
  const board = setupBoardApp();
  const inbox = async () => (await request(board.running.http).get('/api/inbox').expect(200)).body;

  it('glues consecutive student moves, ack clears them, coach actions are not recorded', async () => {
    const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    const s1 = await ws.until((x) => x.version > s.version);
    ws.send('move', { parentId: s1.cursor, uci: 'b8c6' });
    await ws.until((x) => x.version > s1.version);
    const body = await inbox();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].text).toMatch(/^ветка ученика от 1\.\.\.e5: 2\.Nf3 Nc6 \(узлы n\d+-n\d+\)$/);
    expect(body.cursor).toBe('курсор после 2...Nc6 (ветка ученика), режим free');
    await request(board.running.http).post('/api/inbox/ack').send({ upto: body.events[0].id }).expect(200);
    expect((await inbox()).events).toEqual([]);
    await request(board.running.http).post('/api/board/lines').send({ at: 2, moves: ['c5'] }).expect(200);
    expect((await inbox()).events).toEqual([]);
    ws.close();
  });

  it('a new tree starts a new event and a student delete is recorded', async () => {
    // ход ученика, PUT /api/board (новое дерево), ход ученика -> два события line;
    // затем deleteBranch своей ветки -> событие delete с текстом «ученик удалил ветку ...»
  });

  it('records puzzle outcomes and moves after «Показать решение» without duplicates', async () => {
    // startPuzzle(board, FIXTURE); неверный ход (по сценарию из puzzle-actions.e2e.spec.ts) -> событие «ошибка»;
    // puzzleGiveUp -> «показано решение ...»; затем ход в режиме free -> одно событие line; итого 3 события.
  });

  it('a failing inbox write does not break the move', async () => {
    // InboxRepository.insert подменить через vi.spyOn(board.running.app.get(InboxRepository), 'insert').mockRejectedValue(new Error('down'));
    // ход ученика доходит до всех вкладок (ws.until), console.error вызван с текстом про inbox.
  });

  it('keeps at most 500 events and returns 50 with a count of the rest', async () => {
    // засеять 520 событий через withDb((db) => db.collection('inbox').insertMany(...)) с _id 1..520, read false;
    // сделать один ход ученика -> в коллекции 500 документов; GET отдаёт 50 событий, more = 450 + ...
    // (точное число: всего непрочитанных после trim минус 50)
  });
});
```

Тела помеченных комментариями тестов дописать полностью по образцу первого теста: те же `WsProbe`, `request`, `withDb`. Ход ошибки в задаче брать из `puzzle-actions.e2e.spec.ts` (там есть фикстура и сценарий неверного хода с поддельным движком).

- [ ] **Step 6: Run to verify failure**

Run: `cd web && npx vitest run --root packages/server test/inbox.e2e.spec.ts`
Expected: FAIL (404 на `/api/inbox`).

- [ ] **Step 7: Implement repository, service, controller, wiring**

`inbox-repository.ts`: класс `@Injectable() InboxRepository implements OnApplicationShutdown` со своим `MongoClient` (как `MongoBoardRepository`: `MONGO_URL`, `serverSelectionTimeoutMS: 3000`, `ignoreUndefined: true`), коллекция `inbox`. `last()` - `findOne({}, { sort: { _id: -1 } })`; `unread(limit)` - `find({ read: false }).sort({ _id: 1 }).limit(limit)` и `countDocuments({ read: false })`; `ack(upto)` - `updateMany({ _id: { $lte: upto }, read: false }, { $set: { read: true } })`; `trim(keep)` - найти `_id` документа номер `keep` с конца и удалить всё меньше.

`inbox.service.ts`:

```ts
@Injectable()
export class InboxService {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly repo: InboxRepository, @Inject(forwardRef(() => BoardService)) private readonly board: BoardService) {}

  recordMove(s: BoardState, nodeId: NodeId): void {
    this.enqueue(async () => {
      const node = s.nodes[nodeId];
      const last = await this.repo.last();
      const glued = last ? appendToLine(last, s, node) : null;
      if (glued) return this.repo.replace(glued);
      await this.insert(lineDraft(s, node), last);
    });
  }
  // recordDelete, recordPuzzle - так же через enqueue и insert
  private async insert(d: Draft, last: StoredEvent | null): Promise<void> {
    await this.repo.insert({ ...d, _id: (last?._id ?? 0) + 1, at: new Date(), read: false, text: eventText(d) });
    await this.repo.trim(INBOX_KEEP);
  }
  private enqueue(job: () => Promise<unknown>): void {
    this.chain = this.chain.then(job).catch((e: unknown) =>
      console.error(`board: inbox write failed: ${e instanceof Error ? e.message : String(e)}`));
  }
  flush(): Promise<void> { return this.chain.then(() => undefined); }
  async read(): Promise<InboxResponse> {
    await this.flush();
    const { events, total } = await this.repo.unread(INBOX_PAGE);
    return { events: events.map((e) => ({ id: e._id, at: e.at.toISOString(), kind: e.kind, text: e.text })),
             more: total - events.length, cursor: cursorLine(this.board.current) };
  }
  async ack(upto: number): Promise<void> { await this.flush(); await this.repo.ack(upto); }
}
```

`recordDelete` и `recordPuzzle` в `insert` берут `last` через `this.repo.last()` внутри задания очереди. Если `InboxService` зависит от `BoardService`, а `BoardService` от `InboxService`, использовать `forwardRef` с обеих сторон; альтернатива без цикла - `read()` принимает `BoardState` от контроллера, который сам инжектит `BoardService`. Предпочесть вариант без цикла: `read(current: BoardState)`.

`inbox.controller.ts`: `@Controller('api/inbox') @UseFilters(BoardErrorFilter)`; `@Get() read()`; `@Post('ack') @HttpCode(200) ack(@Body() body: unknown)` с `validated<InboxAckBody>(body, validateInboxAckBody)`, ответ `{ ok: true }`.

`board.service.ts`:
- в конструктор добавить `private readonly inbox: InboxService`;
- `studentMove`: в ветке свободного режима после `mutate` (в `.then`) вызвать `this.inbox.recordMove(state, state.cursor)`; ветку задачи не трогать: её итоги ловит `step`;
- `step`: запомнить `const prev = this.state` перед `mutate`; в `.then` вызвать `this.inbox.recordPuzzle(prev, state)`. Вердикт движка (`applyVerdict`) тоже идёт через `step`, поэтому ошибка и «слабее» попадут сюда;
- `studentDelete`: запомнить состояние до удаления (`const before = this.state` внутри `mutate`-функции, где `s` - текущее), после успешного `mutate` вызвать `this.inbox.recordDelete(before, nodeId)`;
- `replace` и `startPuzzle` (через обёртку над `startSession`): `treeEpoch: (s.treeEpoch ?? 0) + 1`;
- `recordX` не бросают: ошибки ловит `enqueue`.

`app.module.ts`: `InboxController` в `controllers`, `InboxRepository` и `InboxService` в `providers`.

- [ ] **Step 8: Run tests**

Run: `cd web && npx vitest run --root packages/server && npm run typecheck`
Expected: все PASS, включая старые e2e задач (событие задачи пишется асинхронно и их не задерживает).

- [ ] **Step 9: Leave changes in the working tree.**

---

### Task 4: Панель на сервере

**Files:**
- Create: `web/packages/server/src/panel/panel-line.ts`, `panel-line.spec.ts`, `panel.service.ts`
- Modify: `web/packages/server/src/board/board.service.ts`, `board.controller.ts`, `board.gateway.ts`, `web/packages/server/src/app.module.ts`
- Modify: `web/packages/server/test/fake-engine.ts` (если нужно задавать линии и задержку для произвольного FEN)
- Test: `web/packages/server/test/panel.e2e.spec.ts`

**Interfaces:**
- Consumes: `AnalysisService.analyse(fen, { multipv })` из `src/engine/analysis.service.ts`; `EngineLine` (оценка со стороны ходящего); `PanelSettings`, `PANEL_OFF`, `PanelBody`, `AnalysisData`, `validatePanelBody`.
- Produces:

```ts
// panel-line.ts
export const PANEL_PLIES = 8;
export function toPanelLine(fen: string, line: EngineLine): PanelLine; // SAN с номерами, не длиннее 8 полуходов, cp/mate со стороны белых
// board.service.ts
setPanel(body: PanelBody): Promise<BoardState>;   // note: null -> поле удаляется
export function panelOf(s: BoardState): PanelSettings; // s.panel ?? PANEL_OFF (экспорт из panel.service.ts)
// panel.service.ts
export const PANEL_DELAY_MS = 300;
export class PanelService { readonly analysis: Subject<AnalysisData>; latest(): AnalysisData | null; }
```

- [ ] **Step 1: Write the failing unit test**

`src/panel/panel-line.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toPanelLine } from './panel-line';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('toPanelLine', () => {
  it('numbers moves and keeps white-side eval when white moves', () => {
    expect(toPanelLine(START, { move: 'e2e4', cp: 30, pv: ['e2e4', 'e7e5', 'g1f3'] })).toEqual({ cp: 30, san: ['1.e4', 'e5', '2.Nf3'] });
  });
  it('flips eval and mate to white side when black moves, starts with N...', () => {
    expect(toPanelLine(AFTER_E4, { move: 'c7c5', cp: 40, pv: ['c7c5'] })).toEqual({ cp: -40, san: ['1...c5'] });
    expect(toPanelLine(AFTER_E4, { move: 'c7c5', mate: 3, pv: ['c7c5'] })).toEqual({ mate: -3, san: ['1...c5'] });
  });
  it('cuts to 8 plies and stops at an illegal move', () => {
    const pv = ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'c3b1'];
    expect(toPanelLine(START, { move: 'g1f3', cp: 0, pv }).san).toHaveLength(8);
    expect(toPanelLine(START, { move: 'g1f3', cp: 0, pv: ['g1f3', 'e2e5'] }).san).toEqual(['1.Nf3']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run --root packages/server src/panel`
Expected: FAIL, нет модуля.

- [ ] **Step 3: Implement `panel-line.ts`**

```ts
import { Chess } from 'chess.js';
import type { EngineLine, PanelLine } from '@board/shared';

export const PANEL_PLIES = 8;

/** Линия движка для панели: SAN с номерами, оценка со стороны белых. Нелегальный ход обрывает линию. */
export function toPanelLine(fen: string, line: EngineLine): PanelLine {
  const chess = new Chess(fen);
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const san: string[] = [];
  for (const uci of line.pv.slice(0, PANEL_PLIES)) {
    const [, turn, , , , full] = chess.fen().split(' ');
    let played;
    try {
      played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    san.push(turn === 'w' ? `${full}.${played.san}` : san.length === 0 ? `${full}...${played.san}` : played.san);
  }
  const out: PanelLine = { san };
  if (line.mate !== undefined) out.mate = sign * line.mate;
  else if (line.cp !== undefined) out.cp = sign * line.cp;
  return out;
}
```

- [ ] **Step 4: Run unit test** - Expected: PASS.

- [ ] **Step 5: Write the failing e2e test**

`test/panel.e2e.spec.ts`. Поддельный движок (`test/fake-engine.ts`) уже есть; если в нём нельзя задать ответ для произвольного FEN по умолчанию, добавить в `FakeEngineClient` поле `fallback?: EngineLine[]` (ответ для незаписанных позиций), `delayMs` и `down: boolean`, если их нет. Сценарии:

```ts
describe('panel', () => {
  const board = setupBoardApp();

  it('turning eval on sends pending then ready for the cursor node, white-side eval', async () => {
    // engine.fallback = [{ move: 'g1f3', cp: 25, pv: ['g1f3'] }]; load GAME (cursorPly 3, курсор после 1...e5? взять из ответа)
    // WsProbe; PATCH /api/board/panel {eval: true, lines: 2} -> 200, state.panel = {eval: true, lines: 2}
    // ждать сообщения analysis: сначала status 'pending', затем 'ready' c nodeId = cursor и lines[0].san[0] вида 'N.xxx'
    // multipv запроса к поддельному движку = 2
  });

  it('fast cursor moves produce one engine request for the last node', async () => {
    // panel on; три PATCH /api/board/cursor подряд без ожидания; через 600 мс у поддельного движка ровно один новый запрос с FEN последнего узла
  });

  it('engine down -> unavailable; board still works', async () => {});

  it('PUT /api/board turns the panel off and no analysis is sent for the new tree', async () => {
    // panel on + note; PUT /api/board {pgn, upto: 3}; state.panel = {eval:false, lines:0} без note;
    // в течение 600 мс ни одного сообщения analysis
  });

  it('no analysis in puzzle mode even with the panel on', async () => {
    // panel on; startPuzzle(...) -> panel выключена; PATCH panel {eval:true} во время задачи -> 200, но analysis не приходит 600 мс
  });

  it('a new tab gets the latest analysis on connect', async () => {});

  it('an old board document without panel and treeEpoch loads with the panel off', async () => {
    // withDb: boards.updateOne({_id:'main'}, {$unset: {panel: '', treeEpoch: ''}}); board.restart();
    // GET /api/board -> panel отсутствует или выключена; ход ученика работает и попадает в /api/inbox
  });

  it('rejects bad panel bodies', async () => {
    // PATCH {lines: 5} -> 400 bad_request; PATCH {} -> 400
  });
});
```

Тела дописать полностью по образцу Task 3. Для «нет сообщений N мс» использовать `await expect(ws.next(600)).rejects.toThrow('no ws message')` после того, как все ожидаемые `state` уже вычитаны.

- [ ] **Step 6: Run to verify failure** - Expected: FAIL (404 на `PATCH /api/board/panel`).

- [ ] **Step 7: Implement**

`board.service.ts`:

```ts
setPanel(body: PanelBody): Promise<BoardState> {
  return this.mutate((s) => {
    const cur = panelOf(s);
    const panel: PanelSettings = {
      eval: body.eval ?? cur.eval,
      lines: (body.lines ?? cur.lines) as PanelSettings['lines'],
      ...(body.note === null ? {} : body.note !== undefined ? { note: body.note } : cur.note !== undefined ? { note: cur.note } : {}),
    };
    return { ...s, panel };
  });
}
```

В `replace` и в обёртке `startPuzzle` вместе с `treeEpoch` ставить `panel: PANEL_OFF`. `panelOf` объявить в `panel.service.ts` и импортировать в сервис доски, либо наоборот - главное, без цикла импортов значений между `board.service.ts` и `panel.service.ts` (`PanelService` инжектит `BoardService`, поэтому `panelOf` лучше положить в `panel-line.ts` или отдельный `panel-settings.ts`).

`board.controller.ts`: `@Patch('board/panel') panel(@Body() body: unknown)` -> `this.board.setPanel(validated<PanelBody>(body, validatePanelBody))`.

`panel.service.ts`:

```ts
@Injectable()
export class PanelService implements OnModuleInit, OnApplicationShutdown {
  readonly analysis = new Subject<AnalysisData>();
  private last: AnalysisData | null = null;
  private wanted: { nodeId: NodeId; fen: string; multipv: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly board: BoardService, private readonly engine: AnalysisService) {}

  onModuleInit(): void {
    this.board.changes.subscribe((s) => this.onState(s));
    this.onState(this.board.current);
  }

  latest(): AnalysisData | null { return this.last; }

  private onState(s: BoardState): void {
    const p = panelOf(s);
    if (s.mode === 'puzzle' || (!p.eval && p.lines === 0)) {
      clearTimeout(this.timer);
      this.wanted = null;
      this.last = null;
      return;
    }
    const node = s.nodes[s.cursor];
    const multipv = Math.max(1, p.lines);
    const w = this.wanted;
    if (w && w.nodeId === node.id && w.fen === node.fen && w.multipv === multipv) return;
    this.wanted = { nodeId: node.id, fen: node.fen, multipv };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), PANEL_DELAY_MS);
  }

  private async run(): Promise<void> {
    const w = this.wanted;
    if (!w) return;
    this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'pending', lines: [] });
    try {
      const lines = await this.engine.analyse(w.fen, { multipv: w.multipv });
      if (this.wanted !== w) return; // курсор ушёл или панель выключили
      this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'ready', lines: lines.map((l) => toPanelLine(w.fen, l)) });
    } catch (e) {
      if (this.wanted !== w) return;
      console.error(`board: panel analysis failed: ${e instanceof Error ? e.message : String(e)}`);
      this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'unavailable', lines: [] });
    }
  }

  private emit(a: AnalysisData): void { this.last = a; this.analysis.next(a); }

  onApplicationShutdown(): void { clearTimeout(this.timer); this.wanted = null; }
}
```

Позиция с матом или патом: сервис движка отвечает пустым `lines`, это `ready` с `[]` - клиент сам пишет «мат» или «пат» по FEN.

`board.gateway.ts`: инжектить `PanelService`; в `afterInit` подписаться на `panel.analysis` и рассылать `{ event: 'analysis', data }`; в `handleConnection` после `state` слать `panel.latest()`, если он не `null` и его `nodeId` совпадает с курсором.

`app.module.ts`: `PanelService` в `providers`.

- [ ] **Step 8: Run tests**

Run: `cd web && npx vitest run --root packages/server && npm run typecheck`
Expected: все PASS.

- [ ] **Step 9: Leave changes in the working tree.**

---

### Task 5: Панель в браузере

**Files:**
- Create: `web/packages/client/src/Panel.tsx`, `web/packages/client/src/Panel.test.tsx`
- Modify: `web/packages/client/src/useBoardSocket.ts`, `web/packages/client/src/useBoardSocket.test.tsx`, `web/packages/client/src/App.tsx`, `web/packages/client/src/styles.css`, `web/packages/client/src/test-utils.ts` (если нужен помощник для `analysis`)

**Interfaces:**
- Consumes: `BoardState.panel`, `AnalysisData`, `PanelLine`, `ServerMessage` с `analysis` (Task 1, Task 4).
- Produces:

```ts
// useBoardSocket: BoardSocket += analysis: AnalysisData | null  (последнее сообщение analysis; сбрасывается при переподключении)
// Panel.tsx
export function formatEval(l: Pick<PanelLine, 'cp' | 'mate'>): string; // '+1.2' | '−0.4' | '0.0' | '#3' | '#−2'
export function evalShare(l: Pick<PanelLine, 'cp' | 'mate'> | undefined): number; // доля белых 0..1 для шкалы: mate>0 -> 1, mate<0 -> 0, cp через winPct
export function Panel(props: { state: BoardState; analysis: AnalysisData | null; orientation: Orientation }): JSX.Element | null;
```

Поведение `Panel`:
- `null`, если `state.mode === 'puzzle'` или панель выключена и заметки нет (`!panel?.eval && !panel?.lines && !panel?.note`).
- Анализ берётся, только если `analysis?.nodeId === state.cursor`; иначе считается `pending`.
- Шкала (`data-testid="eval-bar"`) при `panel.eval`: высота белой части `evalShare * 100%`; если `orientation === 'black'`, белая часть сверху. Над шкалой число `formatEval(lines[0])`. `pending` - «…», `unavailable` - «Движок недоступен» и класс `unavailable` (серая шкала). Пустые `lines` при `ready`: «мат», если в FEN у ходящего нет ходов и шах, иначе «пат» - определить через `new Chess(fen).isCheckmate()` (`chess.js` уже есть в клиенте).
- Линии (`data-testid="engine-lines"`) при `panel.lines > 0`: первые `panel.lines` линий, в каждой `formatEval(line)` и `san.join(' ')`.
- Заметка (`data-testid="coach-note"`) при `panel.note`: текст с `white-space: pre-wrap`.
- Знак минуса в `formatEval` - символ `−` (U+2212), как в спецификации.

- [ ] **Step 1: Write the failing tests**

`Panel.test.tsx` (по образцу `MoveList.test.tsx`, состояние через `StateBuilder` из `test-utils.ts`):

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel, evalShare, formatEval } from './Panel';
import { StateBuilder } from './test-utils';

describe('formatEval and evalShare', () => {
  it('formats white-side evals like Lichess', () => {
    expect(formatEval({ cp: 123 })).toBe('+1.2');
    expect(formatEval({ cp: -40 })).toBe('−0.4');
    expect(formatEval({ cp: 0 })).toBe('0.0');
    expect(formatEval({ mate: 3 })).toBe('#3');
    expect(formatEval({ mate: -2 })).toBe('#−2');
  });
  it('mate fills the bar, equal is half', () => {
    expect(evalShare({ mate: 1 })).toBe(1);
    expect(evalShare({ mate: -1 })).toBe(0);
    expect(evalShare({ cp: 0 })).toBeCloseTo(0.5);
    expect(evalShare(undefined)).toBeCloseTo(0.5);
  });
});

describe('Panel', () => {
  // построить state через StateBuilder (посмотреть его API в test-utils.ts), выставить state.panel
  it('renders nothing when off or in a puzzle', () => {});
  it('shows the bar, two lines and the note for the cursor node', () => {});
  it('treats analysis for another node as pending', () => {});
  it('shows «Движок недоступен» when unavailable', () => {});
  it('puts the white part on top when the board is flipped to black', () => {});
});
```

Тела дописать полностью: `render(<Panel state={...} analysis={...} orientation="white" />)`, проверки через `screen.getByTestId`, `toHaveTextContent`, стиль высоты белой части.

В `useBoardSocket.test.tsx` добавить тест: сообщение `{ event: 'analysis', data }` попадает в `analysis`, а не в `error`.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run --root packages/client`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `useBoardSocket.ts`: состояние `analysis`; в `onmessage` ветки `state`, `analysis`, `error`; при новом соединении `setAnalysis(null)`.
- `Panel.tsx` по поведению выше; `evalShare` через `winPct` из `@board/shared` (`winPct({ cp }) / 100`).
- `App.tsx`: `const { state, connected, error, send, analysis } = useBoardSocket(socket);` и `<Panel state={state} analysis={analysis} orientation={orientation} />` в `aside.moves-col` перед заголовком.
- `styles.css`: блок `.panel` (рамка, отступы как у `.caption`), `.eval-bar` (вертикальная полоса 14px шириной во всю высоту блока панели), `.engine-lines` (моноширинный шрифт для оценки), `.coach-note` (`white-space: pre-wrap`). Цвета брать из уже объявленных переменных или явных значений файла, тёмную тему не добавлять, если её нет в `styles.css`.

- [ ] **Step 4: Run tests and build**

Run: `cd web && npx vitest run --root packages/client && npm run typecheck && npm run build -w @board/client`
Expected: PASS, сборка без ошибок.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 6: CLI: `coach inbox`, `board panel`, `board note`

**Files:**
- Modify: `coach/boardclient.py`, `coach/boardcmd.py`, `coach/cli.py`
- Create: `coach/inboxcmd.py`, `tests/test_inbox_cli.py`
- Modify: `tests/test_board_cli.py`; при необходимости `tests/fakes.py` или фикстура `fake_board` в `tests/conftest.py` (посмотреть, где она объявлена)

**Interfaces:**
- Consumes: `GET /api/inbox` -> `{events: [{id, at, kind, text}], more, cursor}`; `POST /api/inbox/ack {upto}`; `PATCH /api/board/panel {eval?, lines?, note?}`; поле `panel` в состоянии доски.
- Produces:

```python
# boardclient.py
def inbox(self) -> dict: ...                       # GET /api/inbox
def inbox_ack(self, upto: int) -> dict: ...        # POST /api/inbox/ack
def set_panel(self, body: dict) -> dict: ...       # PATCH /api/board/panel
# inboxcmd.py
HOOK_HEADER = "Действия ученика на доске с прошлого сообщения:"
EMPTY = "Новых действий ученика нет"
def add_inbox_parser(sub) -> None: ...
def cmd_inbox(args, cfg) -> None: ...
# boardcmd.py
def panel_line(state: dict) -> str | None: ...     # 'panel eval=on lines=2 note="..."' или None, если всё выключено
```

Вывод `coach inbox` (без флагов и с `--peek`):

```
- ветка ученика от 1...e5: 2.Nf3 Nc6 (узлы n12-n13)
- задача polgar:0310: решено
... и ещё 3 (coach inbox ещё раз)
курсор после 2...Nc6 (ветка ученика), режим free
```

Строка «... и ещё N» только при `more > 0`. С `--hook` перед списком печатается `HOOK_HEADER`. `ack` с `upto` = `id` последнего напечатанного события, только без `--peek` и только если события были.

`--hook`: `BoardClient(timeout=2.0)`; любая ошибка (`BoardUnavailable`, `BoardError`, `ValueError`, `KeyError`, `TypeError`, `OSError`) - тихий выход с кодом 0; нет событий - ничего не печатать.

`board panel`: `--eval {on,off}`, `--lines {0,1,2,3}`; без аргументов - ошибка argparse «give --eval or --lines» (через `p.error`). Печатает `panel_line(state)` или `panel off`.
`board note`: позиционный `text` (необязательный) и `--clear`, ровно одно из двух. Отправляет `{"note": text}` или `{"note": None}`.
`board state`: после строки задачи печатает `panel_line(state)`, если не `None`. Заметка в строке обрезается до 60 символов с `...`.

- [ ] **Step 1: Write the failing tests**

`tests/test_inbox_cli.py` (с фикстурой `fake_board` из существующих тестов; `fake_board.route(method, path, status, body)` и `fake_board.requests`):

```python
from coach.cli import main
from coach.inboxcmd import EMPTY, HOOK_HEADER

EVENTS = {"events": [{"id": 7, "at": "2026-10-15T10:00:00Z", "kind": "line", "text": "ветка ученика от 1...e5: 2.Nf3 (узел n9)"}],
          "more": 0, "cursor": "курсор после 2.Nf3 (ветка ученика), режим free"}


def test_inbox_prints_events_and_cursor_then_acks(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox"])
    out = capsys.readouterr().out
    assert "- ветка ученика от 1...e5: 2.Nf3 (узел n9)" in out
    assert out.rstrip().endswith("курсор после 2.Nf3 (ветка ученика), режим free")
    assert fake_board.requests[-1] == ("POST", "/api/inbox/ack", {"upto": 7})


def test_inbox_peek_does_not_ack(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    main(["inbox", "--peek"])
    assert all(r[0] == "GET" for r in fake_board.requests)


def test_inbox_empty_says_so_and_more_is_reported(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, {"events": [], "more": 0, "cursor": "курсор в начальной позиции, режим free"})
    main(["inbox"])
    assert EMPTY in capsys.readouterr().out
    fake_board.route("GET", "/api/inbox", 200, {**EVENTS, "more": 3})
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox"])
    assert "... и ещё 3" in capsys.readouterr().out


def test_hook_prints_header_and_acks(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox", "--hook"])
    out = capsys.readouterr().out
    assert out.startswith(HOOK_HEADER)


def test_hook_is_silent_without_events(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, {"events": [], "more": 0, "cursor": "x"})
    main(["inbox", "--hook"])
    assert capsys.readouterr().out == ""


def test_hook_is_silent_when_server_is_down_or_broken(fake_board, monkeypatch, capsys):
    fake_board.route("GET", "/api/inbox", 500, {"code": "storage", "message": "boom"})
    main(["inbox", "--hook"])
    monkeypatch.setenv("COACH_BOARD_URL", "http://127.0.0.1:9")
    main(["inbox", "--hook"])
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
```

Если фикстура `fake_board` не умеет отдавать не-JSON тело, добавить в неё маршрут с сырым текстом и тест `--hook` на ответ `200` с телом `"not json"` (пункт 5 Review Focus).

В `tests/test_board_cli.py` добавить:

```python
def test_panel_and_note_send_bodies_and_state_prints_panel_line(fake_board, capsys):
    state = make_state(["e4"], cursor_ply=1)
    on = {**state, "panel": {"eval": True, "lines": 2, "note": "план: " + "f4-f5 " * 20}}
    fake_board.route("PATCH", "/api/board/panel", 200, on)
    main(["board", "panel", "--eval", "on", "--lines", "2"])
    assert fake_board.requests[-1] == ("PATCH", "/api/board/panel", {"eval": True, "lines": 2})
    main(["board", "note", "--clear"])
    assert fake_board.requests[-1] == ("PATCH", "/api/board/panel", {"note": None})
    main(["board", "note", "держи слабое поле d5"])
    assert fake_board.requests[-1] == ("PATCH", "/api/board/panel", {"note": "держи слабое поле d5"})
    out = capsys.readouterr().out
    assert 'panel eval=on lines=2 note="план: ' in out and '..."' in out
```

и проверку `board state`: маршруты `GET /api/board/pgn` и `GET /api/board` со состоянием `on` - в выводе есть строка `panel eval=on lines=2`.

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_inbox_cli.py tests/test_board_cli.py -q`
Expected: FAIL (`No module named coach.inboxcmd`, неизвестная команда `panel`).

- [ ] **Step 3: Implement**

`boardclient.py`: три метода через `self._request`. `inboxcmd.py`:

```python
"""coach inbox: what the student did on the board since the coach last looked."""
from __future__ import annotations

import sys

from .boardclient import BoardClient, BoardError, BoardUnavailable
from .config import Config

HOOK_HEADER = "Действия ученика на доске с прошлого сообщения:"
EMPTY = "Новых действий ученика нет"


def add_inbox_parser(sub) -> None:
    p = sub.add_parser("inbox", help="student moves, deletions and puzzle results since the last look")
    p.add_argument("--peek", action="store_true", help="show without marking as read")
    p.add_argument("--hook", action="store_true", help="for the Claude Code hook: silent when empty or on any error")


def render(data: dict, header: str | None) -> list[str]:
    lines = [header] if header else []
    lines += [f"- {e['text']}" for e in data["events"]]
    if data.get("more"):
        lines.append(f"... и ещё {data['more']} (coach inbox ещё раз)")
    lines.append(data["cursor"])
    return lines


def cmd_inbox(args, cfg: Config) -> None:
    if args.hook:
        try:
            client = BoardClient(timeout=2.0)
            data = client.inbox()
            if not data["events"]:
                return
            print("\n".join(render(data, HOOK_HEADER)))
            client.inbox_ack(data["events"][-1]["id"])
        except (BoardUnavailable, BoardError, ValueError, KeyError, TypeError, OSError):
            pass
        return
    client = BoardClient()
    try:
        data = client.inbox()
        if not data["events"]:
            print(EMPTY)
            print(data["cursor"])
            return
        print("\n".join(render(data, None)))
        if not args.peek:
            client.inbox_ack(data["events"][-1]["id"])
    except BoardUnavailable as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
    except BoardError as e:
        print(f"board error: {e}", file=sys.stderr)
        raise SystemExit(1)
```

Если ошибка случилась после печати в режиме `--hook` (упал `ack`), напечатанное остаётся: события покажутся ещё раз в следующем сообщении, это допустимо по спецификации.

`cli.py`: импорт и регистрация `add_inbox_parser(sub)`, `"inbox": cmd_inbox` в таблице команд (по образцу `puzzles`). `boardcmd.py`: подкоманды `panel` и `note` в `add_board_parser`, ветки в `cmd_board`, `panel_line` и её вызов в `print_state`.

- [ ] **Step 4: Run tests**

Run: `uv run pytest -q`
Expected: все PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 7: Хук и документы

**Files:**
- Modify: `.claude/settings.json`, `CLAUDE.md`, `ROADMAP.md`, `SETUP.md`

**Interfaces:**
- Consumes: команды из Task 6.
- Produces: рабочий хук `UserPromptSubmit`; документы описывают очередь и панель.

- [ ] **Step 1: Hook**

`.claude/settings.json` (сохранить существующий блок `permissions`, добавить `Bash(uv run --quiet coach:*)` не нужно: хук не проходит через разрешения):

```json
{
  "permissions": { "allow": ["Bash(uv run coach:*)", "Bash(uv sync:*)", "Bash(sysctl -n hw.perflevel0.physicalcpu)"] },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "uv run --quiet coach inbox --hook", "timeout": 10 } ] }
    ]
  }
}
```

Формат хуков - внешний (Claude Code); перед записью сверить с актуальной документацией хуков (`https://docs.claude.com/en/docs/claude-code/hooks`) и при расхождении следовать ей, записав расхождение в отчёт.

Проверка вручную: `echo '{}' | uv run --quiet coach inbox --hook; echo "exit $?"` из корня репозитория - пустой вывод при пустой очереди и `exit 0`.

- [ ] **Step 2: CLAUDE.md**

- В таблицу инструментов добавить строки:
  - `inbox [--peek]` - что ученик сделал на доске с прошлого раза: ветки, удаления, итоги задач, где курсор. Хук прикладывает это к сообщению ученика сам.
  - `board panel [--eval on|off] [--lines N]` - шкала оценки и до 3 линий движка рядом с доской.
  - `board note "текст" | --clear` - заметка тренера на панели.
- В раздел «Доска» добавить абзацы:
  - Блок «Действия ученика на доске с прошлого сообщения» в контексте - это вывод хука. Разбирай эти ходы как обычно: что ученик видел, чего опасался. Если блока нет, а ученик говорит, что ходил, вызови `coach inbox` или `coach board state`.
  - Панель включай, только когда показываешь сам. Пока ученик думает над позицией, оценку и линии не включай: это подсказка. `board load`, `show` и новая задача выключают панель сами.
- Правило про `board state` («Если ученик говорит, что попробовал вариант на доске, сначала прочитай state») оставить.

- [ ] **Step 3: ROADMAP.md и SETUP.md**

- `ROADMAP.md`: раздел «2б - осталось» заменить на «2б - готово (дата приёмки)» с кратким списком: очередь и `coach inbox`, хук, панель, хвосты 2а закрыты; спецификация и план в `docs/superpowers/`.
- `SETUP.md`: после шага с доской - шаг «Хук очереди»: что он делает, что он уже в `.claude/settings.json`, как проверить (`coach inbox` после хода на доске; в Claude Code блок «Действия ученика...» в контексте), что делать, если не срабатывает (`/hooks` в терминальном `claude`, проверить `uv` в `PATH`).

- [ ] **Step 4: Check**

Run: `grep -c "—" CLAUDE.md ROADMAP.md SETUP.md docs/superpowers/plans/2026-10-15-board-stage2b.md` - для новых строк символа длинного тире нет (старые строки файлов не трогать). `uv run pytest -q` - PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 8: Приёмка (контроллер)

Выполняет контроллер, не исполнитель задачи. Перед приёмкой: `cd web && npm test` и `npm run typecheck`, `uv run pytest`; затем `docker compose up -d --build board` (пересобирает образ доски), `docker compose ps` - все три сервиса `healthy`.

- [ ] 1. Свободный режим (`coach board load --game <любая партия> --ply 10`, `coach board mode free`), три хода ученика скриптом по WebSocket (как в приёмке задач v2). `coach inbox` - одна строка ветки с номерами и строка курсора; повторный вызов - «Новых действий ученика нет».
- [ ] 2. Хук: сделать ход и попросить ученика написать любое сообщение - в контексте тренера блок «Действия ученика на доске...». Если блока нет, записать это в журнал, проверить `/hooks` и `.claude/settings.json`, и сообщить ученику в итоговом отчёте; тренер тогда вызывает `coach inbox` сам.
- [ ] 3. `coach puzzles next`, неверный ход, затем «Показать решение»: в `coach inbox` два события `puzzle`.
- [ ] 4. `coach board load ...`, `coach board panel --eval on --lines 2`, `coach board note "проверка"`: во встроенном браузере шкала, две линии и заметка (снимок экрана). Листание обновляет оценку.
- [ ] 5. `coach board load --game ... --ply N --upto N` на партии с вариантами в PGN (или PGN-файл с вариантом после N): панель пропала, `coach board state` не содержит ходов с номером ≥ N.
- [ ] 6. `coach puzzles next`: панели нет. `coach board mode free`, `coach board panel --eval on`: панель снова видна.
- [ ] 7. `docker compose stop engine`: панель пишет «Движок недоступен», ходы ученика проходят. `docker compose start engine`.
- [ ] 8. Скрипт: WebSocket с `Origin: http://evil.example` - 403; с `http://127.0.0.1:8765` - подключение.
- [ ] 9. Превращение пешки перетаскиванием мышью во встроенном браузере: позиция `coach show "8/P7/8/8/8/8/8/k6K w - - 0 1"`, режим free, перетащить `a7-a8`, выбрать фигуру - ход в дереве и в `coach inbox`.
- [ ] 10. `docker compose ps`: `board` - `healthy`.

После приёмки: итоговое ревью всей ветки (diff от `b967784`), исправления, затем отчёт ученику со списком решений, принятых без него.
