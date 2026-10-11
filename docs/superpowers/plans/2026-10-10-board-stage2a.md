# Этап 2а: живая доска с линиями и перемоткой Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Тренер загружает партию и варианты на доску, ученик листает их как в анализе Lichess и делает свои ходы, а тренер видит его ветки через `coach board state`.

**Architecture:** Сервер Nest в Docker держит одно дерево ходов в MongoDB, отдаёт браузеру состояние по WebSocket и принимает команды тренера по HTTP. Операции над деревом - чистые функции без Nest и Mongo. Клиент на Vite + React рисует доску `react-chessboard` и список ходов, Python-утилита `coach` вызывает HTTP API через `urllib` и откатывается к `out/board.html`, если сервер не запущен.

**Tech Stack:** Node 24.21.0, npm workspaces, TypeScript 7.0.2, Nest 12.1.2 (Express, `@nestjs/platform-ws`), драйвер `mongodb` 7.7.0, `chess.js` 1.4.0, `@mliebelt/pgn-parser` 1.4.19, React 19.3.0, `react-chessboard` 5.12.1, Vite 8.3.4, Vitest 5.0.3, Testing Library, `mongodb-memory-server` 11.3.0, MongoDB 9.0.2, Docker Compose, Python 3.13 + pytest 9.1.1.

**Spec:** `docs/superpowers/specs/2026-10-10-board-stage2a-design.md`

## Отступления от спецификации и решения, принятые при планировании

Каждый пункт проверен при подготовке плана. Ученику стоит просмотреть их до начала работы.

1. **Node 24.21.0 и последние версии пакетов, а не Node 20.17 из спецификации.** Node на хосте обновлён до 24.21.0 (актуальный LTS, через fnm, версия записана в `.node-version`). Все пакеты ниже - последние на 2026-10-10 (кроме `@types/node`: он идёт за мажорной версией Node, поэтому последний из ветки 24) и проверены установкой под Node 24.21.0: нет `EBADENGINE`, peer-зависимости сходятся, тесты сервера и клиента из этого плана проходят. Что изменилось в коде из-за новых мажорных версий:
   - Nest 12 выходит только как ESM (`"type": "module"`). Сервер остаётся CommonJS: Node 24 загружает ESM-пакеты через `require()`. Проверено: собранный `tsc` сервер `dist/main.js` стартует, отвечает на `/api/health` и отдаёт `state` по `/ws`.
   - TypeScript 7 удалил `moduleResolution: "node"`. В `tsconfig.json` сервера стоят `module` и `moduleResolution` `nodenext`: для пакета без `"type": "module"` это по-прежнему вывод CommonJS. `experimentalDecorators` и `emitDecoratorMetadata` в TypeScript 7 работают, `design:paramtypes` в сборке есть.
   - TypeScript 7 по умолчанию проверяет импорты без привязки (`import './styles.css'`), поэтому в `tsconfig.json` клиента добавлены типы `vite/client`.
   - MongoDB 9.0.2 (тег `latest` образа `mongo`) и в `docker-compose.yml`, и в тестах (`mongodb-memory-server` 11 скачивает эту версию для macOS arm64). В образе есть `mongosh` 2.12.0, healthcheck compose проходит.
2. **Диалога превращения в `react-chessboard` 5 нет.** Он был в версии 4 (`promotionDialog`), в 5.12.1 его нет ни в типах `ChessboardOptions`, ни в коде. Поэтому клиент показывает свой выбор фигуры (`PromotionPicker`).
3. **`@nestjs/serve-static` не используется.** Его загрузчик выбирается в момент `compile()` тестового модуля, когда HTTP-адаптера ещё нет, и в тестах он молча не регистрируется (проверено: `GET /` отвечал 404). Статика клиента подключается через `app.useStaticAssets()` в общей функции `configureApp`, её используют и `main.ts`, и тесты.
4. **Драйвер `mongodb` вместо `mongoose`.** Документ один, хранится и читается целиком, а `nodes` - словарь с произвольными ключами. Схема `mongoose` здесь ничего не проверяет и только мешает типу `Record`.
5. **Тип узла называется `BoardNode`, а не `Node`.** Имя `Node` в клиенте перекрывает DOM-тип `Node`.
6. **В дереве есть поле `seq`.** Это счётчик id узлов, который не сбрасывается при замене дерева. Без него ход ученика из старой вкладки (`parentId` от прошлого дерева) мог бы попасть в узел нового дерева с тем же id.
7. **Порт Mongo для разработки - `127.0.0.1:27018`.** Спецификация не открывает Mongo наружу, но требует запуск сервера локально при разработке. Это противоречие решено файлом `docker-compose.dev.yml`, который открывает порт только при явном подключении. Порт 27018, а не 27017, потому что на хосте установлен `mongod` из Homebrew.
8. **Старая доска остаётся запасным вариантом.** В `.claude/launch.json` конфиг `board` запускает Docker, а прежний статический сервер переименован в `board-file` для режима без сервера.
9. **Образ `board` на той же версии Node, что и хост.** Тесты идут на хосте под Node 24.21.0, образ собирается на `node:24.21.0-alpine`. Версия одна и та же, поэтому расхождений между тестами и образом из-за Node нет.

## Global Constraints

- Node на хосте 24.21.0 (fnm читает `.node-version` в корне репозитория), `web/package.json` требует его через `"engines": { "node": ">=24.21.0" }`. Каждая зависимость ставится с точной версией (`--save-exact` или точная строка в `package.json`) и должна поддерживать Node 24.21.0. Корневой `web/package.json` держит `vite@8.3.4`, чтобы `vitest` и `@vitejs/plugin-react` (ему нужен `vite` 8) использовали одну копию Vite.
- npm 11 из Node 24.21.0 в конце `npm install` предупреждает `install-scripts ... not yet covered by allowScripts` для `mongodb-memory-server` (после `npm ci` на macOS в списке бывает и `fsevents`). Это только предупреждение: скрипты выполняются (`strict-allow-scripts` по умолчанию `false`, проверено: `postinstall` скачал MongoDB при установке). `allowScripts` в `package.json` не добавляется.
- Конфиг Vitest в пакете сервера называется `vitest.config.mts`, то есть явно ESM внутри CommonJS-пакета. Под Node 24 и Vitest 5 работает и `vitest.config.ts` (проверено), имя `.mts` оставлено, чтобы не зависеть от формата пакета.
- Лицензии зависимостей доски только MIT, BSD или Apache. Chessground не используется (GPL-3).
- Наружу открыт только `127.0.0.1:8765:8765`. Mongo в основном `docker-compose.yml` портов не открывает.
- Коллекция `boards`, один документ с `_id: "main"`. `version` растёт на 1 при каждом изменении и никогда не сбрасывается, в том числе при замене дерева.
- Нумерация полуходов как в `review`: `--ply N`, `--upto N`, `at: N`, `goto N` означают позицию перед полуходом N. У узла `ply` - номер полухода хода, который привёл в узел, у корня `ply` равен `plyOffset`. Значит, позиции N соответствует узел главной линии с `ply === N - 1`. `coach board load` всегда передаёт `plyOffset: 0`.
- Главная линия узла - его первый ребёнок (`children[0]`).
- Python-часть без новых runtime-зависимостей: HTTP только через `urllib`. `pytest` добавляется как dev-зависимость через `uv`.
- Тексты интерфейса на русском. Ходы в SAN, как их отдаёт `chess.js`.
- Коммиты не делать. Вместо них в конце задачи шаг «Checkpoint»: показать пользователю `git status` и `git diff --stat`.
- Все команды `npm` выполняются из каталога `web/`, все команды `uv` и `docker compose` из корня репозитория.

## Review Focus

Пять ситуаций, которые спецификация подразумевает, но явно не описывает. Для каждой есть тест в задаче, которой принадлежит код.

1. **Ученик тянет фигуру, а тренер в этот момент заменил дерево.** `move` приходит с `parentId` из старого дерева. Ожидание: ход отклонён с кодом `not_found`, вкладка получает свежее состояние, ход не попадает в чужую позицию. Тесты: «allocates ids after seqStart...» (задача 1), «keeps version and node ids growing when the tree is replaced» (задача 2), «rejects a move from a stale parent id...» (задача 3).
2. **`--at N` за концом партии, обрезанной `--upto`.** Ожидание: ответ 404 с диапазоном доступных позиций, `coach` печатает ошибку и текущее дерево и выходит с кодом 1, а `--ply` за концом при загрузке прижимается к последней позиции. Тесты: «returns null past the end of a game cut with upto» (задача 1), «answers 404 for --at past the end...» (задача 2), «test_line_past_the_end_of_a_cut_game_prints_error_and_state» (задача 7).
3. **Превращение и рокировка в UCI и SAN.** Перетаскивание даёт `e1g1` и `e7e8` без фигуры, тренер пишет `O-O` и `e8=Q`. Ожидание: `e1g1` записывается как `O-O`, `e7e8` без фигуры отклоняется, а клиент сначала спрашивает фигуру, `e8=Q` сопоставляется с узлом `e7e8q`. Тесты: «handles castling and promotion in UCI» (задача 1), «asks for a piece when a pawn reaches the last rank» и «treats a king move by two squares as castling» (задача 4), «test_walk_line_matches_castling_and_promotion_by_uci» (задача 7).
4. **PGN с chess.com и Lichess с часами `{[%clk ...]}`, стрелками `[%cal ...]` и нестандартными заголовками (`ECOUrl`, `Link`, `CurrentPosition`).** Ожидание: партия читается целиком, комментарии не становятся подписями. Тесты: «accepts chess.com / lichess PGN with headers and clock comments» (задача 1), «reads clock comments and unknown chess.com headers without failing» (задача 1), «test_load_sends_pgn_with_clock_comments_cursor_upto_and_side» (задача 7). При подготовке плана через `fromGame` прогнаны все 1874 партии из `data/games/` в экспорте python-chess, ошибок нет.
5. **Вкладка переподключается после `docker compose restart board`.** Ожидание: плашка «нет связи», повтор с паузой 0,5 с, 1 с, 2 с и так далее до 10 с, после подключения то же дерево, даже если база пересоздана и версия меньше прежней. Тесты: «gives a reconnecting tab the same state, also after a server restart» (задача 3), «reconnects with a growing pause and accepts the first state of the new connection» (задача 4), ручная проверка перезапуска в задаче 6.

---

## Карта файлов

```
web/
  package.json                 npm workspaces, общие dev-зависимости, скрипты build/test/typecheck/dev
  Dockerfile, .dockerignore    образ board: сервер + собранный клиент
  packages/shared/             типы состояния и протокола (только типы, без кода)
  packages/server/
    src/tree/                  чистые функции дерева + тесты
    src/storage/               BoardRepository и реализация на драйвере mongodb
    src/board/                 BoardService (очередь изменений), HTTP-контроллер, WebSocket-шлюз, ошибки
    src/app.module.ts, configure.ts, main.ts
    test/                      интеграционные тесты с mongodb-memory-server
  packages/client/
    src/nav.ts, moves.ts       навигация по дереву, перевод перетаскивания в UCI
    src/useBoardSocket.ts      WebSocket с переподключением
    src/App.tsx, BoardView.tsx, MoveList.tsx, PromotionPicker.tsx, styles.css
docker-compose.yml             board + mongo, healthcheck
docker-compose.dev.yml         порт Mongo 127.0.0.1:27018 для разработки
.claude/launch.json            board (Docker) и board-file (старая статическая доска)
coach/boardclient.py           HTTP-клиент на urllib
coach/boardcmd.py              команды coach board и show_on_server
coach/cli.py                   подключение board, перевод show на сервер
tests/                         pytest: поддельный сервер доски
CLAUDE.md, SETUP.md            инструкции тренеру и установка
```

---

### Task 1: Монорепозиторий `web/`, пакет `shared` и дерево ходов

**Files:**
- Create: `web/package.json`
- Create: `web/packages/shared/package.json`, `web/packages/shared/tsconfig.json`, `web/packages/shared/src/index.ts`
- Create: `web/packages/server/package.json`, `web/packages/server/tsconfig.json`, `web/packages/server/tsconfig.build.json`, `web/packages/server/vitest.config.mts`
- Create: `web/packages/server/src/tree/tree-error.ts`, `web/packages/server/src/tree/tree.ts`
- Test: `web/packages/server/src/tree/tree.spec.ts`, `web/packages/server/src/tree/pgn-parser.spec.ts`
- Modify: `.gitignore` (в конец)
- Create: `.node-version` (в корне репозитория)

**Interfaces:**
- Consumes: ничего.
- Produces (типы из `@board/shared`): `NodeId`, `Author = 'game' | 'coach' | 'student'`, `Mode = 'frozen' | 'free'`, `Orientation`, `ArrowColor = 'green' | 'red' | 'blue'`, `Arrow { from; to; color }`, `BoardNode { id; parent; children; san; uci; fen; ply; author; arrows; caption? }`, `Tree { rootFen; rootId; nodes; cursor; seq }`, `BoardMeta { title?; gameId?; plyOffset }`, `BoardState extends Tree { version; mode; orientation; meta; updatedAt: string }`, `ErrorCode = 'illegal' | 'frozen' | 'not_found' | 'forbidden' | 'storage' | 'bad_request'`, `ErrorPayload { code; message; version }`, `ServerMessage`, `ClientMessage`, `NavigateData`, `MoveData`, `DeleteBranchData`, `At = number | NodeId`, `ReplaceBody`, `AddLineBody`, `CursorBody`, `ModeBody`.
- Produces (`web/packages/server/src/tree/tree.ts`):
  - `START_FEN: string`
  - `type GameInput = { pgn: string } | { fen?: string; moves?: string[] }`
  - `interface FromGameOptions { upto?: number; plyOffset?: number; seqStart?: number }`
  - `plyFromFen(fen: string): number`
  - `addMove(tree: Tree, parentId: NodeId, uci: string, author: Author): { tree: Tree; node: BoardNode; created: boolean }` - принимает и UCI, и SAN
  - `addLine(tree: Tree, parentId: NodeId, moves: string[], author: Author): { tree: Tree; nodes: BoardNode[] }`
  - `deleteBranch(tree: Tree, nodeId: NodeId): Tree`
  - `isSubtreeBy(tree: Tree, nodeId: NodeId, author: Author): boolean`
  - `pathTo(tree: Tree, nodeId: NodeId): BoardNode[]`
  - `mainLine(tree: Tree): BoardNode[]`
  - `mainLineNodeAtPly(tree: Tree, ply: number): BoardNode | null` - узел позиции перед полуходом `ply`
  - `toPgn(tree: Tree, headers?: Record<string, string>): string`
  - `fromGame(input: GameInput, opts?: FromGameOptions): Tree`
  - Все функции не меняют переданное дерево и бросают `TreeError(code, message)` из `tree-error.ts`.

- [ ] **Step 1: Создать каркас workspaces**

В корне репозитория создать `.node-version` с одной строкой (её читает fnm):

```
24.21.0
```

Run: `node --version`
Expected: `v24.21.0`.

`web/package.json`:

```json
{
  "name": "board-web",
  "private": true,
  "engines": { "node": ">=24.21.0" },
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "typescript": "7.0.2",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

`@types/node` - последняя версия ветки 24, по мажорной версии Node на хосте, а не последняя вообще (26.x).

`web/packages/shared/package.json`:

```json
{
  "name": "@board/shared",
  "version": "0.0.0",
  "private": true,
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`web/packages/shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`web/packages/server/package.json`:

```json
{
  "name": "@board/server",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "watch": "tsc -p tsconfig.build.json --watch --preserveWatchOutput",
    "start": "node dist/main.js",
    "start:dev": "node --watch dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@board/shared": "*",
    "@mliebelt/pgn-parser": "1.4.19",
    "chess.js": "1.4.0"
  }
}
```

Плагин для Vitest не нужен: Vite 8 компилирует TypeScript через Oxc, а Oxc по `tsconfig.json` выпускает метаданные декораторов Nest (`design:paramtypes`).

`web/packages/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "ES2022",
    "moduleResolution": "nodenext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`web/packages/server/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

`module` и `moduleResolution` `nodenext`, потому что TypeScript 7 удалил `moduleResolution: "node"` (ошибка `TS5108`). В `package.json` сервера нет `"type": "module"`, поэтому `tsc` выпускает CommonJS, как раньше, а ESM-пакеты Nest 12 Node 24 загружает через `require()`.

`web/packages/server/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
```

В конец `.gitignore` добавить:

```
web/node_modules/
web/packages/*/node_modules/
web/packages/*/dist/
```

- [ ] **Step 2: Установить зависимости**

Run: `cd web && npm install`
Expected: `added ... packages`, в выводе нет `EBADENGINE`, создан `web/package-lock.json`. Проверка: `npm ls vite` показывает только `vite@8.3.4` (у `vitest` строка `vite@8.3.4 deduped`).

- [ ] **Step 3: Записать общие типы**

`web/packages/shared/src/index.ts`:

```ts
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
```

Run: `cd web && npm run typecheck -w @board/shared`
Expected: без ошибок.

- [ ] **Step 4: Написать падающие тесты дерева и библиотеки PGN**

`web/packages/server/src/tree/tree-error.ts`:

```ts
import type { ErrorCode } from '@board/shared';

export class TreeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TreeError';
  }
}
```

`web/packages/server/src/tree/tree.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  addLine,
  addMove,
  deleteBranch,
  fromGame,
  isSubtreeBy,
  mainLine,
  mainLineNodeAtPly,
  pathTo,
  plyFromFen,
  toPgn,
} from './tree';
import { TreeError } from './tree-error';

const sans = (nodes: { san: string | null }[]) => nodes.map((n) => n.san).join(' ');

function expectTreeError(fn: () => unknown, code: string, text?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TreeError);
    expect((e as TreeError).code).toBe(code);
    if (text) expect((e as TreeError).message).toContain(text);
    return;
  }
  throw new Error('expected TreeError');
}

describe('fromGame', () => {
  it('builds the main line from moves and puts the cursor at the end', () => {
    const t = fromGame({ moves: ['e4', 'e5', 'Nf3'] });
    expect(sans(mainLine(t).slice(1))).toBe('e4 e5 Nf3');
    expect(t.nodes[t.cursor].san).toBe('Nf3');
    expect(t.nodes[t.rootId].ply).toBe(0);
    expect(t.nodes[t.cursor].ply).toBe(3);
  });

  it('cuts the main line with upto: the position before ply upto is the last one', () => {
    const t = fromGame({ pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *' }, { upto: 4 });
    expect(sans(mainLine(t).slice(1))).toBe('e4 e5 Nf3');
    expect(t.nodes[t.cursor].ply).toBe(3);
  });

  it('reads nested variations from PGN without losses (pgn-parser check)', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 Nc6 *';
    const t = fromGame({ pgn });
    const root = t.nodes[t.rootId];
    const e4 = t.nodes[root.children[0]];
    expect(e4.children.map((id) => t.nodes[id].san)).toEqual(['e5', 'c5']);
    const c5 = t.nodes[e4.children[1]];
    expect(c5.author).toBe('coach');
    expect(c5.children.map((id) => t.nodes[id].san)).toEqual(['Nf3', 'c3']);
    const c3 = t.nodes[c5.children[1]];
    expect(c3.children.map((id) => t.nodes[id].san)).toEqual(['d5', 'Nf6']);
    expect(toPgn(t)).toBe('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 Nc6 *\n');
  });

  it('accepts chess.com / lichess PGN with headers and clock comments', () => {
    const pgn = [
      '[Event "Live Chess"]',
      '[Site "Chess.com"]',
      '[White "sex_sempai"]',
      '[Black "Der_Zerstorer"]',
      '[Result "1/2-1/2"]',
      '[CurrentPosition "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3"]',
      '[ECOUrl "https://www.chess.com/openings/Caro-Kann-Defense-2.d4-d5"]',
      '[TimeControl "600"]',
      '[Link "https://www.chess.com/game/live/147276340892"]',
      '',
      '1. e4 { [%clk 0:09:59.6] } 1... c6 { [%clk 0:09:58.7] } 2. d4 { [%clk 0:09:57.7] } 2... d5 { [%clk 0:09:58.6] } { [%cal Gc4a3] } 1/2-1/2',
    ].join('\n');
    const t = fromGame({ pgn }, { plyOffset: 0 });
    expect(sans(mainLine(t).slice(1))).toBe('e4 c6 d4 d5');
    expect(Object.values(t.nodes).every((n) => n.caption === undefined)).toBe(true);
  });

  it('starts from a FEN header with black to move and numbers moves from the FEN', () => {
    const fen = '8/6pp/p7/1p1pk2P/1P2pNn1/P3P1P1/3K4/8 b - - 4 43';
    const t = fromGame({ pgn: `[SetUp "1"]\n[FEN "${fen}"]\n\n43... Kf5 44. Nxd5 *` });
    expect(t.nodes[t.rootId].ply).toBe(85);
    expect(mainLineNodeAtPly(t, 86)!.id).toBe(t.rootId);
    expect(toPgn(t)).toBe(`[SetUp "1"]\n[FEN "${fen}"]\n\n43... Kf5 44. Nxd5 *\n`);
  });

  it('rejects an illegal move in PGN and garbage PGN', () => {
    expectTreeError(() => fromGame({ pgn: '1. e4 e5 2. Ke3 *' }), 'illegal', 'Ke3');
    expectTreeError(() => fromGame({ pgn: '1. e4 e5 2. Zz9 *' }), 'bad_request');
  });

  it('allocates ids after seqStart so ids of the previous tree are never reused', () => {
    const t = fromGame({ moves: ['e4'] }, { seqStart: 40 });
    expect(Object.keys(t.nodes).sort()).toEqual(['n41', 'n42']);
    expect(t.seq).toBe(42);
  });
});

describe('plyFromFen', () => {
  it('counts plies from the FEN move number and side to move', () => {
    expect(plyFromFen(START_FEN)).toBe(0);
    expect(plyFromFen('8/8/8/8/8/8/k7/4K3 b - - 0 43')).toBe(85);
  });
});

describe('addMove', () => {
  it('returns the existing child for a known move and creates a new node otherwise', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const root = t0.rootId;
    const same = addMove(t0, root, 'e2e4', 'student');
    expect(same.created).toBe(false);
    expect(same.node.author).toBe('game');
    expect(same.tree.nodes[root].children).toHaveLength(1);
    const fresh = addMove(t0, root, 'd2d4', 'student');
    expect(fresh.created).toBe(true);
    expect(fresh.node).toMatchObject({ san: 'd4', uci: 'd2d4', ply: 1, author: 'student', parent: root });
    expect(fresh.tree.nodes[root].children).toEqual([t0.nodes[root].children[0], fresh.node.id]);
    expect(t0.nodes[root].children).toHaveLength(1);
  });

  it('handles castling and promotion in UCI', () => {
    const castle = fromGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const oo = addMove(castle, castle.rootId, 'e1g1', 'student');
    expect(oo.node).toMatchObject({ san: 'O-O', uci: 'e1g1' });
    const oooBySan = addLine(castle, castle.rootId, ['O-O-O'], 'coach');
    expect(oooBySan.nodes[0].uci).toBe('e1c1');

    const promo = fromGame({ fen: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1' });
    expectTreeError(() => addMove(promo, promo.rootId, 'e7e8', 'student'), 'illegal');
    const knight = addMove(promo, promo.rootId, 'e7e8n', 'student');
    expect(knight.node).toMatchObject({ san: 'e8=N', uci: 'e7e8n' });
    const queen = addLine(promo, promo.rootId, ['e8=Q'], 'coach');
    expect(queen.nodes[0].uci).toBe('e7e8q');
  });

  it('throws not_found for an unknown parent', () => {
    expectTreeError(() => addMove(fromGame({}), 'n999', 'e2e4', 'student'), 'not_found');
  });
});

describe('addLine', () => {
  it('reuses existing moves and appends new ones', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const { tree, nodes } = addLine(t0, t0.rootId, ['e4', 'c5', 'Nf3'], 'coach');
    expect(nodes.map((n) => n.author)).toEqual(['game', 'coach', 'coach']);
    const e4 = tree.nodes[tree.nodes[tree.rootId].children[0]];
    expect(e4.children.map((id) => tree.nodes[id].san)).toEqual(['e5', 'c5']);
  });

  it('rejects a line with an illegal move in the middle and leaves the tree unchanged', () => {
    const t0 = fromGame({ moves: ['e4'] });
    expectTreeError(() => addLine(t0, t0.cursor, ['e5', 'Ke3', 'Nf3'], 'coach'), 'illegal', 'move 2 (Ke3)');
    expect(Object.keys(t0.nodes)).toHaveLength(2);
  });
});

describe('deleteBranch', () => {
  it('removes the subtree and moves the cursor to the parent when it was inside', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const e4 = t0.nodes[t0.rootId].children[0];
    const { tree: t1, nodes } = addLine(t0, e4, ['c5', 'Nf3', 'd6'], 'student');
    const withCursor = { ...t1, cursor: nodes[2].id };
    const t2 = deleteBranch(withCursor, nodes[0].id);
    expect(t2.cursor).toBe(e4);
    expect(t2.nodes[e4].children).toHaveLength(1);
    expect(nodes.every((n) => t2.nodes[n.id] === undefined)).toBe(true);
  });

  it('keeps the cursor when it is outside the deleted branch and refuses to delete the root', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const { tree: t1, node } = addMove(t0, t0.rootId, 'd2d4', 'student');
    expect(deleteBranch(t1, node.id).cursor).toBe(t0.cursor);
    expectTreeError(() => deleteBranch(t1, t1.rootId), 'bad_request');
  });
});

describe('isSubtreeBy', () => {
  it('is false when the coach continued a student branch', () => {
    const t0 = fromGame({ moves: ['e4'] });
    const s = addMove(t0, t0.cursor, 'c7c5', 'student');
    expect(isSubtreeBy(s.tree, s.node.id, 'student')).toBe(true);
    const c = addLine(s.tree, s.node.id, ['Nf3'], 'coach');
    expect(isSubtreeBy(c.tree, s.node.id, 'student')).toBe(false);
  });
});

describe('pathTo and mainLineNodeAtPly', () => {
  it('returns the nodes from the root', () => {
    const t = fromGame({ moves: ['e4', 'e5', 'Nf3'] });
    expect(pathTo(t, t.cursor).map((n) => n.san)).toEqual([null, 'e4', 'e5', 'Nf3']);
    expect(pathTo(t, t.cursor).map((n) => n.ply)).toEqual([0, 1, 2, 3]);
  });

  it('addresses positions by review ply with a non-zero plyOffset', () => {
    const fen = '8/6pp/p7/1p1pk2P/1P2pNn1/P3P1P1/3K4/8 b - - 4 43';
    const t = fromGame({ fen, moves: ['Kf5', 'Nxd5', 'Ne5'] }, { plyOffset: 85 });
    expect(mainLineNodeAtPly(t, 86)!.id).toBe(t.rootId);
    expect(mainLineNodeAtPly(t, 87)!.san).toBe('Kf5');
    expect(mainLineNodeAtPly(t, 89)!.san).toBe('Ne5');
    expect(mainLineNodeAtPly(t, 90)).toBeNull();
    expect(mainLineNodeAtPly(t, 85)).toBeNull();
  });

  it('returns null past the end of a game cut with upto', () => {
    const t = fromGame({ pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *' }, { upto: 4 });
    expect(mainLineNodeAtPly(t, 4)!.san).toBe('Nf3');
    expect(mainLineNodeAtPly(t, 5)).toBeNull();
  });
});

describe('toPgn', () => {
  it('writes nested variations and marks student branches', () => {
    const t0 = fromGame({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] });
    const [, e4, e5] = mainLine(t0);
    const a = addLine(t0, e4.id, ['c5', 'Nf3'], 'coach');
    const b = addLine(a.tree, a.nodes[0].id, ['c3', 'd5'], 'coach');
    const c = addLine(b.tree, e5.id, ['Bc4'], 'student');
    const d = addLine(c.tree, c.nodes[0].id, ['Nf6'], 'coach');
    expect(toPgn(d.tree, { Event: 'Board', Mode: 'free' })).toBe(
      '[Event "Board"]\n[Mode "free"]\n\n' +
        '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5)) 2. Nf3 (2. Bc4 {ученик} 2... Nf6) 2... Nc6 *\n',
    );
  });

  it('marks a student move that continues the main line', () => {
    const t0 = fromGame({ moves: ['e4'] });
    const s = addMove(t0, t0.cursor, 'e7e5', 'student');
    expect(toPgn(s.tree)).toBe('1. e4 e5 {ученик} *\n');
  });
});
```

`web/packages/server/src/tree/pgn-parser.spec.ts` (отдельная проверка выбранной библиотеки, как требует спецификация):

```ts
import { describe, expect, it } from 'vitest';
import pgnParser from '@mliebelt/pgn-parser';

// Проверка выбранной библиотеки: вложенные варианты, комментарии с часами, заголовки chess.com.
describe('@mliebelt/pgn-parser', () => {
  it('keeps nested variations attached to the move they replace', () => {
    const game = pgnParser.parseGame('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 *');
    const sans = (line: { notation: { notation: string } }[]) => line.map((m) => m.notation.notation).join(' ');
    expect(sans(game.moves)).toBe('e4 e5 Nf3');
    const [c5line] = game.moves[1].variations;
    expect(sans(c5line)).toBe('c5 Nf3 d6');
    const [c3line] = c5line[1].variations;
    expect(sans(c3line)).toBe('c3 d5');
    expect(sans(c3line[1].variations[0])).toBe('Nf6');
  });

  it('reads clock comments and unknown chess.com headers without failing', () => {
    const game = pgnParser.parseGame(
      '[Event "Live Chess"]\n[ECOUrl "https://www.chess.com/openings/x"]\n[Link "https://www.chess.com/game/live/1"]\n\n' +
        '1. e4 { [%clk 0:09:59.6] } 1... c6 { [%clk 0:09:58.7] } *',
    );
    expect(game.moves.map((m) => m.notation.notation)).toEqual(['e4', 'c6']);
    expect(game.moves[0].commentDiag?.clk).toBe('0:09:59.6');
  });
});
```

- [ ] **Step 5: Убедиться, что тесты падают**

Run: `cd web && npm test -w @board/server`
Expected: `pgn-parser.spec.ts` проходит (2 теста), `tree.spec.ts` падает на импорте `./tree` (файла ещё нет).

- [ ] **Step 6: Реализовать модуль дерева**

`web/packages/server/src/tree/tree.ts`:

```ts
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
```

Пояснения к решениям:
- Ход в формате `e2e4`/`e7e8q` разбирается как объект `{ from, to, promotion }`. Без фигуры превращения `chess.js` такой ход не принимает, поэтому `e7e8` отклоняется, а не превращается в ферзя молча.
- Варианты из PGN получают автора `coach`. Варианты, отходящие от хода за границей `upto`, не попадают в дерево вместе с самим ходом.
- Комментарии PGN (часы, стрелки, текст) не переносятся в `caption`: подписи ставит только тренер.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `cd web && npm test -w @board/server`
Expected: `Test Files 2 passed (2)`, `Tests 23 passed (23)`.

Run: `cd web && npm run typecheck -w @board/server`
Expected: без ошибок.

- [ ] **Step 8: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 2: Сервер Nest - хранение в Mongo и HTTP API

**Files:**
- Modify: `web/packages/server/package.json` (зависимости через `npm install`)
- Create: `web/packages/server/src/storage/board-repository.ts`, `web/packages/server/src/storage/mongo-board-repository.ts`
- Create: `web/packages/server/src/board/board-error.ts`, `web/packages/server/src/board/board-error.filter.ts`, `web/packages/server/src/board/board.service.ts`, `web/packages/server/src/board/board.controller.ts`
- Create: `web/packages/server/src/app.module.ts`, `web/packages/server/src/configure.ts`, `web/packages/server/src/main.ts`
- Test: `web/packages/server/test/helpers.ts`, `web/packages/server/test/http.e2e.spec.ts`

**Interfaces:**
- Consumes: из задачи 1 `fromGame`, `addLine`, `deleteBranch`, `mainLine`, `mainLineNodeAtPly`, `toPgn`, `TreeError`, типы `@board/shared`.
- Produces:
  - `abstract class BoardRepository { load(): Promise<BoardState | null>; save(state: BoardState): Promise<void>; ping(): Promise<void> }`, реализация `MongoBoardRepository` читает `MONGO_URL` (по умолчанию `mongodb://127.0.0.1:27018/board`).
  - `class BoardError extends Error { code: ErrorCode }`, `HTTP_STATUS: Record<ErrorCode, number>` (`bad_request` 400, `forbidden` 403, `not_found` 404, `frozen` 409, `illegal` 422, `storage` 503).
  - `class BoardService`: `changes: Subject<BoardState>`, `current: BoardState`, `pgn(): string`, `health(): Promise<boolean>`, `replace(body: ReplaceBody)`, `addCoachLine(body: AddLineBody)`, `setCursor(body: CursorBody)`, `setMode(mode: Mode)`, `deleteNode(nodeId: NodeId)`, все изменения возвращают `Promise<BoardState>`. Приватные `resolveAt(s, at)` и `mutate(change)` используются в задаче 3.
  - `configureApp(app: NestExpressApplication): void` - общая настройка для `main.ts` и тестов. Каталог клиента берётся из `CLIENT_DIR`, по умолчанию `packages/client/dist`.
  - HTTP: `GET /api/health`, `GET /api/board`, `GET /api/board/pgn` (text/plain, заголовки `Cursor`, `CursorAt`, `Mode`), `PUT /api/board`, `POST /api/board/lines`, `PATCH /api/board/cursor`, `PATCH /api/board/mode`, `DELETE /api/board/nodes/:id`. Ошибка - JSON `{ code, message, version }`.
  - Тестовые помощники: `setupBoardApp(): BoardHarness` с полями `running`, `mongo`, `restart()`, `load(body?)`, константы `GAME`, `MONGO_VERSION = '9.0.2'`, `startApp(): Promise<Running>`.

- [ ] **Step 1: Установить Nest, драйвер и тестовые пакеты**

Run:

```bash
cd web
npm install --save-exact -w @board/server @nestjs/common@12.1.2 @nestjs/core@12.1.2 @nestjs/platform-express@12.1.2 mongodb@7.7.0 reflect-metadata@0.2.2 rxjs@7.8.2
MONGOMS_VERSION=9.0.2 npm install --save-exact --save-dev -w @board/server @nestjs/testing@12.1.2 mongodb-memory-server@11.3.0 supertest@7.3.1 @types/supertest@7.2.1 @types/express@5.0.6
```

Expected: без `EBADENGINE`, в конце предупреждение `install-scripts` про `mongodb-memory-server` (см. Global Constraints). Второй команде нужна сеть: `postinstall` пакета `mongodb-memory-server` скачивает MongoDB 9.0.2 для macOS arm64 (архив около 164 МБ, бинарник около 375 МБ) в `web/node_modules/.cache/mongodb-memory-server`. Если скачивание прервалось, первый запуск тестов скачает бинарник сам, поэтому у хуков тайм-аут 120 с. Версия 9.0.2 та же, что у образа `mongo` в `docker-compose.yml` (задача 6).

- [ ] **Step 2: Написать падающие интеграционные тесты HTTP**

`web/packages/server/test/helpers.ts`:

```ts
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { BoardState } from '@board/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure';

export const MONGO_VERSION = '9.0.2';
export const GAME = '[White "a"]\n[Black "b"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';

export interface Running {
  app: NestExpressApplication;
  http: ReturnType<NestExpressApplication['getHttpServer']>;
  wsUrl: string;
}

export async function startApp(): Promise<Running> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, http: app.getHttpServer(), wsUrl: `ws://127.0.0.1:${port}/ws` };
}

export interface BoardHarness {
  readonly running: Running;
  readonly mongo: MongoMemoryServer;
  restart(): Promise<void>;
  load(body?: object): Promise<BoardState>;
}

/** Mongo в памяти на файл тестов, чистая коллекция и свежий сервер на каждый тест. */
export function setupBoardApp(): BoardHarness {
  let mongo: MongoMemoryServer;
  let running: Running;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: MONGO_VERSION } });
    process.env.MONGO_URL = mongo.getUri('board');
  });
  afterAll(async () => {
    await mongo.stop();
  });
  beforeEach(async () => {
    const client = new MongoClient(process.env.MONGO_URL!);
    await client.db().collection('boards').deleteMany({});
    await client.close();
    running = await startApp();
  });
  afterEach(async () => {
    await running.app.close();
  });
  return {
    get running() {
      return running;
    },
    get mongo() {
      return mongo;
    },
    async restart() {
      await running.app.close();
      running = await startApp();
    },
    async load(body: object = { pgn: GAME, cursorPly: 3, orientation: 'black' }) {
      const res = await request(running.http).put('/api/board').send(body).expect(200);
      return res.body as BoardState;
    },
  };
}
```

`web/packages/server/test/http.e2e.spec.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BoardState } from '@board/shared';
import { GAME, setupBoardApp } from './helpers';

const board = setupBoardApp();
const http = () => board.running.http;

describe('HTTP API', () => {
  it('starts with an empty board at the initial position', async () => {
    const s = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(s.nodes)).toHaveLength(1);
    expect(s).toMatchObject({ mode: 'free', orientation: 'white', version: 1 });
  });

  it('loads a game and returns the state', async () => {
    const s = await board.load();
    expect(s.orientation).toBe('black');
    expect(s.nodes[s.cursor].san).toBe('e5');
    expect(Object.keys(s.nodes)).toHaveLength(7);
    const health = await request(http()).get('/api/health').expect(200);
    expect(health.body).toEqual({ ok: true });
  });

  it('adds a coach line from a ply number and moves the cursor with arrows', async () => {
    await board.load();
    const s1 = (await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4', 'Nf6'] }).expect(200))
      .body as BoardState;
    const nf3 = Object.values(s1.nodes).find((n) => n.san === 'Nf3')!;
    const nc6 = s1.nodes[nf3.children[0]];
    const bc4 = s1.nodes[nc6.children[1]];
    expect(bc4).toMatchObject({ san: 'Bc4', author: 'coach' });
    const s2 = (
      await request(http())
        .patch('/api/board/cursor')
        .send({ at: bc4.id, arrows: [{ from: 'c4', to: 'f7', color: 'red' }], caption: 'f7' })
        .expect(200)
    ).body as BoardState;
    expect(s2.cursor).toBe(bc4.id);
    expect(s2.nodes[bc4.id]).toMatchObject({ arrows: [{ from: 'c4', to: 'f7', color: 'red' }], caption: 'f7' });
    expect(s2.version).toBe(s1.version + 1);
  });

  it('answers 422 naming the illegal move', async () => {
    await board.load();
    const res = await request(http()).post('/api/board/lines').send({ at: 3, moves: ['Nf3', 'Ke3'] }).expect(422);
    expect(res.body.code).toBe('illegal');
    expect(res.body.message).toContain('Ke3');
  });

  it('answers 404 for --at past the end of a game cut with upto, and clamps cursorPly', async () => {
    const s = await board.load({ pgn: GAME, cursorPly: 99, upto: 4 });
    expect(s.nodes[s.cursor].san).toBe('Nf3');
    const res = await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Nc6'] }).expect(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body.message).toContain('1..4');
    await request(http()).patch('/api/board/cursor').send({ at: 'n999' }).expect(404);
  });

  it('serves the tree as PGN with cursor and mode headers', async () => {
    await board.load();
    const res = await request(http()).get('/api/board/pgn').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('[CursorAt "3"]');
    expect(res.text).toContain('[Mode "free"]');
    expect(res.text).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
  });

  it('switches the mode and deletes any branch for the coach', async () => {
    await board.load();
    const s1 = (await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4'] }).expect(200)).body as BoardState;
    const bc4 = Object.values(s1.nodes).find((n) => n.san === 'Bc4')!;
    const s2 = (await request(http()).delete(`/api/board/nodes/${bc4.id}`).expect(200)).body as BoardState;
    expect(s2.nodes[bc4.id]).toBeUndefined();
    const s3 = (await request(http()).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200)).body as BoardState;
    expect(s3.mode).toBe('frozen');
    await request(http()).patch('/api/board/mode').send({ mode: 'sleep' }).expect(400);
    await request(http()).delete('/api/board/nodes/n999').expect(404);
  });

  it('keeps version and node ids growing when the tree is replaced', async () => {
    const a = await board.load();
    const b = await board.load({ fen: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1', moves: ['e8=Q'] });
    expect(b.version).toBeGreaterThan(a.version);
    const oldIds = new Set(Object.keys(a.nodes));
    expect(Object.keys(b.nodes).some((id) => oldIds.has(id))).toBe(false);
    expect(b.nodes[b.cursor]).toMatchObject({ san: 'e8=Q', uci: 'e7e8q' });
  });

  it('serves the built client from CLIENT_DIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-client-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>board</title>');
    process.env.CLIENT_DIR = dir;
    try {
      await board.restart();
      const res = await request(http()).get('/').expect(200);
      expect(res.text).toContain('<title>board</title>');
    } finally {
      delete process.env.CLIENT_DIR;
    }
  });
});

describe('persistence', () => {
  it('keeps the tree after the server restarts', async () => {
    const s = await board.load();
    await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4'] }).expect(200);
    await board.restart();
    const after = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(after.version).toBe(s.version + 1);
    expect(Object.values(after.nodes).some((n) => n.san === 'Bc4')).toBe(true);
  });

  it('answers 503 storage and keeps the old state when Mongo is gone', async () => {
    const s = await board.load();
    await board.mongo.stop({ doCleanup: false });
    try {
      const res = await request(http()).patch('/api/board/mode').send({ mode: 'frozen' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('storage');
      await request(http()).get('/api/health').expect(503);
      const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
      expect(now.version).toBe(s.version);
      expect(now.mode).toBe('free');
    } finally {
      await board.mongo.start(true);
    }
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd web && npm test -w @board/server`
Expected: `http.e2e.spec.ts` падает на импорте `../src/app.module`, тесты дерева проходят.

- [ ] **Step 4: Реализовать хранилище**

`web/packages/server/src/storage/board-repository.ts`:

```ts
import type { BoardState } from '@board/shared';

/** Хранилище одного документа доски. Реализация для Mongo - MongoBoardRepository. */
export abstract class BoardRepository {
  abstract load(): Promise<BoardState | null>;
  abstract save(state: BoardState): Promise<void>;
  abstract ping(): Promise<void>;
}
```

`web/packages/server/src/storage/mongo-board-repository.ts`:

```ts
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient, type Collection } from 'mongodb';
import type { BoardState } from '@board/shared';
import { BoardRepository } from './board-repository';

export const BOARD_ID = 'main';
type BoardDoc = Omit<BoardState, 'updatedAt'> & { _id: string; updatedAt: Date };

@Injectable()
export class MongoBoardRepository extends BoardRepository implements OnApplicationShutdown {
  private readonly client: MongoClient;
  private readonly boards: Collection<BoardDoc>;

  constructor() {
    super();
    const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/board';
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
    this.boards = this.client.db().collection<BoardDoc>('boards');
  }

  async load(): Promise<BoardState | null> {
    const doc = await this.boards.findOne({ _id: BOARD_ID });
    if (!doc) return null;
    const { _id, updatedAt, ...rest } = doc;
    return { ...rest, updatedAt: updatedAt.toISOString() };
  }

  async save(state: BoardState): Promise<void> {
    const doc: BoardDoc = { ...state, _id: BOARD_ID, updatedAt: new Date(state.updatedAt) };
    await this.boards.replaceOne({ _id: BOARD_ID }, doc, { upsert: true });
  }

  async ping(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
```

`serverSelectionTimeoutMS: 3000` нужен, чтобы при упавшей базе запрос получил ошибку `storage` за 3 секунды, а не висел 30.

- [ ] **Step 5: Реализовать ошибки и сервис**

`web/packages/server/src/board/board-error.ts`:

```ts
import type { ErrorCode } from '@board/shared';

export class BoardError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  frozen: 409,
  illegal: 422,
  storage: 503,
};
```

`web/packages/server/src/board/board.service.ts`:

```ts
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
  deleteBranch,
  fromGame,
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
```

Как устроена очередь: `mutate` вычисляет новое состояние из текущего, сохраняет его и только после успешного сохранения подменяет `this.state` и рассылает его через `changes`. Если сохранение упало, состояние не меняется, клиент получает `storage`. Изменения выполняются строго по одному через цепочку промисов.

- [ ] **Step 6: Реализовать контроллер, фильтр ошибок, модуль и запуск**

`web/packages/server/src/board/board-error.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { BoardError, HTTP_STATUS } from './board-error';
import { BoardService } from './board.service';

@Catch(BoardError)
export class BoardErrorFilter implements ExceptionFilter {
  constructor(private readonly board: BoardService) {}

  catch(error: BoardError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HTTP_STATUS[error.code]).json({
      code: error.code,
      message: error.message,
      version: this.board.current.version,
    });
  }
}
```

`web/packages/server/src/board/board.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import type { AddLineBody, BoardState, CursorBody, ModeBody, ReplaceBody } from '@board/shared';
import { BoardErrorFilter } from './board-error.filter';
import { BoardService } from './board.service';

@Controller('api')
@UseFilters(BoardErrorFilter)
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get('health')
  async health(@Res() res: Response): Promise<void> {
    const ok = await this.board.health();
    res.status(ok ? 200 : 503).json({ ok });
  }

  @Get('board')
  get(): BoardState {
    return this.board.current;
  }

  @Get('board/pgn')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  pgn(): string {
    return this.board.pgn();
  }

  @Put('board')
  replace(@Body() body: ReplaceBody): Promise<BoardState> {
    return this.board.replace(body);
  }

  @Post('board/lines')
  @HttpCode(200)
  addLine(@Body() body: AddLineBody): Promise<BoardState> {
    return this.board.addCoachLine(body);
  }

  @Patch('board/cursor')
  cursor(@Body() body: CursorBody): Promise<BoardState> {
    return this.board.setCursor(body);
  }

  @Patch('board/mode')
  mode(@Body() body: ModeBody): Promise<BoardState> {
    return this.board.setMode(body.mode);
  }

  @Delete('board/nodes/:id')
  remove(@Param('id') id: string): Promise<BoardState> {
    return this.board.deleteNode(id);
  }
}
```

`web/packages/server/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BoardController } from './board/board.controller';
import { BoardErrorFilter } from './board/board-error.filter';
import { BoardService } from './board/board.service';
import { BoardRepository } from './storage/board-repository';
import { MongoBoardRepository } from './storage/mongo-board-repository';

@Module({
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardErrorFilter,
    { provide: BoardRepository, useClass: MongoBoardRepository },
  ],
})
export class AppModule {}
```

`web/packages/server/src/configure.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Общая настройка для main.ts и тестов: размер тела, статика клиента. */
export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '2mb' });
  const clientDir = process.env.CLIENT_DIR ?? join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDir)) app.useStaticAssets(clientDir);
}
```

`web/packages/server/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8765);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`board: http://${host}:${port}`);
}

void bootstrap();
```

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `cd web && npm test -w @board/server`
Expected: `Test Files 3 passed (3)`, `Tests 34 passed (34)`. Тест «answers 503 storage...» идёт несколько секунд: запросы к остановленной базе ждут `serverSelectionTimeoutMS`.

Run: `cd web && npm run typecheck -w @board/server && npm run build -w @board/server`
Expected: без ошибок, появился `web/packages/server/dist/main.js`.

- [ ] **Step 8: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 3: Сервер - WebSocket и ходы ученика

**Files:**
- Modify: `web/packages/server/package.json` (зависимости через `npm install`)
- Modify: `web/packages/server/src/board/board.service.ts` (импорт и методы ученика)
- Create: `web/packages/server/src/board/board.gateway.ts`
- Modify: `web/packages/server/src/app.module.ts`, `web/packages/server/src/configure.ts`
- Test: `web/packages/server/test/ws-probe.ts`, `web/packages/server/test/ws.e2e.spec.ts`

**Interfaces:**
- Consumes: `BoardService.mutate`, `resolveAt`, `current`, `changes` из задачи 2; `addMove`, `isSubtreeBy`, `deleteBranch` из задачи 1.
- Produces:
  - `BoardService.studentNavigate(nodeId: NodeId)`, `studentMove(parentId: NodeId, uci: string)`, `studentDelete(nodeId: NodeId)`, все `Promise<BoardState>`, в режиме `frozen` бросают `BoardError('frozen')`.
  - WebSocket на пути `/ws`. Сообщения в формате `{ event, data }` (формат `WsAdapter`). Сервер шлёт `state` при подключении и после каждого изменения всем вкладкам, на ошибку шлёт этой вкладке `error`, а следом `state`.

- [ ] **Step 1: Установить WebSocket-пакеты**

Run:

```bash
cd web
npm install --save-exact -w @board/server @nestjs/websockets@12.1.2 @nestjs/platform-ws@12.1.2
npm install --save-exact --save-dev -w @board/server ws@8.22.0 @types/ws@8.18.2
```

Expected: без `EBADENGINE`. `ws@8.22.0` - та же версия, что закреплена внутри `@nestjs/platform-ws@12.1.2`.

- [ ] **Step 2: Написать падающие тесты WebSocket**

`web/packages/server/test/ws-probe.ts`:

```ts
import WebSocket from 'ws';
import type { ServerMessage } from '@board/shared';

/** WebSocket-клиент для тестов: складывает сообщения в очередь и отдаёт по одному. */
export class WsProbe {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((m: ServerMessage) => void)[] = [];
  readonly ws: WebSocket;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  static async open(url: string): Promise<WsProbe> {
    const probe = new WsProbe(url);
    await new Promise<void>((resolve, reject) => {
      probe.ws.once('open', () => resolve());
      probe.ws.once('error', reject);
    });
    return probe;
  }

  next(timeoutMs = 3000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no ws message')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  send(event: string, data: unknown): void {
    this.ws.send(JSON.stringify({ event, data }));
  }

  close(): void {
    this.ws.close();
  }
}
```

`web/packages/server/test/ws.e2e.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BoardState, ServerMessage } from '@board/shared';
import { GAME, setupBoardApp } from './helpers';
import { WsProbe } from './ws-probe';

const board = setupBoardApp();
const stateOf = (m: ServerMessage): BoardState => {
  expect(m.event).toBe('state');
  return (m as { event: 'state'; data: BoardState }).data;
};

describe('WebSocket', () => {
  it('sends state on connect, applies a student move and shows it in the PGN', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await ws.next()).version).toBe(s.version);
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    const st = stateOf(await ws.next());
    expect(st.nodes[st.cursor]).toMatchObject({ san: 'Bc4', author: 'student' });
    const pgn = await request(board.running.http).get('/api/board/pgn').expect(200);
    expect(pgn.text).toContain('(2. Bc4 {ученик})');
    ws.close();
  });

  it('broadcasts coach changes to every open tab', async () => {
    await board.load();
    const a = await WsProbe.open(board.running.wsUrl);
    const b = await WsProbe.open(board.running.wsUrl);
    await a.next();
    await b.next();
    await request(board.running.http).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200);
    expect(stateOf(await a.next()).mode).toBe('frozen');
    expect(stateOf(await b.next()).mode).toBe('frozen');
    a.close();
    b.close();
  });

  it('treats a student move that already exists as navigation and navigates by id', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    const moved = stateOf(await ws.next());
    expect(Object.keys(moved.nodes)).toHaveLength(7);
    expect(moved.nodes[moved.cursor]).toMatchObject({ san: 'Nf3', author: 'game' });
    ws.send('navigate', { nodeId: s.rootId });
    expect(stateOf(await ws.next()).cursor).toBe(s.rootId);
    ws.close();
  });

  it('rejects an illegal move with an error and resends the state', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'e1e3' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'illegal', version: s.version } });
    expect(stateOf(await ws.next()).version).toBe(s.version);
    ws.close();
  });

  it('rejects moves, navigation and deletion while frozen', async () => {
    const s = await board.load();
    await request(board.running.http).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200);
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    await ws.next();
    ws.send('navigate', { nodeId: s.rootId });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    await ws.next();
    ws.send('deleteBranch', { nodeId: s.cursor });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    ws.close();
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(now.nodes)).toHaveLength(7);
    expect(now.cursor).toBe(s.cursor);
  });

  it('lets the student delete only branches that are entirely theirs', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('deleteBranch', { nodeId: s.nodes[s.rootId].children[0] });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'forbidden' } });
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    const withMove = stateOf(await ws.next());
    ws.send('deleteBranch', { nodeId: withMove.cursor });
    const after = stateOf(await ws.next());
    expect(after.nodes[withMove.cursor]).toBeUndefined();
    expect(after.cursor).toBe(s.cursor);
    ws.close();
  });

  it('rejects a move from a stale parent id after the coach replaced the tree', async () => {
    const old = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    const fresh = await board.load({ pgn: GAME, cursorPly: 3 });
    await ws.next();
    ws.send('move', { parentId: old.cursor, uci: 'f1c4' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'not_found' } });
    expect(stateOf(await ws.next()).version).toBe(fresh.version);
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(now.nodes)).toHaveLength(7);
    ws.close();
  });

  it('gives a reconnecting tab the same state, also after a server restart', async () => {
    const s = await board.load();
    const a = await WsProbe.open(board.running.wsUrl);
    await a.next();
    a.close();
    const b = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await b.next())).toMatchObject({ version: s.version, cursor: s.cursor });
    b.close();
    await board.restart();
    const c = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await c.next())).toMatchObject({ version: s.version, cursor: s.cursor });
    c.close();
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd web && npm test -w @board/server`
Expected: в `ws.e2e.spec.ts` падают все 8 тестов: `WsProbe.open` получает ошибку подключения (на `/ws` никто не слушает), остальные 34 проходят.

- [ ] **Step 4: Добавить методы ученика в сервис**

В `web/packages/server/src/board/board.service.ts` заменить импорт из `../tree/tree` на:

```ts
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
```

и вставить перед `private resolveAt(`:

```ts
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
```

- [ ] **Step 5: Реализовать шлюз и подключить его**

`web/packages/server/src/board/board.gateway.ts`:

```ts
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, WebSocket } from 'ws';
import type { DeleteBranchData, MoveData, NavigateData, ServerMessage } from '@board/shared';
import { BoardError } from './board-error';
import { BoardService } from './board.service';

@WebSocketGateway({ path: '/ws' })
export class BoardGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly board: BoardService) {}

  afterInit(): void {
    this.board.changes.subscribe((state) => this.broadcast({ event: 'state', data: state }));
  }

  handleConnection(client: WebSocket): void {
    this.send(client, { event: 'state', data: this.board.current });
  }

  @SubscribeMessage('navigate')
  navigate(@MessageBody() data: NavigateData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentNavigate(data?.nodeId));
  }

  @SubscribeMessage('move')
  move(@MessageBody() data: MoveData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentMove(data?.parentId, data?.uci));
  }

  @SubscribeMessage('deleteBranch')
  deleteBranch(@MessageBody() data: DeleteBranchData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentDelete(data?.nodeId));
  }

  private async guard(client: WebSocket, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (e) {
      const code = e instanceof BoardError ? e.code : 'bad_request';
      const message = e instanceof Error ? e.message : String(e);
      this.send(client, { event: 'error', data: { code, message, version: this.board.current.version } });
      this.send(client, { event: 'state', data: this.board.current });
    }
  }

  private send(client: WebSocket, msg: ServerMessage): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    for (const client of this.server.clients) this.send(client, msg);
  }
}
```

`web/packages/server/src/app.module.ts` целиком:

```ts
import { Module } from '@nestjs/common';
import { BoardController } from './board/board.controller';
import { BoardErrorFilter } from './board/board-error.filter';
import { BoardGateway } from './board/board.gateway';
import { BoardService } from './board/board.service';
import { BoardRepository } from './storage/board-repository';
import { MongoBoardRepository } from './storage/mongo-board-repository';

@Module({
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardGateway,
    BoardErrorFilter,
    { provide: BoardRepository, useClass: MongoBoardRepository },
  ],
})
export class AppModule {}
```

`web/packages/server/src/configure.ts` целиком:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';

/** Общая настройка для main.ts и тестов: WebSocket-адаптер, размер тела, статика клиента. */
export function configureApp(app: NestExpressApplication): void {
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useBodyParser('json', { limit: '2mb' });
  const clientDir = process.env.CLIENT_DIR ?? join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDir)) app.useStaticAssets(clientDir);
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `cd web && npm test -w @board/server`
Expected: `Test Files 4 passed (4)`, `Tests 42 passed (42)`.

Run: `cd web && npm run typecheck -w @board/server`
Expected: без ошибок.

- [ ] **Step 7: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 4: Клиент - каркас, навигация, ходы и соединение

**Files:**
- Create: `web/packages/client/package.json`, `web/packages/client/tsconfig.json`, `web/packages/client/vite.config.ts`
- Create: `web/packages/client/src/nav.ts`, `web/packages/client/src/moves.ts`, `web/packages/client/src/useBoardSocket.ts`
- Test: `web/packages/client/src/test-utils.ts`, `web/packages/client/src/nav.test.ts`, `web/packages/client/src/moves.test.ts`, `web/packages/client/src/useBoardSocket.test.tsx`

**Interfaces:**
- Consumes: типы `@board/shared` (`BoardState`, `BoardNode`, `NodeId`, `ClientMessage`, `ServerMessage`, `ErrorPayload`).
- Produces:
  - `nav.ts`: `type NavKey = 'start' | 'prev' | 'next' | 'end' | 'up' | 'down'`, `currentLine(state, nodeId?): NodeId[]`, `navTarget(state, key: NavKey): NodeId | null`, `moveNumber(parentFen: string, force: boolean): string`, `canStudentDelete(state, nodeId): boolean`.
  - `moves.ts`: `type DropResult = { kind: 'move'; uci } | { kind: 'promotion'; from; to } | { kind: 'illegal' }`, `type PromotionPiece = 'q' | 'r' | 'b' | 'n'`, `dropToMove(fen, from, to): DropResult`, `promotionUci(from, to, piece): string`.
  - `useBoardSocket.ts`: `interface SocketLike`, `type SocketFactory = () => SocketLike`, `useBoardSocket(factory?): { state: BoardState | null; connected: boolean; error: ErrorPayload | null; send(msg: ClientMessage): void }`, константы `RECONNECT_MIN_MS = 500`, `RECONNECT_MAX_MS = 10000`.
  - `test-utils.ts`: `StateBuilder` (`line(from, sans, author): NodeId[]`, `build(cursor, mode?, version?): BoardState`, id узлов `n1` (корень), `n2`, ...), `FakeSocket` (`open()`, `emit(msg)`, `drop()`, `sent`, статические `all` и `last()`), `fakeFactory`.

Решения по навигации: «влево» и «вправо» идут к родителю и к первому ребёнку, Home и End - к корню и к концу текущей линии, «вверх» и «вниз» выбирают соседний вариант того же родителя, без зацикливания. Курсор хранится на сервере, поэтому клиент только вычисляет цель и отправляет `navigate`.

- [ ] **Step 1: Создать пакет клиента**

`web/packages/client/package.json`:

```json
{
  "name": "@board/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@board/shared": "*",
    "chess.js": "1.4.0",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.2"
  }
}
```

`@testing-library/jest-dom` не ставится: тестам хватает обычных проверок `expect`. Последняя версия 7.0.1 требует Node 22 и выше, на Node 24 она бы встала, но не нужна.

`web/packages/client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`"types": ["vite/client"]` нужен TypeScript 7: он по умолчанию проверяет импорты без привязки, и без типов Vite `import './styles.css'` в `main.tsx` падает с `TS2882`.

`web/packages/client/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

Run: `cd web && npm install`
Expected: без `EBADENGINE`, `npm ls vite` по-прежнему только `vite@8.3.4`.

- [ ] **Step 2: Написать помощники и падающие тесты**

`web/packages/client/src/test-utils.ts`:

```ts
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
```

`web/packages/client/src/nav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canStudentDelete, currentLine, moveNumber, navTarget } from './nav';
import { StateBuilder } from './test-utils';

function sample() {
  const b = new StateBuilder();
  const [e4, e5, nf3] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'game');
  const [c5, c3] = b.line(e4, ['c5', 'c3'], 'coach');
  const [d5] = b.line(e4, ['d5'], 'student');
  return { b, e4, e5, nf3, c5, c3, d5 };
}

describe('navTarget', () => {
  it('moves back and forward along the current line', () => {
    const { b, e4, e5, nf3, c5, c3 } = sample();
    expect(navTarget(b.build(e5), 'prev')).toBe(e4);
    expect(navTarget(b.build(e4), 'next')).toBe(e5);
    expect(navTarget(b.build(c5), 'end')).toBe(c3);
    expect(navTarget(b.build(c5), 'start')).toBe(b.rootId);
    expect(navTarget(b.build(nf3), 'next')).toBeNull();
    expect(navTarget(b.build(b.rootId), 'prev')).toBeNull();
  });

  it('switches between variations at a branch point with up and down', () => {
    const { b, e5, c5, d5 } = sample();
    expect(navTarget(b.build(e5), 'down')).toBe(c5);
    expect(navTarget(b.build(c5), 'down')).toBe(d5);
    expect(navTarget(b.build(d5), 'down')).toBeNull();
    expect(navTarget(b.build(c5), 'up')).toBe(e5);
    expect(navTarget(b.build(e5), 'up')).toBeNull();
  });
});

describe('helpers', () => {
  it('currentLine runs from the root through the node to the end of its line', () => {
    const { b, e4, c5, c3 } = sample();
    expect(currentLine(b.build(c5))).toEqual([b.rootId, e4, c5, c3]);
  });

  it('numbers white moves always and black moves only when forced', () => {
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 w - - 0 12', false)).toBe('12.');
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 b - - 0 12', false)).toBe('');
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 b - - 0 12', true)).toBe('12...');
  });

  it('offers deletion only at the start of a branch that is entirely the student’s', () => {
    const { b, e4, d5 } = sample();
    expect(canStudentDelete(b.build(e4), d5)).toBe(true);
    expect(canStudentDelete(b.build(e4), e4)).toBe(false);
    b.line(d5, ['exd5'], 'coach');
    expect(canStudentDelete(b.build(e4), d5)).toBe(false);
  });
});
```

`web/packages/client/src/moves.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dropToMove, promotionUci } from './moves';

describe('dropToMove', () => {
  it('turns a normal drop into UCI and rejects illegal drops', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(dropToMove(start, 'g1', 'f3')).toEqual({ kind: 'move', uci: 'g1f3' });
    expect(dropToMove(start, 'e2', 'e5')).toEqual({ kind: 'illegal' });
  });

  it('treats a king move by two squares as castling', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(dropToMove(fen, 'e1', 'g1')).toEqual({ kind: 'move', uci: 'e1g1' });
    expect(dropToMove(fen, 'e1', 'c1')).toEqual({ kind: 'move', uci: 'e1c1' });
  });

  it('asks for a piece when a pawn reaches the last rank', () => {
    const fen = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    expect(dropToMove(fen, 'e7', 'e8')).toEqual({ kind: 'promotion', from: 'e7', to: 'e8' });
    expect(promotionUci('e7', 'e8', 'n')).toBe('e7e8n');
  });
});
```

`web/packages/client/src/useBoardSocket.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardSocket } from './useBoardSocket';
import { FakeSocket, StateBuilder, fakeFactory } from './test-utils';

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const stateV = (version: number) => {
  const b = new StateBuilder();
  b.line(b.rootId, ['e4'], 'game');
  return b.build(b.rootId, 'free', version);
};

describe('useBoardSocket', () => {
  it('ignores an older state within one connection', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(5) });
      FakeSocket.last().emit({ event: 'state', data: stateV(3) });
    });
    expect(result.current.state!.version).toBe(5);
  });

  it('reconnects with a growing pause and accepts the first state of the new connection', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(5) });
      FakeSocket.last().drop();
    });
    expect(result.current.connected).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => FakeSocket.last().drop());
    act(() => vi.advanceTimersByTime(999));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.all).toHaveLength(3);
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(1) });
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.state!.version).toBe(1);
  });

  it('keeps an error until the next message is sent', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'error', data: { code: 'illegal', message: 'x', version: 1 } });
      FakeSocket.last().emit({ event: 'state', data: stateV(1) });
    });
    expect(result.current.error!.code).toBe('illegal');
    act(() => result.current.send({ event: 'navigate', data: { nodeId: 'n1' } }));
    expect(result.current.error).toBeNull();
    expect(FakeSocket.last().sent).toEqual([{ event: 'navigate', data: { nodeId: 'n1' } }]);
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd web && npm test -w @board/client`
Expected: FAIL, ошибки импорта `./nav`, `./moves`, `./useBoardSocket` (файлов ещё нет).

- [ ] **Step 4: Реализовать навигацию, ходы и соединение**

`web/packages/client/src/nav.ts`:

```ts
import type { BoardNode, BoardState, NodeId } from '@board/shared';

export type NavKey = 'start' | 'prev' | 'next' | 'end' | 'up' | 'down';

/** Текущая линия: от корня до узла и дальше по первым детям до конца. */
export function currentLine(state: BoardState, nodeId: NodeId = state.cursor): NodeId[] {
  const back: NodeId[] = [];
  let cur: BoardNode | undefined = state.nodes[nodeId];
  while (cur) {
    back.unshift(cur.id);
    cur = cur.parent === null ? undefined : state.nodes[cur.parent];
  }
  let tail = state.nodes[nodeId];
  while (tail && tail.children.length) {
    tail = state.nodes[tail.children[0]];
    back.push(tail.id);
  }
  return back;
}

/** Куда переходит курсор по клавише или кнопке. null - переходить некуда. */
export function navTarget(state: BoardState, key: NavKey): NodeId | null {
  const node = state.nodes[state.cursor];
  if (!node) return null;
  let target: NodeId | null = null;
  switch (key) {
    case 'start':
      target = state.rootId;
      break;
    case 'prev':
      target = node.parent;
      break;
    case 'next':
      target = node.children[0] ?? null;
      break;
    case 'end':
      target = currentLine(state).at(-1) ?? null;
      break;
    case 'up':
    case 'down': {
      if (node.parent === null) return null;
      const siblings = state.nodes[node.parent].children;
      const i = siblings.indexOf(node.id) + (key === 'down' ? 1 : -1);
      target = siblings[Math.max(0, Math.min(siblings.length - 1, i))];
      break;
    }
  }
  return target === state.cursor ? null : target;
}

export function moveNumber(parentFen: string, force: boolean): string {
  const [, turn, , , , full] = parentFen.split(' ');
  if (turn === 'w') return `${full}.`;
  return force ? `${full}...` : '';
}

/** Кнопку удаления показываем у начала ветки ученика, если вся ветка его. */
export function canStudentDelete(state: BoardState, nodeId: NodeId): boolean {
  const node = state.nodes[nodeId];
  if (!node || node.author !== 'student' || node.parent === null) return false;
  if (state.nodes[node.parent].author === 'student') return false;
  const stack = [nodeId];
  while (stack.length) {
    const cur = state.nodes[stack.pop()!];
    if (cur.author !== 'student') return false;
    stack.push(...cur.children);
  }
  return true;
}
```

`web/packages/client/src/moves.ts`:

```ts
import { Chess } from 'chess.js';

export type DropResult =
  | { kind: 'move'; uci: string }
  | { kind: 'promotion'; from: string; to: string }
  | { kind: 'illegal' };

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

/** Перевод перетаскивания в ход UCI. Рокировка - ход короля на две клетки (e1g1). */
export function dropToMove(fen: string, from: string, to: string): DropResult {
  const candidates = new Chess(fen)
    .moves({ verbose: true })
    .filter((m) => m.from === from && m.to === to);
  if (candidates.length === 0) return { kind: 'illegal' };
  if (candidates.some((m) => m.promotion)) return { kind: 'promotion', from, to };
  return { kind: 'move', uci: candidates[0].lan };
}

export function promotionUci(from: string, to: string, piece: PromotionPiece): string {
  return `${from}${to}${piece}`;
}
```

`web/packages/client/src/useBoardSocket.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardState, ClientMessage, ErrorPayload, ServerMessage } from '@board/shared';

export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = () => SocketLike;

export const OPEN = 1;
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10000;

export function defaultSocketUrl(loc: Location = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

const browserSocket: SocketFactory = () => new WebSocket(defaultSocketUrl()) as unknown as SocketLike;

export interface BoardSocket {
  state: BoardState | null;
  connected: boolean;
  error: ErrorPayload | null;
  send(msg: ClientMessage): void;
}

export function useBoardSocket(factory: SocketFactory = browserSocket): BoardSocket {
  const [state, setState] = useState<BoardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const socketRef = useRef<SocketLike | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      // Версия отслеживается в пределах одного соединения: после перезапуска сервера
      // или пересоздания базы первое состояние принимается всегда.
      let lastVersion = 0;
      const ws = factory();
      socketRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.event === 'state') {
          if (msg.data.version < lastVersion) return;
          lastVersion = msg.data.version;
          setState(msg.data);
        } else {
          setError(msg.data);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(open, delay);
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [factory]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    setError(null);
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, connected, error, send };
}
```

Ошибка сервера не сбрасывается следующим `state`, потому что сервер шлёт его сразу за `error`. Она живёт до следующего действия ученика (`send`).

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd web && npm test -w @board/client`
Expected: `Test Files 3 passed (3)`, `Tests 11 passed (11)`.

Run: `cd web && npm run typecheck -w @board/client`
Expected: без ошибок.

- [ ] **Step 6: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 5: Клиент - экран доски, список ходов, режимы

**Files:**
- Modify: `web/packages/client/package.json` (`react-chessboard` через `npm install`), `web/package.json` (скрипт `dev`, `concurrently`)
- Create: `web/packages/client/index.html`, `web/packages/client/src/main.tsx`, `web/packages/client/src/App.tsx`, `web/packages/client/src/BoardView.tsx`, `web/packages/client/src/MoveList.tsx`, `web/packages/client/src/PromotionPicker.tsx`, `web/packages/client/src/styles.css`
- Test: `web/packages/client/src/MoveList.test.tsx`, `web/packages/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `navTarget`, `moveNumber`, `canStudentDelete`, `dropToMove`, `promotionUci`, `useBoardSocket`, `SocketFactory`, `StateBuilder`, `FakeSocket`, `fakeFactory` из задачи 4.
- Produces:
  - `App({ socket?: SocketFactory })` - корневой компонент. Плашка режима имеет `data-testid="mode-banner"` (у `react-chessboard` есть свой элемент с ролью `status`, поэтому поиск по роли неоднозначен).
  - `MoveList({ state, disabled, onSelect(nodeId), onDelete(nodeId) })`. Каждый ход - кнопка с `data-node-id` и классом `author-game|coach|student`, текущий ход с `aria-current="true"`, варианты в блоках `.variations`.
  - `BoardView({ node, orientation, canMove, onDrop(from, to) })` поверх `Chessboard` из `react-chessboard` 5 (API через один проп `options`).
  - `PromotionPicker({ color: 'w' | 'b', onPick(piece), onCancel() })`.
  - Скрипт `npm run dev` в `web/`: сборка сервера, затем параллельно `tsc --watch`, `node --watch` и Vite на `http://127.0.0.1:5173` с прокси `/api` и `/ws` на 8765.

API `react-chessboard` 5.12.1 проверен по его `.d.ts`: `<Chessboard options={...} />`, поля `position` (FEN), `boardOrientation`, `allowDragging`, `arrows: { startSquare, endSquare, color }[]`, `squareStyles`, `onPieceDrop({ piece, sourceSquare, targetSquare }): boolean`. Фигуры в DOM помечены `data-piece="wK"`, клетки `data-square="e1"`.

- [ ] **Step 1: Установить доску и `concurrently`**

Run:

```bash
cd web
npm install --save-exact -w @board/client react-chessboard@5.12.1
npm install --save-exact --save-dev concurrently@10.0.6
```

Expected: без `EBADENGINE`. `concurrently` 10 требует Node 22 и выше, на Node 24.21.0 подходит. Флаги `-k` (`--kill-others`) и `-n` (`--names`) в версии 10 те же.

В `web/package.json` в `scripts` добавить:

```json
"dev": "npm run build -w @board/server && concurrently -k -n tsc,server,client \"npm run watch -w @board/server\" \"npm run start:dev -w @board/server\" \"npm run dev -w @board/client\""
```

- [ ] **Step 2: Написать падающие тесты компонентов**

`web/packages/client/src/MoveList.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveList } from './MoveList';
import { StateBuilder } from './test-utils';

afterEach(cleanup);

function sample() {
  const b = new StateBuilder();
  const [e4, e5] = b.line(b.rootId, ['e4', 'e5', 'Nf3', 'Nc6'], 'game');
  const [c5] = b.line(e4, ['c5', 'Nf3'], 'coach');
  const [c3] = b.line(c5, ['c3'], 'coach');
  const [bc4] = b.line(e5, ['Bc4'], 'student');
  return { b, e4, e5, c5, c3, bc4 };
}

describe('MoveList', () => {
  it('renders the main line with move numbers and nested variations', () => {
    const { b, e5 } = sample();
    const { container } = render(<MoveList state={b.build(e5)} disabled={false} onSelect={() => {}} onDelete={() => {}} />);
    const text = container.textContent!.replace(/×/g, '').replace(/\s+/g, ' ');
    expect(text).toBe('1.e4e51...c52.Nf32.c32.Nf32.Bc42...Nc6');
    const variations = container.querySelectorAll('.variations .variations');
    expect(variations).toHaveLength(1);
  });

  it('marks authors and the current move', () => {
    const { b, e5, bc4, c5 } = sample();
    render(<MoveList state={b.build(e5)} disabled={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('e5').getAttribute('aria-current')).toBe('true');
    expect(document.querySelector(`[data-node-id="${bc4}"]`)!.className).toContain('author-student');
    expect(document.querySelector(`[data-node-id="${c5}"]`)!.className).toContain('author-coach');
  });

  it('selects a move on click and deletes a student branch', () => {
    const { b, e5, c5, bc4 } = sample();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<MoveList state={b.build(e5)} disabled={false} onSelect={onSelect} onDelete={onDelete} />);
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    expect(onSelect).toHaveBeenCalledWith(c5);
    expect(screen.getAllByRole('button', { name: /удалить ветку/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'удалить ветку Bc4' }));
    expect(onDelete).toHaveBeenCalledWith(bc4);
  });

  it('disables all moves when disabled', () => {
    const { b, e5 } = sample();
    render(<MoveList state={b.build(e5)} disabled onSelect={() => {}} onDelete={() => {}} />);
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.every((btn) => btn.disabled)).toBe(true);
  });
});
```

`web/packages/client/src/App.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FakeSocket, StateBuilder, fakeFactory } from './test-utils';

beforeEach(() => {
  FakeSocket.all = [];
});
afterEach(cleanup);

function setup(mode: 'free' | 'frozen') {
  const b = new StateBuilder();
  const [e4, e5] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'game');
  const [c5] = b.line(e4, ['c5'], 'coach');
  render(<App socket={fakeFactory} />);
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.emit({ event: 'state', data: b.build(e5, mode) });
  });
  return { ws, e4, e5, c5, b };
}

describe('App', () => {
  it('navigates with arrow keys and picks a variation with down', () => {
    const { ws, e4, c5 } = setup('free');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Свободный просмотр');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(ws.sent).toEqual([
      { event: 'navigate', data: { nodeId: e4 } },
      { event: 'navigate', data: { nodeId: c5 } },
    ]);
  });

  it('navigates by clicking a move and by buttons', () => {
    const { ws, b, c5 } = setup('free');
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'в начало' }));
    expect(ws.sent).toEqual([
      { event: 'navigate', data: { nodeId: c5 } },
      { event: 'navigate', data: { nodeId: b.rootId } },
    ]);
  });

  it('blocks keys, clicks and buttons while frozen, but still flips the board', () => {
    const { ws, c5 } = setup('frozen');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Заморожено тренером');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'назад' }));
    expect(ws.sent).toEqual([]);
    expect((screen.getByRole('button', { name: 'перевернуть' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the error from the server on the status bar', () => {
    const { ws } = setup('free');
    act(() => ws.emit({ event: 'error', data: { code: 'frozen', message: 'frozen', version: 1 } }));
    expect(screen.getByTestId('mode-banner').textContent).toContain('Доска заморожена тренером');
  });

  it('shows the offline banner after the connection drops', () => {
    const { ws } = setup('free');
    act(() => ws.drop());
    expect(screen.getByTestId('mode-banner').textContent).toContain('Нет связи');
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd web && npm test -w @board/client`
Expected: FAIL в `MoveList.test.tsx` и `App.test.tsx` на импорте `./MoveList` и `./App`, 11 тестов задачи 4 проходят.

- [ ] **Step 4: Реализовать компоненты**

`web/packages/client/src/MoveList.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { BoardNode, BoardState, NodeId } from '@board/shared';
import { canStudentDelete, moveNumber } from './nav';

interface Props {
  state: BoardState;
  disabled: boolean;
  onSelect(nodeId: NodeId): void;
  onDelete(nodeId: NodeId): void;
}

export function MoveList({ state, disabled, onSelect, onDelete }: Props) {
  const root = state.nodes[state.rootId];
  if (root.children.length === 0) return <div className="moves empty">Ходов нет</div>;

  const renderLine = (firstId: NodeId, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let id: NodeId | undefined = firstId;
    let force = true;
    while (id) {
      const node: BoardNode = state.nodes[id];
      const parent = state.nodes[node.parent!];
      const current = node.id === state.cursor;
      out.push(
        <span key={node.id} className="move-wrap">
          <button
            type="button"
            className={`move author-${node.author}${current ? ' current' : ''}`}
            data-node-id={node.id}
            aria-current={current ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onSelect(node.id)}
          >
            {moveNumber(parent.fen, force)}
            {node.san}
          </button>
          {canStudentDelete(state, node.id) && (
            <button
              type="button"
              className="delete"
              aria-label={`удалить ветку ${node.san}`}
              disabled={disabled}
              onClick={() => onDelete(node.id)}
            >
              ×
            </button>
          )}
        </span>,
      );
      force = false;
      if (parent.children[0] === node.id && parent.children.length > 1) {
        out.push(
          <div key={`${node.id}-vars`} className="variations" style={{ marginLeft: `${(depth + 1) * 12}px` }}>
            {parent.children.slice(1).map((alt) => (
              <div key={alt} className="variation" data-variation={alt}>
                {renderLine(alt, depth + 1)}
              </div>
            ))}
          </div>,
        );
        force = true;
      }
      id = node.children[0];
    }
    return out;
  };

  return <div className="moves">{renderLine(root.children[0], 0)}</div>;
}
```

`web/packages/client/src/BoardView.tsx`:

```tsx
import { Chessboard } from 'react-chessboard';
import type { ArrowColor, BoardNode, Orientation } from '@board/shared';

export const ARROW_COLORS: Record<ArrowColor, string> = {
  green: 'rgba(63, 163, 77, 0.8)',
  red: 'rgba(214, 69, 69, 0.8)',
  blue: 'rgba(59, 125, 216, 0.8)',
};
const LAST_MOVE = { backgroundColor: 'rgba(255, 210, 60, 0.45)' };

interface Props {
  node: BoardNode;
  orientation: Orientation;
  canMove: boolean;
  onDrop(from: string, to: string): void;
}

export function BoardView({ node, orientation, canMove, onDrop }: Props) {
  const squareStyles: Record<string, React.CSSProperties> = node.uci
    ? { [node.uci.slice(0, 2)]: LAST_MOVE, [node.uci.slice(2, 4)]: LAST_MOVE }
    : {};
  return (
    <Chessboard
      options={{
        id: 'coach-board',
        position: node.fen,
        boardOrientation: orientation,
        allowDragging: canMove,
        arrows: node.arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: ARROW_COLORS[a.color] })),
        squareStyles,
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          if (targetSquare && targetSquare !== sourceSquare) onDrop(sourceSquare, targetSquare);
          // Фигуру всегда возвращаем: позицию после хода пришлёт сервер, отклонённый ход просто не изменит её.
          return false;
        },
      }}
    />
  );
}
```

`onPieceDrop` всегда возвращает `false`: фигура возвращается на место, а новую позицию присылает сервер. Так отклонённый ход ничего не ломает, а принятый появляется с анимацией.

`web/packages/client/src/PromotionPicker.tsx`:

```tsx
import { useEffect } from 'react';
import type { PromotionPiece } from './moves';

const PIECES: { piece: PromotionPiece; label: string; white: string; black: string }[] = [
  { piece: 'q', label: 'ферзь', white: '♕', black: '♛' },
  { piece: 'r', label: 'ладья', white: '♖', black: '♜' },
  { piece: 'b', label: 'слон', white: '♗', black: '♝' },
  { piece: 'n', label: 'конь', white: '♘', black: '♞' },
];

interface Props {
  color: 'w' | 'b';
  onPick(piece: PromotionPiece): void;
  onCancel(): void;
}

export function PromotionPicker({ color, onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="promotion" role="dialog" aria-label="Превращение пешки">
      {PIECES.map((p) => (
        <button key={p.piece} type="button" aria-label={p.label} onClick={() => onPick(p.piece)}>
          {color === 'w' ? p.white : p.black}
        </button>
      ))}
      <button type="button" className="cancel" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}
```

`web/packages/client/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { NodeId } from '@board/shared';
import { BoardView } from './BoardView';
import { MoveList } from './MoveList';
import { PromotionPicker } from './PromotionPicker';
import { dropToMove, promotionUci, type PromotionPiece } from './moves';
import { navTarget, type NavKey } from './nav';
import { useBoardSocket, type SocketFactory } from './useBoardSocket';

const KEYS: Record<string, NavKey> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Home: 'start',
  End: 'end',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const ERROR_TEXT: Record<string, string> = {
  frozen: 'Доска заморожена тренером',
  illegal: 'Нелегальный ход',
  forbidden: 'Эту ветку удалить нельзя',
  not_found: 'Позиция уже изменилась, доска обновлена',
  storage: 'Ошибка хранения на сервере',
  bad_request: 'Сервер отклонил запрос',
};

export function App({ socket }: { socket?: SocketFactory }) {
  const { state, connected, error, send } = useBoardSocket(socket);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState<{ parentId: NodeId; from: string; to: string } | null>(null);
  const frozen = state?.mode !== 'free';

  const go = useCallback(
    (key: NavKey) => {
      if (!state || frozen) return;
      const target = navTarget(state, key);
      if (target) send({ event: 'navigate', data: { nodeId: target } });
    },
    [state, frozen, send],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = KEYS[e.key];
      if (!key) return;
      e.preventDefault();
      go(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!state) {
    return <div className="status offline">{connected ? 'Загрузка доски…' : 'Нет связи с доской, переподключаюсь…'}</div>;
  }

  const node = state.nodes[state.cursor];
  const orientation = flipped ? (state.orientation === 'white' ? 'black' : 'white') : state.orientation;

  const onDrop = (from: string, to: string) => {
    if (frozen) return;
    const result = dropToMove(node.fen, from, to);
    if (result.kind === 'move') send({ event: 'move', data: { parentId: node.id, uci: result.uci } });
    if (result.kind === 'promotion') setPending({ parentId: node.id, from, to });
  };

  const onPromote = (piece: PromotionPiece) => {
    if (pending) send({ event: 'move', data: { parentId: pending.parentId, uci: promotionUci(pending.from, pending.to, piece) } });
    setPending(null);
  };

  return (
    <div className="app">
      <div className={`status ${connected ? (frozen ? 'frozen' : 'free') : 'offline'}`} role="status" data-testid="mode-banner">
        {!connected ? 'Нет связи, переподключаюсь…' : frozen ? 'Заморожено тренером' : 'Свободный просмотр'}
        {error && <span className="error"> · {ERROR_TEXT[error.code] ?? error.message}</span>}
      </div>
      <main className="layout">
        <section className="board-col">
          <BoardView node={node} orientation={orientation} canMove={!frozen && connected} onDrop={onDrop} />
          {node.caption && <div className="caption">{node.caption}</div>}
          <div className="controls">
            <button type="button" aria-label="в начало" disabled={frozen} onClick={() => go('start')}>⏮</button>
            <button type="button" aria-label="назад" disabled={frozen} onClick={() => go('prev')}>◀</button>
            <button type="button" aria-label="вперёд" disabled={frozen} onClick={() => go('next')}>▶</button>
            <button type="button" aria-label="в конец" disabled={frozen} onClick={() => go('end')}>⏭</button>
            <button type="button" aria-label="перевернуть" onClick={() => setFlipped((f) => !f)}>⇅</button>
          </div>
        </section>
        <aside className="moves-col">
          {state.meta.title && <h1 className="title">{state.meta.title}</h1>}
          <MoveList
            state={state}
            disabled={frozen}
            onSelect={(nodeId) => !frozen && send({ event: 'navigate', data: { nodeId } })}
            onDelete={(nodeId) => !frozen && send({ event: 'deleteBranch', data: { nodeId } })}
          />
        </aside>
      </main>
      {pending && (
        <PromotionPicker
          color={node.fen.split(' ')[1] === 'w' ? 'w' : 'b'}
          onPick={onPromote}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
```

`web/packages/client/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/packages/client/src/styles.css` (светлая и тёмная тема по системной настройке, как у нынешней доски; при ширине меньше 760 px список уходит под доску; доска не выше окна):

```css
:root { --bg:#f6f4ef; --fg:#1d1d1f; --muted:#6b6b6b; --card:#ffffff; --line:#e3e0d8;
  --student:#3b7dd8; --coach:#a35fd0; --current:#f2d264; --frozen:#d64545; --free:#3fa34d; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#17181a; --fg:#ececec; --muted:#9a9a9a; --card:#202225; --line:#33363a;
    --student:#6ea8ff; --coach:#c792ea; --current:#7a6420; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.app { max-width: 1100px; margin: 0 auto; padding: 12px 16px; }
.status { padding: 6px 10px; border-radius: 8px; margin-bottom: 10px; font-weight: 600; background: var(--card); border: 1px solid var(--line); }
.status.frozen { color: var(--frozen); } .status.free { color: var(--free); } .status.offline { color: var(--muted); }
.status .error { font-weight: 400; color: var(--frozen); }
.layout { display: grid; grid-template-columns: minmax(280px, 560px) minmax(220px, 1fr); gap: 16px; align-items: start; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
.board-col { width: 100%; max-width: min(560px, calc(100vh - 130px)); }
.caption { margin-top: 8px; }
.controls { display: flex; gap: 6px; margin-top: 8px; }
.controls button { flex: 1; padding: 6px; font-size: 18px; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.controls button:disabled { opacity: .4; cursor: default; }
.moves-col { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px; max-height: 80vh; overflow: auto; }
.title { font-size: 15px; margin: 0 0 8px; }
.moves { line-height: 1.9; }
.move-wrap { white-space: nowrap; }
.move { background: none; border: 0; padding: 1px 4px; margin: 0 1px; border-radius: 4px; color: var(--fg); font: inherit; cursor: pointer; }
.move:disabled { cursor: default; }
.move.author-student { color: var(--student); }
.move.author-coach { color: var(--coach); }
.move.current { background: var(--current); }
.variations { border-left: 2px solid var(--line); padding-left: 6px; margin: 2px 0; font-size: 14px; }
.variation::before { content: '('; color: var(--muted); }
.variation::after { content: ')'; color: var(--muted); }
.delete { background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0 4px; }
.promotion { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(0,0,0,.4); }
.promotion button { font-size: 40px; width: 64px; height: 64px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
.promotion .cancel { font-size: 14px; width: auto; padding: 0 12px; }
```

`web/packages/client/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Доска тренера</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Убедиться, что тесты проходят и клиент собирается**

Run: `cd web && npm test -w @board/client`
Expected: `Test Files 5 passed (5)`, `Tests 20 passed (20)`.

Run: `cd web && npm run build -w @board/client`
Expected: `✓ built`, файлы в `web/packages/client/dist/` (`index.html`, `assets/index-*.js` около 335 КБ, `assets/index-*.css`).

- [ ] **Step 6: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 6: Docker - образ, compose, healthcheck, конфиг превью

**Files:**
- Create: `web/Dockerfile`, `web/.dockerignore`
- Create: `docker-compose.yml`, `docker-compose.dev.yml`
- Modify: `.claude/launch.json` (целиком)

**Interfaces:**
- Consumes: скрипт `npm run build` из `web/package.json` (задачи 1 и 5), `packages/server/dist/main.js`, `packages/client/dist`, переменные `MONGO_URL`, `HOST`, `PORT` (задача 2).
- Produces:
  - Сервисы compose `board` (порт `127.0.0.1:8765:8765`) и `mongo` (без портов, том `board-mongo`, в Docker он называется `chess-coach_board-mongo`), имя проекта `chess-coach`.
  - Конфиг превью `board` (Docker) и `board-file` (прежний `http.server` на `out/`).

Почему `restart: unless-stopped` у `board`: если база недоступна при старте, `onModuleInit` падает и процесс завершается. Docker перезапустит его, когда Mongo вернётся.

- [ ] **Step 1: Написать образ**

`web/Dockerfile`:

```dockerfile
FROM node:24.21.0-alpine AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production MONGOMS_DISABLE_POSTINSTALL=1 HOST=0.0.0.0 PORT=8765
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 8765
CMD ["node", "packages/server/dist/main.js"]
```

Сборочная стадия ставит все зависимости и собирает клиент и сервер. Рабочая стадия ставит только runtime-зависимости. `MONGOMS_DISABLE_POSTINSTALL=1` не даёт `mongodb-memory-server` скачивать MongoDB внутри сборки. Нативные пакеты для Linux arm64 (`@rolldown/binding-linux-arm64-musl` для Vite 8, `lightningcss-linux-arm64-musl`, `@typescript/typescript-linux-arm64` для `tsc` 7) записаны в `package-lock.json`, сгенерированном на macOS (проверено).

`web/.dockerignore`:

```
node_modules
packages/*/node_modules
packages/*/dist
```

- [ ] **Step 2: Написать compose и конфиг превью**

`docker-compose.yml`:

```yaml
name: chess-coach

services:
  mongo:
    image: mongo:9.0.2
    volumes:
      - board-mongo:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 20s
    restart: unless-stopped

  board:
    build: ./web
    image: chess-coach-board:local
    ports:
      - "127.0.0.1:8765:8765"
    environment:
      MONGO_URL: mongodb://mongo:27017/board
      HOST: 0.0.0.0
      PORT: "8765"
    depends_on:
      mongo:
        condition: service_healthy
    restart: unless-stopped

volumes:
  board-mongo:
```

`docker-compose.dev.yml`:

```yaml
services:
  mongo:
    ports:
      - "127.0.0.1:27018:27017"
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "board",
      "runtimeExecutable": "docker",
      "runtimeArgs": ["compose", "up", "--build", "board"],
      "port": 8765
    },
    {
      "name": "board-file",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", "out"],
      "port": 8765
    }
  ]
}
```

Run: `docker compose config --quiet && echo OK`
Expected: `OK`.

- [ ] **Step 3: Освободить порт 8765**

Run: `lsof -nP -iTCP:8765 -sTCP:LISTEN`
Expected: пусто. Если там `Python` (старая доска `http.server`), останови превью `board` через `preview_stop` во встроенном браузере или заверши этот процесс по PID из вывода.

- [ ] **Step 4: Собрать и запустить**

Run: `docker compose build board`
Expected: сборка завершается без ошибок, в логе есть `✓ built` от Vite и образ `chess-coach-board:local`. Первый раз скачиваются `node:24.21.0-alpine` и зависимости.

Run: `docker compose up -d board && docker compose ps`
Expected: `mongo` в статусе `healthy`, `board` в статусе `Up`. `board` стартует только после `healthy` у `mongo`.

Run: `curl -s http://127.0.0.1:8765/api/health && curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8765/`
Expected: `{"ok":true}` и `200 text/html; charset=utf-8`.

Run: `docker compose ps --format '{{.Service}} {{.Ports}}'`
Expected: у `board` `127.0.0.1:8765->8765/tcp`, у `mongo` только `27017/tcp` без стрелки `->`, то есть порт базы наружу не опубликован.

- [ ] **Step 5: Проверить, что перезапуск `board` не теряет дерево**

Run:

```bash
curl -s -X PUT http://127.0.0.1:8765/api/board -H 'Content-Type: application/json' \
  -d '{"pgn":"1. e4 e5 2. Nf3 Nc6 *","cursorPly":3}' | python3 -c "import json,sys; s=json.load(sys.stdin); print(s['version'], s['cursor'])"
docker compose restart board
sleep 3
curl -s http://127.0.0.1:8765/api/board | python3 -c "import json,sys; s=json.load(sys.stdin); print(s['version'], s['cursor'])"
```

Expected: обе строки одинаковые (та же версия и тот же курсор).

Открыть `http://127.0.0.1:8765` во встроенном браузере, выполнить `docker compose restart board` и посмотреть на плашку: сначала «Нет связи, переподключаюсь…», через несколько секунд снова «Свободный просмотр» с той же позицией. Это ручная половина Review Focus 5.

- [ ] **Step 6: Проверить режим разработки**

Run:

```bash
docker compose stop board
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo
cd web && npm run dev
```

В другом терминале: `curl -s http://127.0.0.1:5173/api/health`
Expected: `{"ok":true}` (Vite проксирует на локальный сервер, тот ходит в Mongo на `127.0.0.1:27018`). Остановить `npm run dev` через Ctrl-C.

Run: `docker compose up -d mongo`
Expected: контейнер `mongo` пересоздан без опубликованного порта.

- [ ] **Step 7: Остановить и Checkpoint**

Run: `docker compose stop`
Expected: оба контейнера остановлены, том `chess-coach_board-mongo` остаётся. Не запускать `docker compose down -v`: это удалит дерево.

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 7: Python - `coach board` и `coach show` через сервер

**Files:**
- Create: `coach/boardclient.py`, `coach/boardcmd.py`
- Modify: `coach/cli.py:12` (импорт), `coach/cli.py:162-179` (`cmd_show`), `coach/cli.py:244` (справка `show`), `coach/cli.py:252-254` (регистрация `board`), `coach/cli.py:263-265` (таблица команд)
- Modify: `pyproject.toml` (dev-зависимость и настройки pytest)
- Test: `tests/__init__.py`, `tests/conftest.py`, `tests/fakes.py`, `tests/test_board_cli.py`

**Interfaces:**
- Consumes: HTTP API из задач 2 и 3 (форма ответа `BoardState`, ошибки `{ code, message, version }`), `coach.games.resolve_game`, `coach.board.parse_arrow`, `coach.board.write_live`, `coach.board.GREEN/RED/BLUE`.
- Produces:
  - `coach/boardclient.py`: `DEFAULT_URL = "http://127.0.0.1:8765"`, адрес переопределяется `COACH_BOARD_URL`; `BoardUnavailable`; `BoardError(status, code, message)`; `BoardClient(base_url=None, timeout=5.0)` с методами `state()`, `pgn()`, `replace(body)`, `add_line(at, moves, caption=None)`, `set_cursor(at, arrows=None, caption=None)`, `set_mode(mode)`, `delete_node(node_id)`.
  - `coach/boardcmd.py`: `split_moves(text) -> list[str]`, `parse_at(token) -> int | str`, `main_line(state)`, `node_at(state, at)`, `move_label(state, node) -> str` (`43...Kd6`), `arrow_dict(arrow)`, `arrows_for(fen, best, played, arrows)`, `walk_line(state, start_id, moves)`, `position_line(state)`, `variation_lines(state)`, `print_state(client)`, `cmd_board(args, cfg)`, `show_on_server(client, b, orientation, arrows, caption, ply_offset) -> dict`, `add_board_parser(sub)`.
  - CLI: `coach board load|line|goto|mode|state|delete`. Без сервера `coach board ...` выходит с кодом 1 и подсказкой `docker compose up board`. На 404 печатает ошибку и текущее дерево. `coach show` без сервера пишет `out/board.html`.

- [ ] **Step 1: Добавить pytest**

Run: `uv add --dev pytest==9.1.1`
Expected: в `pyproject.toml` появилась группа `[dependency-groups]` с `dev = ["pytest==9.1.1"]`, обновлён `uv.lock`.

В конец `pyproject.toml` добавить:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Написать поддельный сервер и падающие тесты**

`tests/__init__.py` - пустой файл.

`tests/conftest.py`:

```python
"""Fake board server for `coach board` / `coach show` tests."""
from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeBoard:
    def __init__(self):
        self.requests: list[tuple[str, str, object]] = []
        self.routes: dict[tuple[str, str], tuple[int, object]] = {}

    def route(self, method: str, path: str, status: int, payload) -> None:
        self.routes[(method, path)] = (status, payload)


@pytest.fixture
def fake_board(monkeypatch):
    board = FakeBoard()

    class Handler(BaseHTTPRequestHandler):
        def _handle(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            board.requests.append((self.command, self.path, body))
            status, payload = board.routes.get((self.command, self.path), (404, {"code": "not_found", "message": "no route"}))
            data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/plain" if isinstance(payload, str) else "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_PUT = do_POST = do_PATCH = do_DELETE = _handle

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("COACH_BOARD_URL", f"http://127.0.0.1:{server.server_address[1]}")
    yield board
    server.shutdown()
    server.server_close()


@pytest.fixture
def no_board(monkeypatch):
    """COACH_BOARD_URL points to a port where nothing listens."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setenv("COACH_BOARD_URL", f"http://127.0.0.1:{port}")
```

`tests/fakes.py`:

```python
"""Server-shaped board states for tests (same fields as web/packages/shared BoardState)."""
from __future__ import annotations

import chess


def make_state(moves: list[str], fen: str = chess.STARTING_FEN, cursor_ply: int | None = None,
               mode: str = "free", version: int = 7, plyOffset: int = 0) -> dict:
    """State in the server's shape: ids n1 (root), n2, ... along a single main line."""
    nodes = {"n1": {"id": "n1", "parent": None, "children": [], "san": None, "uci": None, "fen": fen,
                    "ply": plyOffset, "author": "game", "arrows": []}}
    b = chess.Board(fen)
    prev = "n1"
    for i, tok in enumerate(moves, start=2):
        mv = b.parse_san(tok)
        san = b.san(mv)
        b.push(mv)
        nid = f"n{i}"
        nodes[nid] = {"id": nid, "parent": prev, "children": [], "san": san, "uci": mv.uci(), "fen": b.fen(),
                      "ply": nodes[prev]["ply"] + 1, "author": "game", "arrows": []}
        nodes[prev]["children"].append(nid)
        prev = nid
    cursor = prev if cursor_ply is None else next(n["id"] for n in nodes.values() if n["ply"] == cursor_ply - 1)
    return {"rootFen": fen, "rootId": "n1", "nodes": nodes, "cursor": cursor, "seq": len(nodes), "version": version,
            "mode": mode, "orientation": "white", "meta": {"plyOffset": plyOffset}, "updatedAt": "2026-10-10T00:00:00Z"}


def add_child(state: dict, parent: str, san: str, author: str) -> str:
    nodes = state["nodes"]
    b = chess.Board(nodes[parent]["fen"])
    mv = b.parse_san(san)
    san = b.san(mv)
    b.push(mv)
    state["seq"] += 1
    nid = f"n{state['seq']}"
    nodes[nid] = {"id": nid, "parent": parent, "children": [], "san": san, "uci": mv.uci(), "fen": b.fen(),
                  "ply": nodes[parent]["ply"] + 1, "author": author, "arrows": []}
    nodes[parent]["children"].append(nid)
    return nid
```

`tests/test_board_cli.py`:

```python
from __future__ import annotations

import pytest

from coach import board as boardmod
from coach.boardcmd import split_moves, variation_lines, walk_line
from coach.cli import main
from tests.fakes import add_child, make_state

GAME = """[Event "Live Chess"]
[Site "Chess.com"]
[White "Somebody"]
[Black "Student"]
[Result "*"]
[GameId "g1"]

1. e4 { [%clk 0:09:59.6] } 1... e5 { [%clk 0:09:58.7] } 2. Nf3 { [%clk 0:09:57.7] } 2... Nc6 3. Bb5 a6 *
"""


@pytest.fixture
def game_file(tmp_path):
    p = tmp_path / "g1.pgn"
    p.write_text(GAME, encoding="utf-8")
    return str(p)


def test_load_sends_pgn_with_clock_comments_cursor_upto_and_side(fake_board, game_file, capsys):
    state = make_state(["e4", "e5", "Nf3"], cursor_ply=4)
    fake_board.route("PUT", "/api/board", 200, state)
    main(["board", "load", "--game", game_file, "--ply", "4", "--upto", "4", "--black"])
    method, path, body = fake_board.requests[0]
    assert (method, path) == ("PUT", "/api/board")
    assert "[%clk 0:09:59.6]" in body["pgn"]
    assert body["cursorPly"] == 4 and body["upto"] == 4
    assert body["orientation"] == "black" and body["plyOffset"] == 0 and body["gameId"] == "g1"
    assert body["title"] == "Somebody - Student"
    out = capsys.readouterr().out
    assert "loaded g1: 3 plies" in out and "cursor n4 (position 4)" in out


def test_line_prints_new_node_ids_and_marks_student_moves(fake_board, capsys):
    state = make_state(["e4", "e5"])
    nf3 = add_child(state, "n3", "Nf3", "student")
    nc6 = add_child(state, nf3, "Nc6", "coach")
    fake_board.route("POST", "/api/board/lines", 200, state)
    main(["board", "line", "--at", "3", "--moves", "2. Nf3 Nc6", "--caption", "развитие"])
    assert fake_board.requests[0][2] == {"at": 3, "moves": ["Nf3", "Nc6"], "caption": "развитие"}
    out = capsys.readouterr().out
    assert f"{nf3}  2.Nf3 (ученик)" in out
    assert f"{nc6}  2...Nc6" in out


def test_goto_sends_arrows_in_server_format(fake_board, capsys):
    state = make_state(["e4", "e5"])
    fake_board.route("GET", "/api/board", 200, state)
    fake_board.route("PATCH", "/api/board/cursor", 200, state)
    main(["board", "goto", "n3", "--best", "Nf3", "--played", "f2f4", "--arrows", "d1h5,f1c4", "--caption", "план"])
    patch = fake_board.requests[-1]
    assert patch[0:2] == ("PATCH", "/api/board/cursor")
    assert patch[2] == {"at": "n3", "caption": "план", "arrows": [
        {"from": "g1", "to": "f3", "color": "green"},
        {"from": "f2", "to": "f4", "color": "red"},
        {"from": "d1", "to": "h5", "color": "blue"},
        {"from": "f1", "to": "c4", "color": "blue"},
    ]}


def test_mode_freeze_maps_to_frozen(fake_board, capsys):
    fake_board.route("PATCH", "/api/board/mode", 200, make_state(["e4"], mode="frozen"))
    main(["board", "mode", "freeze"])
    assert fake_board.requests[0][2] == {"mode": "frozen"}
    assert "mode frozen" in capsys.readouterr().out


def test_state_prints_pgn_cursor_and_variation_ids(fake_board, capsys):
    state = make_state(["e4", "e5"])
    d5 = add_child(state, "n2", "d5", "student")
    fake_board.route("GET", "/api/board/pgn", 200, "1. e4 e5 (1... d5 {ученик}) *\n")
    fake_board.route("GET", "/api/board", 200, state)
    main(["board", "state"])
    out = capsys.readouterr().out
    assert "1. e4 e5 (1... d5 {ученик}) *" in out
    assert "cursor n3 (position 3), mode free" in out
    assert f"{d5}  1...d5  [student]  -> {d5}" in out


def test_delete_calls_the_node_url(fake_board, capsys):
    fake_board.route("DELETE", "/api/board/nodes/n9", 200, make_state(["e4"]))
    main(["board", "delete", "n9"])
    assert fake_board.requests[0][0:2] == ("DELETE", "/api/board/nodes/n9")


def test_line_past_the_end_of_a_cut_game_prints_error_and_state(fake_board, capsys):
    fake_board.route("POST", "/api/board/lines", 404,
                     {"code": "not_found", "message": "position 90 is outside the main line: available 1..86", "version": 3})
    fake_board.route("GET", "/api/board/pgn", 200, "1. e4 *\n")
    fake_board.route("GET", "/api/board", 200, make_state(["e4"]))
    with pytest.raises(SystemExit) as exc:
        main(["board", "line", "--at", "90", "--moves", "Kd6"])
    assert exc.value.code == 1
    captured = capsys.readouterr()
    assert "available 1..86" in captured.err
    assert "1. e4 *" in captured.out


def test_illegal_move_message_comes_from_the_server(fake_board, capsys):
    fake_board.route("POST", "/api/board/lines", 422,
                     {"code": "illegal", "message": "move 2 (Ke3) is illegal", "version": 3})
    with pytest.raises(SystemExit):
        main(["board", "line", "--at", "1", "--moves", "e4 Ke3"])
    assert "move 2 (Ke3) is illegal" in capsys.readouterr().err


def test_board_commands_fail_with_a_hint_when_the_server_is_down(no_board, capsys):
    with pytest.raises(SystemExit) as exc:
        main(["board", "state"])
    assert exc.value.code == 1
    assert "docker compose up board" in capsys.readouterr().err


def test_show_falls_back_to_the_file_without_a_server(no_board, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(boardmod, "OUT", tmp_path)
    main(["show", "start", "--moves", "e4", "--caption", "x"])
    assert (tmp_path / "board.html").is_file()
    assert "board server is not running" in capsys.readouterr().out


def test_show_puts_the_position_with_its_last_move_and_arrows(fake_board, capsys):
    state = make_state(["e4"])
    fake_board.route("PUT", "/api/board", 200, state)
    fake_board.route("PATCH", "/api/board/cursor", 200, state)
    main(["show", "start", "--moves", "e4", "--best", "e5", "--caption", "ответ"])
    put = fake_board.requests[0][2]
    assert put["fen"] == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    assert put["moves"] == ["e2e4"] and put["orientation"] == "black"
    assert "plyOffset" not in put
    patch = fake_board.requests[1][2]
    assert patch == {"at": "n2", "arrows": [{"from": "e7", "to": "e5", "color": "green"}], "caption": "ответ"}
    assert "live server" in capsys.readouterr().out


def test_walk_line_matches_castling_and_promotion_by_uci():
    castle = make_state(["O-O"], fen="r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert walk_line(castle, "n1", ["O-O"])[0]["uci"] == "e1g1"
    assert walk_line(castle, "n1", ["e1g1"])[0]["id"] == "n2"
    promo = make_state(["e8=Q"], fen="8/4P3/8/8/8/8/k7/4K3 w - - 0 1")
    assert walk_line(promo, "n1", ["e8=Q+"])[0]["uci"] == "e7e8q"


def test_split_moves_and_variation_rows():
    assert split_moves("43... Kd6 44. Ne2, Ne5 *") == ["Kd6", "Ne2", "Ne5"]
    state = make_state(["e4", "e5", "Nf3"])
    c5 = add_child(state, "n2", "c5", "coach")
    add_child(state, c5, "Nf3", "coach")
    rows = variation_lines(state)
    assert rows == [f"{c5}  1...c5 2.Nf3  [coach]  -> n{state['seq']}"]
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `uv run pytest -q`
Expected: ошибка сбора `ModuleNotFoundError: No module named 'coach.boardcmd'`.

- [ ] **Step 4: Реализовать HTTP-клиент**

`coach/boardclient.py`:

```python
"""Thin HTTP client for the live board server (web/packages/server). Standard library only."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8765"
START_HINT = "Board server is not running. Start it: docker compose up board (or preview_start with name 'board')."


class BoardUnavailable(Exception):
    """The server is not reachable (not started, wrong port)."""


class BoardError(Exception):
    """The server answered with an error: {code, message, version}."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class BoardClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or os.environ.get("COACH_BOARD_URL") or DEFAULT_URL).rstrip("/")
        self.timeout = timeout
        # Без системных прокси: запросы идут только на локальный сервер.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _request(self, method: str, path: str, body: dict | None = None, text: bool = False):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"} if data is not None else {}
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {}
            raise BoardError(e.code, payload.get("code", "http"), payload.get("message", raw or str(e.reason))) from None
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            raise BoardUnavailable(f"{START_HINT} ({e})") from None
        return raw if text else json.loads(raw)

    def state(self) -> dict:
        return self._request("GET", "/api/board")

    def pgn(self) -> str:
        return self._request("GET", "/api/board/pgn", text=True)

    def replace(self, body: dict) -> dict:
        return self._request("PUT", "/api/board", body)

    def add_line(self, at: int | str, moves: list[str], caption: str | None = None) -> dict:
        body: dict = {"at": at, "moves": moves}
        if caption is not None:
            body["caption"] = caption
        return self._request("POST", "/api/board/lines", body)

    def set_cursor(self, at: int | str, arrows: list[dict] | None = None, caption: str | None = None) -> dict:
        body: dict = {"at": at}
        if arrows is not None:
            body["arrows"] = arrows
        if caption is not None:
            body["caption"] = caption
        return self._request("PATCH", "/api/board/cursor", body)

    def set_mode(self, mode: str) -> dict:
        return self._request("PATCH", "/api/board/mode", {"mode": mode})

    def delete_node(self, node_id: str) -> dict:
        return self._request("DELETE", f"/api/board/nodes/{urllib.parse.quote(node_id)}")
```

`ProxyHandler({})` отключает системные прокси: если в окружении задан `HTTP_PROXY`, запрос к `127.0.0.1` иначе может уйти в прокси.

- [ ] **Step 5: Реализовать команды**

`coach/boardcmd.py`:

```python
"""`coach board ...` commands and `coach show` on the live board server."""
from __future__ import annotations

import re
import sys

import chess
import chess.pgn
import chess.svg

from . import board as boardmod
from .boardclient import BoardClient, BoardError, BoardUnavailable
from .config import Config
from .games import resolve_game

COLOR_NAMES = {boardmod.GREEN: "green", boardmod.RED: "red", boardmod.BLUE: "blue"}
_MOVE_NO = re.compile(r"^\d+\.+")


def split_moves(text: str) -> list[str]:
    """'43... Kd6 44. Ne2, Ne5' -> ['Kd6', 'Ne2', 'Ne5']."""
    out = []
    for raw in text.replace(",", " ").split():
        tok = _MOVE_NO.sub("", raw)
        if tok and tok not in ("...", "*"):
            out.append(tok)
    return out


def parse_at(token: str) -> int | str:
    """'86' -> 86 (position before ply 86 on the main line), 'n17' -> node id."""
    token = token.strip()
    if token.isdigit():
        return int(token)
    if re.fullmatch(r"n\d+", token):
        return token
    raise SystemExit(f"Bad position '{token}': use a ply number (86) or a node id (n17)")


def main_line(state: dict) -> list[dict]:
    nodes = state["nodes"]
    line = [nodes[state["rootId"]]]
    while line[-1]["children"]:
        line.append(nodes[line[-1]["children"][0]])
    return line


def node_at(state: dict, at: int | str) -> dict:
    if isinstance(at, int):
        for node in main_line(state):
            if node["ply"] == at - 1:
                return node
        line = main_line(state)
        raise BoardError(404, "not_found", f"position {at} is outside the main line: available "
                                           f"{line[0]['ply'] + 1}..{line[-1]['ply'] + 1}")
    if at not in state["nodes"]:
        raise BoardError(404, "not_found", f"node {at} not found")
    return state["nodes"][at]


def move_label(state: dict, node: dict) -> str:
    parent = state["nodes"][node["parent"]]
    _, turn, _, _, _, full = parent["fen"].split(" ")
    return f"{full}.{node['san']}" if turn == "w" else f"{full}...{node['san']}"


def arrow_dict(arrow: chess.svg.Arrow) -> dict:
    return {"from": chess.square_name(arrow.tail), "to": chess.square_name(arrow.head),
            "color": COLOR_NAMES.get(arrow.color, "blue")}


def arrows_for(fen: str, best: str | None, played: str | None, arrows: str | None) -> list[dict]:
    b = chess.Board(fen)
    out = []
    try:
        if best:
            out.append(boardmod.parse_arrow(b, best, boardmod.GREEN))
        if played:
            out.append(boardmod.parse_arrow(b, played, boardmod.RED))
        for tok in (arrows or "").split(","):
            if tok.strip():
                out.append(boardmod.parse_arrow(b, tok, boardmod.BLUE))
    except ValueError as e:
        raise SystemExit(str(e))
    return [arrow_dict(a) for a in out]


def walk_line(state: dict, start_id: str, moves: list[str]) -> list[dict]:
    """Nodes of a line just added from start_id, matched by UCI (castling e1g1, promotion e7e8q)."""
    nodes = state["nodes"]
    cur = nodes[start_id]
    out = []
    for tok in moves:
        b = chess.Board(cur["fen"])
        try:
            uci = b.parse_san(tok).uci()
        except ValueError:
            uci = chess.Move.from_uci(tok).uci()
        cur = next(nodes[c] for c in cur["children"] if nodes[c]["uci"] == uci)
        out.append(cur)
    return out


def position_line(state: dict) -> str:
    cur = state["nodes"][state["cursor"]]
    return f"cursor {cur['id']} (position {cur['ply'] + 1}), mode {state['mode']}, version {state['version']}"


def variation_lines(state: dict) -> list[str]:
    """One row per variation start and per student run: first node id, moves, author, last node id."""
    nodes = state["nodes"]
    rows = []
    stack = [state["rootId"]]
    while stack:
        node = nodes[stack.pop()]
        stack.extend(reversed(node["children"]))
        if node["parent"] is None:
            continue
        parent = nodes[node["parent"]]
        is_variation = parent["children"][0] != node["id"]
        student_start = node["author"] == "student" and parent["author"] != "student"
        if not (is_variation or student_start):
            continue
        line = [node]
        while line[-1]["children"]:
            line.append(nodes[line[-1]["children"][0]])
        authors = sorted({n["author"] for n in line})
        moves = " ".join(move_label(state, n) for n in line)
        rows.append(f"{node['id']}  {moves}  [{', '.join(authors)}]  -> {line[-1]['id']}")
    return rows


def print_state(client: BoardClient) -> None:
    print(client.pgn().rstrip())
    state = client.state()
    print(position_line(state))
    rows = variation_lines(state)
    print("variations:" if rows else "variations: none")
    for row in rows:
        print(f"  {row}")


def _orientation(game: chess.pgn.Game, cfg: Config, args) -> str:
    if args.white:
        return "white"
    if args.black:
        return "black"
    if game.headers.get("Black", "").lower() in cfg.usernames:
        return "black"
    return "white"


def board_load(client: BoardClient, args, cfg: Config) -> None:
    game, gid, _ = resolve_game(args.game, cfg)
    pgn = game.accept(chess.pgn.StringExporter(headers=True, variations=True, comments=True))
    orientation = _orientation(game, cfg, args)
    body = {"pgn": pgn, "orientation": orientation, "gameId": gid, "plyOffset": 0,
            "title": f"{game.headers.get('White', '?')} - {game.headers.get('Black', '?')}"}
    if args.ply is not None:
        body["cursorPly"] = args.ply
    if args.upto is not None:
        body["upto"] = args.upto
    state = client.replace(body)
    plies = len(main_line(state)) - 1
    print(f"loaded {gid}: {plies} plies, {orientation} at the bottom, {position_line(state)}")


def board_line(client: BoardClient, args) -> None:
    at = parse_at(args.at)
    moves = split_moves(args.moves)
    if not moves:
        raise SystemExit("--moves is empty")
    state = client.add_line(at, moves, args.caption)
    start = node_at(state, at)
    for node in walk_line(state, start["id"], moves):
        mark = " (ученик)" if node["author"] == "student" else ""
        print(f"{node['id']}  {move_label(state, node)}{mark}")
    print(position_line(state))


def board_goto(client: BoardClient, args) -> None:
    at = parse_at(args.at)
    arrows = None
    if args.best or args.played or args.arrows:
        arrows = arrows_for(node_at(client.state(), at)["fen"], args.best, args.played, args.arrows)
    state = client.set_cursor(at, arrows=arrows, caption=args.caption)
    print(position_line(state))
    print(f"FEN {state['nodes'][state['cursor']]['fen']}")


def board_mode(client: BoardClient, args) -> None:
    state = client.set_mode("frozen" if args.mode == "freeze" else "free")
    print(position_line(state))


def board_delete(client: BoardClient, args) -> None:
    state = client.delete_node(args.node_id)
    print(f"deleted {args.node_id}; {position_line(state)}")


def cmd_board(args, cfg: Config) -> None:
    client = BoardClient()
    try:
        if args.board_cmd == "load":
            board_load(client, args, cfg)
        elif args.board_cmd == "line":
            board_line(client, args)
        elif args.board_cmd == "goto":
            board_goto(client, args)
        elif args.board_cmd == "mode":
            board_mode(client, args)
        elif args.board_cmd == "state":
            print_state(client)
        elif args.board_cmd == "delete":
            board_delete(client, args)
    except BoardUnavailable as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
    except BoardError as e:
        print(f"board error: {e}", file=sys.stderr)
        if e.status == 404:
            try:
                print_state(client)
            except (BoardError, BoardUnavailable):
                pass
        raise SystemExit(1)


def show_on_server(client: BoardClient, b: chess.Board, orientation: bool, arrows: list[chess.svg.Arrow],
                   caption: str | None, ply_offset: int | None) -> dict:
    """Replace the server tree with one position; the last move (if any) stays as one step to see it."""
    base = b.copy()
    moves = []
    if base.move_stack:
        moves = [base.pop().uci()]
    body: dict = {"fen": base.fen(), "moves": moves, "orientation": "white" if orientation == chess.WHITE else "black"}
    if ply_offset is not None:
        body["plyOffset"] = ply_offset
    state = client.replace(body)
    if arrows or caption:
        state = client.set_cursor(state["cursor"], arrows=[arrow_dict(a) for a in arrows], caption=caption or None)
    return state


def add_board_parser(sub) -> None:
    p = sub.add_parser("board", help="live board server: load a game, add lines, move the cursor, freeze")
    bsub = p.add_subparsers(dest="board_cmd", required=True)

    q = bsub.add_parser("load", help="load a game as the main line")
    q.add_argument("--game", required=True, help="game ref: id, URL, path.pgn, 'latest', 'last-loss'")
    q.add_argument("--ply", type=int, help="cursor on the position BEFORE ply N (review numbering)")
    q.add_argument("--upto", type=int, help="cut the game: the position before ply N is the last one")
    side = q.add_mutually_exclusive_group()
    side.add_argument("--white", action="store_true", help="White at the bottom")
    side.add_argument("--black", action="store_true", help="Black at the bottom")

    q = bsub.add_parser("line", help="add a coach/engine line from position N or node id")
    q.add_argument("--at", required=True, help="ply number (position before it) or node id like n17")
    q.add_argument("--moves", required=True, help="SAN/UCI moves, move numbers allowed")
    q.add_argument("--caption", help="caption at the last position of the line")

    q = bsub.add_parser("goto", help="move the cursor, set arrows and caption there")
    q.add_argument("at", help="ply number (position before it) or node id like n17")
    q.add_argument("--best", help="green arrow (SAN or e2e4)")
    q.add_argument("--played", help="red arrow (SAN or e2e4)")
    q.add_argument("--arrows", help="blue arrows, comma-separated")
    q.add_argument("--caption", help="text under the board")

    q = bsub.add_parser("mode", help="freeze the board or let the student browse and move")
    q.add_argument("mode", choices=["freeze", "free"])

    bsub.add_parser("state", help="PGN with student branches, cursor, mode, variation ids")

    q = bsub.add_parser("delete", help="delete a branch by node id")
    q.add_argument("node_id")
```

Как `coach board line` узнаёт id новых узлов: ответ сервера - полное состояние, а ходы линии `walk_line` находит среди детей по UCI, разобрав SAN через python-chess в позиции каждого узла. UCI у python-chess и `chess.js` совпадает и для рокировки (`e1g1`), и для превращения (`e7e8q`).

- [ ] **Step 6: Подключить команды в `coach/cli.py`**

После строки `from . import board as boardmod` добавить:

```python
from .boardclient import BoardClient, BoardError, BoardUnavailable
from .boardcmd import add_board_parser, cmd_board, show_on_server
```

В `cmd_show` между блоком `try ... except ValueError` со стрелками и строкой `path = boardmod.write_live(...)` вставить:

```python
    client = BoardClient()
    try:
        ply_offset = max(0, len(b.move_stack) - 1) if getattr(args, "game", None) else None
        state = show_on_server(client, b, orientation, arrows, args.caption, ply_offset)
        print(f"board: {client.base_url}  (live server, version {state['version']})")
        print(f"FEN {b.fen()}")
        return
    except BoardUnavailable:
        print("board server is not running: writing out/board.html (no live board)")
    except BoardError as e:
        raise SystemExit(f"board server rejected the position: {e}")
```

`ply_offset` нужен только с `--game`: тогда номера полуходов на доске совпадают с `review`. Для FEN сервер выводит номер из самого FEN.

Справку парсера `show` заменить на:

```python
    p = sub.add_parser("show", help="show one position on the live board (falls back to out/board.html)")
```

Перед строкой `p = sub.add_parser("report", ...)` добавить:

```python
    add_board_parser(sub)

```

В словаре команд в конце `main` добавить `"board": cmd_board`:

```python
        "review": cmd_review, "stats": cmd_stats, "show": cmd_show, "report": cmd_report, "board": cmd_board,
```

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `uv run pytest -q`
Expected: `13 passed`.

Run: `uv run coach board --help && uv run coach show start --moves e4`
Expected: справка перечисляет `load, line, goto, mode, state, delete`. Если сервер остановлен, вторая команда печатает `board server is not running: writing out/board.html (no live board)` и путь к `out/board.html`. Если запущен, печатает `board: http://127.0.0.1:8765  (live server, version N)`.

- [ ] **Step 8: Checkpoint**

Показать пользователю `git status` и `git diff --stat`. Не коммитить.

---

### Task 8: `CLAUDE.md`, `SETUP.md` и приёмка по сценарию

**Files:**
- Modify: `CLAUDE.md:35` (строка `show` в таблице инструментов и новые строки `board`), `CLAUDE.md:42-48` (раздел «Доска»), `CLAUDE.md:63-69` (раздел «Файлы»)
- Modify: `SETUP.md` (новый шаг 5 «Доска», «Готово» становится шагом 6)

**Interfaces:**
- Consumes: команды `coach board ...` и `coach show` из задачи 7, конфиги превью `board` и `board-file` из задачи 6.
- Produces: инструкции тренеру и установка; результат приёмки.

- [ ] **Step 1: Обновить таблицу инструментов в `CLAUDE.md`**

Строку `show` заменить на строки ниже (новые строки без длинного тире, как требует глобальная настройка пользователя):

```markdown
| `show [позиция] [--game ID --ply N] [--moves "..."] [--played X] [--best Y] [--arrows a,b] [--caption "..."]` | одна позиция на живой доске; без сервера пишет `out/board.html` |
| `board load --game ID [--ply N] [--upto N] [--white\|--black]` | партия главной линией, курсор перед полуходом N; `--upto N` прячет продолжение |
| `board line --at N\|nID --moves "..." [--caption "..."]` | вариант тренера от позиции N или узла; печатает id новых узлов |
| `board goto N\|nID [--best X] [--played Y] [--arrows a,b] [--caption "..."]` | курсор на позицию, стрелки и подпись в ней |
| `board mode freeze\|free` | заморозить доску или дать ученику листать и ходить |
| `board state` | PGN дерева с ветками ученика (`{ученик}`), курсор, режим, id вариантов |
| `board delete nID` | удалить ветку |
```

- [ ] **Step 2: Переписать раздел «Доска» в `CLAUDE.md`**

Первый абзац раздела (про `preview_start`, `out/`, обновление раз в 2 секунды) заменить на:

```markdown
Доска - сервер в Docker с деревом ходов (`docker compose up board`, порт 8765). Показывай её во встроенном браузере Claude Desktop, а не в Chrome ученика: в первый раз за занятие запусти `preview_start` с именем `board` из `.claude/launch.json`. Вкладка получает изменения сама. Показывай доску, если обсуждение позиции длится дольше одного сообщения. Когда спрашиваешь «что бы ты сыграл?», стрелку лучшего хода не рисуй.

- Партию ставь через `coach board load --game ID --ply N`. Пока ученик думает над позицией, добавляй `--upto N`, чтобы продолжение партии не было видно.
- Продолжение партии и варианты добавляй через `coach board line` и показывай через `coach board goto`. Ученик листает их сам стрелками и кликами.
- `coach board mode free` даёт ученику листать и делать свои ходы. `coach board mode freeze` возвращает управление тебе, когда ты ведёшь показ сам.
- Ходы ученика видны в `coach board state` с пометкой `{ученик}`. Если ученик говорит, что попробовал вариант на доске, сначала прочитай `state`.
- Номера в `--ply`, `--upto`, `--at` и `goto N` в нумерации `review`: N - позиция перед полуходом N. Узлы вариантов адресуй по id из вывода `board line` или `board state`.
- Если сервер не запущен, `coach show` пишет `out/board.html`, как раньше. Тогда открывай превью `board-file`, страница обновляется каждые 2 секунды. `coach board ...` без сервера не работает.
```

Абзац «Ученику трудно держать в голове ходы...» заменить на:

```markdown
Ученику трудно держать в голове ходы, которых нет на доске. Продолжение партии и варианты не пересказывай нотацией: добавь их на доску (`board load` без `--upto` или `board line`) и поставь курсор на позицию, где принималось следующее решение. Больше двух-трёх ходов подряд без доски не называй.
```

Абзац «Не меняй позицию на доске...» оставить без изменений.

- [ ] **Step 3: Дополнить раздел «Файлы» в `CLAUDE.md`**

Перед строкой про `SETUP.md` добавить:

```markdown
- `web/` - доска: сервер Nest, клиент React, общие типы. `docker-compose.yml` - доска и её база. Тесты: `cd web && npm test`, `uv run pytest`.
```

- [ ] **Step 4: Добавить шаг «Доска» в `SETUP.md`**

Заголовок `## 5. Готово` переименовать в `## 6. Готово`, а перед ним вставить:

````markdown
## 5. Доска

Нужны Docker Desktop с Compose v2 и Node 24.21.0 (версия записана в `.node-version`, fnm переключается на неё сам; Node нужен для разработки и тестов доски, сама доска работает в Docker).

```bash
docker --version
docker compose version
node --version
docker compose build board
docker compose up -d board
curl -s http://127.0.0.1:8765/api/health
```

Ответ `{"ok":true}`. Остановить: `docker compose stop`. Дерево хранится в томе `chess-coach_board-mongo` и переживает перезапуск. `docker compose down -v` удаляет его вместе с томом. На занятии доску запускает `preview_start` с именем `board`.

Разработка доски:

```bash
cd web && npm ci && npm test
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo
cd web && npm run dev
```

Клиент с горячей перезагрузкой на `http://127.0.0.1:5173`, сервер на 8765, база на `127.0.0.1:27018`. Тесты Python: `uv run pytest`.
````

- [ ] **Step 5: Прогнать все тесты**

Run: `cd web && npm test`
Expected: сервер `Tests 42 passed (42)`, клиент `Tests 20 passed (20)`.

Run: `uv run pytest -q`
Expected: `13 passed`.

- [ ] **Step 6: Приёмка по сценарию из спецификации**

Позиция из занятия: otb-FqtJXvRK перед 43...Kf5. Проверено при подготовке плана: полуход 86 - это 43...Kf5, позиция перед ним `8/6pp/p7/1p1pk2P/1P2pNn1/P3P1P1/3K4/8 b - - 4 43`, вариант `Kd6 Ne2 Ne5 Nd4 Nc4+ Ke2` легален. Сценарий идёт вместе с учеником: он смотрит на доску и делает ходы сам. Проверки во встроенном браузере делай через `read_page` и `get_page_text`, скриншот только там, где нужен вид доски. По глобальной настройке пользователя не больше 5 обращений к браузеру за ход, дальше остановись и спроси.

1. Порт 8765 свободен (задача 6, шаг 3). `preview_start` с именем `board`. Ожидание: во встроенном браузере доска с плашкой режима.
2. `uv run coach board load --game otb-FqtJXvRK --ply 86 --upto 86`. Ожидание: вывод `loaded otb-FqtJXvRK: 85 plies, black at the bottom, cursor n... (position 86), ...`; на доске чёрные снизу, позиция перед 43...Kf5; «вперёд» и End не ведут дальше.
3. `uv run coach board mode free`. Ученик листает назад стрелкой влево до 39-го хода и возвращается клавишей End. Ожидание: курсор и доска меняются, плашка «Свободный просмотр».
4. Ученик перетаскивает короля e5 на d6. Ожидание: в списке появился ход 43...Kd6 цветом ученика с кнопкой удаления. `uv run coach board state` показывает `43. Kd2 Kd6 {ученик}`, а в списке `variations:` строку с id этого узла и пометкой `[student]`.
5. `uv run coach board line --at 86 --moves "Kd6 Ne2 Ne5 Nd4 Nc4+ Ke2"`. Ожидание: первая строка вывода - тот же id, что у хода ученика, с пометкой `(ученик)`. Второго хода Kd6 в списке нет.
6. `uv run coach board goto <id строки 45...Nc4+ из шага 5> --arrows c4a3,c4e3`. Ожидание: на доске конь на c4 и две синие стрелки на a3 и e3. Ученик листает вариант сам клавишами и кликами.
7. `uv run coach board mode freeze`. Ожидание: плашка «Заморожено тренером», фигуры не перетаскиваются, клики по ходам и клавиши ничего не делают, кнопка «перевернуть» работает.
8. `docker compose restart board`. Ожидание: плашка на несколько секунд «Нет связи, переподключаюсь…», затем то же дерево и та же позиция. `uv run coach board state` выводит то же, что до перезапуска.
9. `preview_stop` для `board` (или `docker compose stop board`), затем `uv run coach show --game otb-FqtJXvRK --ply 86`. Ожидание: `board server is not running: writing out/board.html (no live board)`; `preview_start` с именем `board-file` показывает эту позицию.

Если какой-то пункт не проходит, запиши, что именно видно, и не исправляй код в рамках этой задачи без согласования с учеником.

- [ ] **Step 7: Checkpoint**

Показать пользователю `git status` и `git diff --stat`, а также итог приёмки по пунктам 1-9. Не коммитить.
