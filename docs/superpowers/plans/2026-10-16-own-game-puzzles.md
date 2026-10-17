# Задачи из своих партий: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** моменты из разобранных партий ученика (упущенный удар, единственный ход) становятся задачами источника `games` в той же колоде FSRS, что книги и Lichess, и выдаются первыми.

**Architecture:** классы исхода и `compareMove` переезжают в `@board/shared` и получают нижний класс «проигрыш». Импорт `games` в `@board/puzzles` читает `data/reviews/*.json`, судит кандидатов теми же запросами к сервису движка, что доска, строит решение и пишет `PuzzleDoc`. Сервер доски ставит `games` первым и не фильтрует его темами по умолчанию. `coach review` после свежего разбора сам запускает импорт этой партии.

**Tech Stack:** TypeScript (Node, Nest, MongoDB, vitest, chess.js), Python 3 (`coach`, pytest). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-own-game-puzzles-design.md`

## Global Constraints

- Никаких `git commit` и `git push`: правило пользователя, каждый коммит только по явной просьбе. Шаги «Commit» в этом плане заменены на «не коммитить».
- Работа на `main` на месте, без веток и worktree. Новых зависимостей нет.
- Тексты для ученика по-русски, без символа длинного тире (только «-»).
- Пороги классов исхода: мат; выигрыш win% от 75; перевес от 60; равно от 40; хуже от 25; проигрыш - мат против решающего или win% меньше 25.
- Порог единственного хода - 15 пунктов win% (`DEFAULT_SOLVE.uniqueGap`); для мата - второй ход не даёт мат той же длины или короче.
- Импорт делает те же запросы, что доска: `multipv: 3`, сыгранный ход вне трёх линий - `searchmoves: [uci]`; `priority: "batch"`.
- Id задачи `games:<id партии>-<полуход, 3 цифры>`; id существующей задачи никогда не меняется.
- Карточки FSRS (коллекция `cards`) импорт не трогает.
- Тесты: `cd web && npm test`, `uv run pytest`. Типы: `cd web && npm run typecheck` (если скрипта в корне нет - `npm run typecheck -w <пакет>` для каждого затронутого пакета).

## Review Focus

- Повторный разбор старой партии или полный импорт после `--game`: id задачи с повторяющейся позицией не меняется, карточка FSRS остаётся привязанной. Тест в задаче 4.
- Партии вживую с одинаковой датой (`2025-11-09T00:00:00`): порядок выдачи и выбор «самой ранней партии» детерминированы (равенство дат - по id партии). Тесты в задачах 2 и 4.
- Сыгранный ход - рокировка или превращение (`e1g1`, `e7e8q`): кандидат проверяется без ошибки нелегальности. Тест в задаче 3.
- `compareMove` вызывается из клиента доски через `@board/shared`: в shared нельзя читать `process.env`. Тест в задаче 1 (импорт модуля без `process`).
- Запрос `next` без тем вообще (`themes` пустой): `games` всё равно первыми, книги и Lichess без фильтра тем, как сейчас. Тест в задаче 5.

---

### Task 1: Классы исхода в `@board/shared` с классом «проигрыш»; источник `games` в типах

**Files:**
- Create: `web/packages/shared/src/outcome.ts`, `web/packages/shared/src/outcome.spec.ts`
- Modify: `web/packages/shared/src/index.ts` (реэкспорт, `PuzzleSource`, `PuzzleDoc`)
- Modify: `web/packages/server/src/puzzles/judge.ts` (берёт классы из shared), `web/packages/server/src/puzzles/judge.spec.ts`

**Interfaces:**
- Produces (`@board/shared`):
  - `WIN = 75`, `ADVANTAGE = 60`, `EQUAL_LOW = 40`, `WORSE_LOW = 25`, `DEFAULT_EQUIV_GAP = 5`
  - `type OutcomeClass = 'mate' | 'winning' | 'advantage' | 'equal' | 'worse' | 'lost'`
  - `type MoveVerdict = 'equal' | 'better' | 'weaker' | 'wrong'`, `type Score = Pick<EngineLine, 'cp' | 'mate'>`
  - `outcomeClass(line: Score): OutcomeClass`
  - `compareMove(expected: Score, played: Score, equivGap: number = DEFAULT_EQUIV_GAP): MoveVerdict`
  - `OUTCOME_WORD: Record<OutcomeClass, string>` (`lost` -> `'проигрыш'`)
  - `PuzzleSource = 'lichess' | 'polgar' | 'raduga' | 'games'`
  - `PuzzleDoc` получает необязательные `gameId?: string; ply?: number; played?: string; gameDate?: string`
- `judge.ts` сохраняет свои экспорты (`compareMove(expected, played)` с `EQUIV_GAP` из `PUZZLE_EQUIV_GAP`, `outcomeClass`, типы), чтобы `puzzle-flow.ts`, `puzzle-solver.ts`, `puzzle-logic.ts` не менялись.

- [ ] **Step 1: Написать падающие тесты `outcome.spec.ts`**

```ts
it('lost: mate against the solver or win% below 25', () => {
  expect(outcomeClass({ mate: -3 })).toBe('lost');
  expect(outcomeClass({ cp: -400 })).toBe('lost');   // winPct ≈ 19
  expect(outcomeClass({ cp: -150 })).toBe('worse');  // winPct ≈ 36
});
it('boundary worse/lost is win% 25', () => { /* подобрать cp по winPct: чуть выше 25 -> worse, чуть ниже -> lost */ });
it('worse -> lost is wrong, lost -> lost (longer mate) is not wrong', () => {
  expect(compareMove({ cp: -150 }, { mate: -2 })).toBe('wrong');
  expect(compareMove({ cp: -500 }, { mate: -4 })).not.toBe('wrong');
});
it('equivGap is a parameter, default 5', () => {
  // один и тот же ход уступает 7 пунктов: при 5 - weaker, при 10 - equal
});
it('does not touch process.env', () => { /* vi.stubGlobal('process', undefined); динамический import('./outcome') не падает */ });
```

Плюс перенести из `judge.spec.ts` все проверки `outcomeClass` и `compareMove` (пять старых классов, мат короче и длиннее, `better`) в `outcome.spec.ts`.

- [ ] **Step 2: Запустить, убедиться, что падает:** `cd web && npx vitest run packages/shared/src/outcome.spec.ts` - FAIL, модуля нет.

- [ ] **Step 3: Реализовать `outcome.ts`** - код классов из `judge.ts` с `RANK = { lost: 0, worse: 1, equal: 2, advantage: 3, winning: 4, mate: 5 }`; мат против решающего (`mate < 0`) - `lost`. `judge.ts` импортирует всё из shared, `WORD` заменяется на `OUTCOME_WORD`, `compareMove` из `judge.ts` - обёртка `(e, p) => sharedCompare(e, p, EQUIV_GAP)`. Реэкспорт в `index.ts`, типы `PuzzleSource` и `PuzzleDoc`.

- [ ] **Step 4: Прогнать все тесты и типы:** `cd web && npm test` и проверка типов - PASS. Описания ошибок в `judge.spec.ts` с классом «хуже» не меняются; для позиции с оценкой ниже win% 25 текст теперь «(проигрыш)» - поправить ожидания этих тестов, если такие есть.

- [ ] **Step 5: Не коммитить.**

---

### Task 2: Кандидаты из разбора (чистые функции)

**Files:**
- Create: `web/packages/puzzles/src/games/review.ts`, `web/packages/puzzles/src/games/review.spec.ts`

**Interfaces:**
- Consumes: `PuzzleDoc` из задачи 1.
- Produces:

```ts
export interface ReviewMove { ply: number; color: 'white' | 'black'; san: string; uci: string; fen_before: string;
  class: 'ok' | 'inaccuracy' | 'mistake' | 'blunder'; missed_chance?: boolean }
export interface ReviewFile { id: string; meta: { color?: 'white' | 'black'; date?: string; opponent?: string }; moves: ReviewMove[] }
export interface Candidate { gameId: string; ply: number; fen: string; played: string; gameDate: string; ref: string }
export function candidatesOf(review: ReviewFile): Candidate[];          // бросает Error, если нет meta.color
export function puzzleId(gameId: string, ply: number): string;          // 'games:Mp0A6gfU-036'
export function gameRef(opponent: string | undefined, date: string, ply: number): string;
export function positionKey(fen: string): string;                       // первые 4 поля FEN
export function readReviews(dir: string, only?: string): { reviews: ReviewFile[]; bad: { file: string; detail: string }[] };
```

- [ ] **Step 1: Написать падающие тесты `review.spec.ts`**

```ts
it('takes mistakes, blunders and missed chances of the student only', () => {
  // ходы: белые blunder (ученик чёрными) - нет; чёрные mistake - да; чёрные inaccuracy - нет;
  // чёрные inaccuracy с missed_chance - да; чёрные blunder - да
});
it('puzzleId pads ply to three digits', () => expect(puzzleId('Mp0A6gfU', 36)).toBe('games:Mp0A6gfU-036'));
it('ref for black and white moves', () => {
  expect(gameRef('fishbate', '2026-09-21T15:01:19', 36)).toBe('Партия с fishbate, 21.09.2026, 18...');
  expect(gameRef('Хаглышов', '2025-11-09T00:00:00', 35)).toBe('Партия с Хаглышов, 09.11.2025, 18.');
});
it('ref without opponent', () => expect(gameRef(undefined, '2025-11-09T00:00:00', 1)).toBe('Партия, 09.11.2025, 1.'));
it('positionKey ignores move counters', () => { /* два FEN с разными halfmove/fullmove - один ключ */ });
it('throws without meta.color', () => { /* candidatesOf({...meta: {}}) бросает */ });
it('readReviews skips *.notes.json and reports broken JSON', () => { /* tmp dir: a.json, a.notes.json, b.json с мусором */ });
it('readReviews with only reads one file', () => { /* only = 'a' */ });
```

Полуход `ply` - нумерация `review`: ход `ply` делается из `fen_before`; номер хода в `ref` = `Math.ceil(ply / 2)`, `.` для нечётного `ply` (белые), `...` для чётного.

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/puzzles/src/games/review.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `review.ts`.** `gameDate` - `meta.date` как есть (ISO); нет даты - `'1970-01-01T00:00:00'`, в `ref` тогда без даты.
- [ ] **Step 4: Запустить тот же файл** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 3: Суд кандидата движком и решение

**Files:**
- Create: `web/packages/puzzles/src/games/judge.ts`, `web/packages/puzzles/src/games/judge.spec.ts`
- Modify: `web/packages/puzzles/src/report.ts` (новые причины)

**Interfaces:**
- Consumes: `Candidate` (задача 2); `compareMove`, `outcomeClass` (задача 1); `Engine`, `resolveSoft`, `extendLine`, `DEFAULT_SOLVE` из `../engine/solution.ts`; `materialBalance` не нужен.
- Produces:

```ts
export type JudgeResult =
  | { ok: true; fen: string; solution: string[]; themes: string[] }
  | { ok: false; reason: 'no_class_drop' | 'not_puzzle' | 'illegal_position' | 'engine_error'; detail: string };
export async function judgeCandidate(engine: Engine, c: Candidate, opts?: SolveOptions): Promise<JudgeResult>;
```

- `Reason` в `report.ts` пополняется: `no_class_drop: 'сыгранный ход не роняет класс'`, `not_puzzle: 'нет удара и нет единственного хода'`, `engine_error: 'ошибка движка'`, `bad_review: 'разбор не читается'`.

Алгоритм `judgeCandidate`:
1. `fen` и `played` легальны в chess.js, иначе `illegal_position`.
2. `lines = analyse(fen, { multipv: 3 })`; `best = lines[0]`; `playedLine = lines.find(move === played) ?? analyse(fen, { searchmoves: [played] })[0]`. Ход, который кончает партию ничьей, оценивается как `{ cp: 0 }`, матом - верным (тогда `no_class_drop`). Любое исключение движка - `engine_error` с текстом ошибки.
3. `compareMove(best, playedLine) !== 'wrong'` -> `no_class_drop`.
4. `strike = best.mate > 0 || outcomeClass(best) === 'winning'`; `only = isUnique(best, lines[1], 15)` (та же логика, что `isUnique` в `solution.ts`: экспортировать её оттуда). Ни то ни другое -> `not_puzzle`.
5. Решение: `strike` -> `resolveSoft(engine, fen, opts)` (вызывает `analyse` с `multipv: 1`); иначе `extendLine(engine, fen, opts)` (ход за ходом, пока ход решающего единственный). Если `extendLine` вернул пусто или его первый ход не `best.move` (у `extendLine` свой запрос `multipv: 2`, оценки могут чуть отличаться) - решение `[best.move]`.
6. Темы: всегда `ownGame`; `strike` -> `missedWin`; `only` -> `onlyMove`; `only && !strike` -> `defensiveMove`; `best.mate > 0` -> `mate`.

Все запросы `judgeCandidate` идут с `priority: 'batch'` (клиент создаётся с `priority: 'batch'` в задаче 4, здесь параметр не передаётся).

- [ ] **Step 1: Написать падающие тесты на `FakeEngine`**

```ts
it('same class as best -> no_class_drop', ...);                         // best cp 600, played cp 450: оба winning
it('missed strike: best wins, played equal -> soft line, themes ownGame+missedWin', ...);
it('defence: equal -> lost by played, second best also lost -> one move, themes ownGame+onlyMove+defensiveMove', ...);
it('worse -> mated by played is a puzzle (new lost class)', ...);       // best cp -150, played mate -2, second cp -600
it('close second and no win -> not_puzzle', ...);                       // best cp 150, second cp 120, played cp -10
it('mate strike gets theme mate', ...);
it('played move outside top 3 is asked with searchmoves', () => { /* проверить engine.calls */ });
it('castling and promotion played moves are legal', ...);               // e1g1, e7e8q
it('engine error -> engine_error, not thrown', ...);                     // FakeEngine без записи для searchmoves
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/puzzles/src/games/judge.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `judge.ts`, экспортировать `isUnique` из `solution.ts`, новые причины в `report.ts`.**
- [ ] **Step 4: Запустить тот же файл и `npm test -w @board/puzzles`** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 4: Импорт `games`: дедупликация, запись, удаление устаревших, команда CLI

**Files:**
- Create: `web/packages/puzzles/src/games/import.ts`, `web/packages/puzzles/src/games/import.spec.ts`
- Modify: `web/packages/puzzles/src/store.ts`, `web/packages/puzzles/src/cli.ts`

**Interfaces:**
- Consumes: задачи 2 и 3; `PuzzleStore`, `ImportReport`, `mapLimit`, `connectEngine`.
- Produces:

```ts
// store.ts
async gamesPuzzles(): Promise<PuzzleDoc[]>;                         // все задачи source 'games'
async removeGames(keep: string[], gameId?: string): Promise<number>; // удалить games-задачи (этой партии, если gameId) не из keep
// import.ts
export interface GamesImportOptions { game?: string; concurrency: number; onProgress?: (n: number) => void }
export async function importGames(reviews: ReviewFile[], engine: Engine, store: PuzzleStore, report: ImportReport,
  opts: GamesImportOptions): Promise<{ imported: number }>;
```

Алгоритм `importGames`:
1. Кандидаты всех разборов (разбор без `meta.color` - `report.reject(<file>, 'bad_review', ...)`). `report.total` - число кандидатов.
2. `mapLimit(candidates, opts.concurrency, judgeCandidate)`; отказ - `report.reject('<gameId> · <ply>', reason, detail)`; `engine_error` дополнительно запоминает id `puzzleId(gameId, ply)` в списке «не трогать».
3. Группировка прошедших по `positionKey(fen)`. Для каждого ключа: если в `store.gamesPuzzles()` есть задача с тем же ключом - берутся её `_id`, `ref`, `gameId`, `ply`, `played`; иначе от самой ранней партии (меньший `gameDate`, при равенстве меньший `gameId`). `gameDate` - максимум по группе и по существующей задаче. `fen`, `solution`, `themes` - от выбранного кандидата этой группы (того, чей `_id`; если он не из этого прогона - от самого раннего кандидата прогона).
4. `store.upsert(docs)` с `source: 'games'`, `solutionFrom: 'engine'`.
5. Удаление: `keep` = id записанных + id «не трогать» + id существующих задач, чьи позиции встречаются в прогоне. Без `game` - `removeGames(keep)`; с `game` - `removeGames(keep, game)`.
6. `report.imported`, `report.fromEngine` = число записанных.

Команда `games` в `cli.ts` по образцу `raduga`: `parseArgs` с `--game`; `readReviews(join(cfg.root, 'data/reviews'), game)`; `--game` без файла - ошибка `no review data/reviews/<id>.json`; `connectEngine()` (падает с подсказкой про `docker compose up -d engine`); `concurrency` = `health.workers` (как у «Радуги»); отчёт `report.write(booksDataDir(cfg))`. Итоговая строка, которую читает Python (задача 6), ровно:

```
games: <imported> puzzles from <reviews> reviews (<total> candidates, <rejected> rejected); report <path>
```

- [ ] **Step 1: Написать падающие тесты `import.spec.ts`** (Mongo из `testing/mongo.ts`, `FakeEngine`):

```ts
it('writes PuzzleDoc with source games, ref, gameId, ply, played, gameDate', ...);
it('same position in two games -> one puzzle, id of the earlier game, gameDate of the later', ...);
it('two OTB games with the same date -> earlier is the smaller game id', ...);
it('existing puzzle keeps its id when a newer game repeats the position (--game)', ...);
it('full run after --game keeps the existing id even if an earlier game has the position', ...);
it('full run removes stale games puzzles but never touches cards', ...);
it('--game removes only stale puzzles of that game', ...);
it('engine error keeps the previous puzzle of that candidate', ...);
it('rejections go to the report with reasons', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/puzzles/src/games/import.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `store.ts`, `import.ts`, команду `games` в `cli.ts`.**
- [ ] **Step 4: `npm test -w @board/puzzles`** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 5: Выдача на сервере доски

**Files:**
- Modify: `web/packages/server/src/puzzles/puzzle-logic.ts`, `puzzle-repository.ts`, `puzzles.service.ts`
- Test: `web/packages/server/src/puzzles/puzzle-logic.spec.ts`, e2e в `web/packages/server/test/` (файл с задачами, где сейчас проверяется выбор; если его нет - `puzzles-games.e2e.spec.ts` на `helpers.ts`)

**Interfaces:**
- Consumes: `PuzzleSource` с `games` (задача 1).
- Produces:
  - `SOURCES = ['lichess', 'polgar', 'raduga', 'games']`
  - `sourceOrder(attempts)` -> `['games', <книги по попыткам>, 'lichess']`
  - `interface NextQuery { id?: string; theme?: string; themes: string[]; source?: PuzzleSource; rating?: number }` - `theme` явная, `themes` по умолчанию; пустая строка `theme` = нет темы.
  - `puzzleFilter(q: { theme?: string; themes: string[] }, source: PuzzleSource | undefined, prefix = ''): Document` - явная тема фильтрует все источники; темы по умолчанию дают `$or: [{source: 'games'}, {themes: {$in}}]` (с префиксом); без тем - без фильтра тем. `disputed` как сейчас.
  - `repo.firstDue(now, q, source)` и `repo.firstNewBook(source, q, exclude)` принимают тот же `{ theme, themes }`; `repo.firstNewGames(q, exclude)` - сортировка `{ gameDate: -1, _id: 1 }`, диапазон `_id` `games:`..`games;`; индекс `{ source: 1, gameDate: -1 }`.
  - `puzzleLabel` для `games` - `ref`, как у книг (уже так, проверить тестом). `availableThemes` и `countsBySource` без изменений.

- [ ] **Step 1: Написать падающие тесты**

```ts
// puzzle-logic.spec.ts
it('sourceOrder puts games first', () => expect(sourceOrder({ polgar: 3 })).toEqual(['games', 'raduga', 'polgar', 'lichess']));
it('default themes do not filter games', ...);   // puzzleFilter({ themes: ['fork'] }, undefined) содержит $or с source games
it('explicit theme filters games too', ...);
// e2e
it('next with default themes gives a games puzzle before books', ...);
it('newer game first, then by ply', ...);
it('due games card is served despite default themes', ...);
it('explicit --theme fork skips games, defensiveMove serves games', ...);
it('source games serves only own puzzles; empty -> 404 no_puzzle', ...);
it('next without any themes still serves games first', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npm test -w @board/server` - новые тесты FAIL.
- [ ] **Step 3: Реализовать.** `parseNext` возвращает `theme` и `themes` раздельно; `puzzleLabel(puzzle, q.theme ? [q.theme] : q.themes)`; `pickNew`: `games` -> `firstNewGames`, `lichess` -> `sampleNewLichess(<темы для Lichess: theme ? [theme] : themes>, ...)`, книги -> `firstNewBook`.
- [ ] **Step 4: `cd web && npm test`** - PASS, типы чистые.
- [ ] **Step 5: Не коммитить.**

---

### Task 6: `coach`: импорт после разбора, `puzzles import-games`, `--source games`

**Files:**
- Create: `coach/gamespuzzles.py`
- Modify: `coach/cli.py` (`cmd_review`), `coach/puzzlescmd.py`
- Test: `tests/test_games_puzzles.py`, `tests/test_puzzles_cli.py`

**Interfaces:**
- Consumes: команда `npm run import -w @board/puzzles -- games [--game ID]` и её итоговая строка (задача 4).
- Produces:

```python
SUMMARY = re.compile(r"^games: (\d+) puzzles from (\d+) reviews")
def run_import(game: str | None = None, runner=subprocess.run) -> tuple[bool, str]:
    """npm run import ... в ROOT/'web', timeout 1800 с; (True, итоговая строка) или (False, причина: последняя строка stderr, 'npm not found', 'timeout')."""
def after_review(gid: str, runner=subprocess.run) -> None:
    """Печатает 'задач из партии: N' или 'задачи из партии не добавлены: <причина>. Повторить: uv run coach puzzles import-games'. Никогда не бросает."""
```

- `cmd_review` вызывает `after_review(gid)` только после свежего разбора (не в ветке «cached review»), после строки `Saved: ...`.
- `coach puzzles import-games` - `run_import()`; успех печатает итоговую строку импорта, неудача - причину в stderr и `SystemExit(1)`.
- `--source` у `puzzles next`: `choices=["games", "polgar", "raduga", "lichess"]`; подсказка `--id` дополняется примером `games:Mp0A6gfU-036`.

- [ ] **Step 1: Написать падающие тесты**

```python
def test_after_review_prints_count(capsys):        # runner -> returncode 0, stdout '...\ngames: 3 puzzles from 1 reviews (5 candidates, 2 rejected); report x'
    ... assert "задач из партии: 3" in out
def test_after_review_survives_failure(capsys):    # runner -> returncode 1, stderr 'запустите docker compose up -d engine'
    ... assert "import-games" in out               # и исключения нет
def test_after_review_survives_missing_npm(capsys):  # runner бросает FileNotFoundError
def test_run_import_passes_game_and_cwd():         # runner записывает args и cwd: [..., 'games', '--game', 'abc'], cwd == ROOT / 'web'
def test_import_games_command_exit_code(monkeypatch, capsys):
def test_cached_review_does_not_import(monkeypatch):  # cmd_review с существующим файлом разбора не зовёт after_review
def test_next_accepts_source_games(fake_board, cfg):
```

- [ ] **Step 2: Запустить:** `uv run pytest tests/test_games_puzzles.py tests/test_puzzles_cli.py -q` - FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: `uv run pytest -q`** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 7: Документы, наполнение колоды и приёмка

**Files:**
- Modify: `CLAUDE.md`, `SETUP.md`, `ROADMAP.md`

- [ ] **Step 1: Документы.**
  - `CLAUDE.md`, раздел «Задачи»: задачи из своих партий (источник `games`, что становится задачей, импорт сам после `coach review`, `coach puzzles import-games` для наполнения и повтора), порядок выдачи «свои партии, книги, Lichess», темы по умолчанию к своим не применяются, класс «проигрыш». В таблицу команд - `puzzles import-games` и `--source games`. Упражнения на занятии можно давать через `coach puzzles next --id games:<id>-<полуход>`.
  - `SETUP.md`: шаг начального наполнения (`docker compose up -d engine`, затем `uv run coach puzzles import-games`).
  - `ROADMAP.md`: пункт «Задачи из своих партий - готово (дата)» в этапе 3 со ссылкой на спецификацию и план; из пункта «Задачи v2» убрать «Осталось: задачи из своих партий».
- [ ] **Step 2: Полный прогон тестов:** `cd web && npm test`, `uv run pytest -q`, проверка типов - всё PASS.
- [ ] **Step 3: Приёмка 1.** `docker compose up -d engine board`, пересобрать образ `board` (сервер изменился), `uv run coach puzzles import-games`. Ожидается итоговая строка и отчёт `data/books/import-games.md` с числом задач и причинами отказа. Записать число задач в журнал.
- [ ] **Step 4: Приёмка 2-3 во встроенном браузере** (превью `board`, бюджет браузерных вызовов из глобальных правил). 10 случайных id из отчёта через `coach puzzles next --id ...`: позиция из партии, сыгранный в партии ход даёт ошибку с опровержением, ход решения - «Верно». Затем `coach puzzles next` с темами по умолчанию даёт задачу `games:`, плашка с партией и ходом. Состояние проверять через `coach board state`, скриншоты - только как доказательство.
- [ ] **Step 5: Приёмка 4-5.** `uv run coach review <id ещё не разобранной блиц-партии>` - строка «задач из партии: N», задачи в базе. `docker compose stop engine`, `uv run coach review <другой id> --force` - разбор завершается, печатается подсказка про `import-games`. Вернуть `docker compose up -d engine`.
- [ ] **Step 6: Не коммитить.** Отчитаться списком решений, принятых без ученика (раздел спецификации плюс решения исполнителей из журнала).
