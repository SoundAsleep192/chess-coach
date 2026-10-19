# Занятия у доски: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** разбор идёт у доски: помощник на хосте ведёт серию позиций по карточке основного тренера, на каждый ход ученика сразу показывает вердикт движка и отвечает одной-двумя фразами с действием на доске, а модель (Haiku на подписке) зовёт только там, где не хватает правил.

**Architecture:** сервер доски получает режим `lesson`: хранит видимое состояние занятия (`BoardState.lesson`), принимает ход, фразу или кнопку ученика как одно ожидающее событие и применяет ответ помощника из закрытого списка действий. Помощник - новый пакет `@board/lessons` на TypeScript, работает на хосте отдельным отвязанным процессом: читает проверенную карточку из `data/lessons/`, слушает доску по WebSocket, решает правилами (карточка, вердикт сервиса движка, тактические факты), а модель вызывает через Claude Code на подписке способом, выбранным по замеру в задаче 1. Основной тренер пишет карточку, проверяет её `coach lesson check`, запускает `coach lesson start`; строки занятия приходят к нему через очередь `coach inbox`, полный журнал - `coach lesson journal`.

**Tech Stack:** TypeScript 7 (Node 24, Nest 12, React 19, vitest 5, chess.js 1.4.0, ws 8.22.0), Claude Code 2.1.300 (`claude -p`) или `@anthropic-ai/claude-agent-sdk` 0.3.302 по итогам задачи 1, MongoDB 9, Python 3 (`coach`, только пересылка аргументов).

**Spec:** `docs/superpowers/specs/2026-10-18-board-lessons-design.md`

## Как исполнять

- Задачи 1 и 2 идут с учеником в основной сессии, не субагентами. Каждая кончается остановкой: дальше по плану только после ответа ученика. Итоги обеих записываются в `docs/superpowers/plans/2026-10-18-board-lessons-probe.md`, задачи 3, 5, 6, 7, 11, 12 и 14 читают их оттуда.
- Ветка доски (задачи 3-6) и ветка помощника (задачи 7-11) не трогают общих файлов, кроме задачи 3, и после неё могут идти параллельно. Задача 12 собирает обе ветки, 13 и 14 идут последними.

## Global Constraints

- Никаких `git commit` и `git push`: правило ученика, каждый коммит только по явной просьбе. Шаги «Commit» заменены на «не коммитить».
- Работа на `main` в общей папке, без веток и worktree. Рядом может работать другая сессия: трогать только файлы своей задачи.
- Помощник пишется на TypeScript в `web/packages/lessons` и запускается на хосте, не в Docker: ему нужен вход ученика в Claude Code. Ключа API нет, всё на подписке. Новых сервисов на Python нет, `coach lesson` только пересылает аргументы в пакет.
- Модель вызывается только из помощника и только изолированно: без настроек, хуков, плагинов, MCP, CLAUDE.md и инструментов, рабочая папка вне репозитория (`<os.tmpdir()>/chess-coach-lesson`), без переменной `CLAUDECODE` в окружении (и без тех, что найдёт задача 1). Причина: `claude -p` в папке проекта запускает хук `UserPromptSubmit` из `.claude/settings.json` (`coach inbox --hook`) и отмечает прочитанной очередь ученика. Флаг `--bare` не подходит: в нём Claude Code не читает вход по подписке, только `ANTHROPIC_API_KEY`.
- Проверено локально 2026-10-18 по `claude --help` (2.1.300): `-p`, `--model`, `--system-prompt`, `--tools ""`, `--safe-mode`, `--setting-sources`, `--strict-mcp-config`, `--no-session-persistence`, `--output-format json|stream-json`, `--input-format stream-json`, `--json-schema`. По документации, без запуска: Agent SDK `query({ prompt: AsyncIterable<SDKUserMessage>, options })` с `model`, `systemPrompt` (строка), `tools: []`, `settingSources: []`, `persistSession: false`, `outputFormat: { type: 'json_schema', schema }`, `cwd`, `env`, метод `close()`. Флаги меняются между версиями: задачи 1 и 11 сверяются с `claude --help` и справочником SDK заново.
- Политика входа: документация SDK запрещает сторонним продуктам предлагать вход claude.ai. Здесь ученик пользуется своим входом на своём Маке для себя. Для этапа 4 (несколько учеников) понадобится ключ API, в этот план это не входит.
- Реплика тренера у доски: не больше 2 предложений и 240 символов. Фраза ученика: 1-500 символов после обрезки пробелов. История позиции на сервере: не больше 40 записей.
- Помощник утверждает только факты из трёх источников: карточка, вердикт движка, тактические факты (задача 9). Ход соперника с подвохом берётся только из карточки, иначе соперник ходит лучшим ходом движка. Пока ученик думает над ходом и пока тренер отвечает, оценки, линий движка и стрелки лучшего хода нет; лучший ход не называется, пока ученик его не нашёл. Полоса движка в занятии открывается вместе с вердиктом (дизайн страницы в файле итогов, раздел «Страница»).
- К ученику тренер обращается на «ты», как в образце дизайна. Тексты по-русски, ходы в SAN с номерами (`25.Nd3`, `25...Rd8`), без символа длинного тире.
- Оценки в текстах для ученика - с его стороны. Сервис движка отдаёт их со стороны ходящего.
- Запросы к движку: помощник - `multipv: 3`, ход вне тройки - отдельно с `searchmoves: [uci]`, приоритет `interactive`; `lesson check` - то же с приоритетом `batch`. Классы исхода и `compareMove` из `@board/shared` (выигрыш от 75 win%, перевес от 60, равно от 40, хуже от 25, «слабее» - уступает 5 пунктов и больше).
- Единственный ход - вторая линия уступает 15 пунктов win% и больше, как `DEFAULT_SOLVE.uniqueGap`.
- Таймауты помощника: модель `LESSON_MODEL_TIMEOUT_MS` (20000 по умолчанию, значение уточняет задача 1), движок 10000. Ответ с ходом соперника уходит не раньше чем через 400 мс после хода ученика, чтобы ученик успел увидеть свой ход.
- Каталог `data/lessons/` (карточки, журналы, лог и pid помощника) в git не идёт.
- Тесты: `cd web && npm test`, `cd web && npm run typecheck`, `uv run pytest`. `raduga.books.spec.ts` медленный и к плану не относится.

## Review Focus

1. Помощник не запущен или упал, а доска в режиме занятия: ученик не застревает в «тренер отвечает…», страница пишет, что помощник не подключён и надо написать тренеру в чат, ход и поле ввода выключены. Тесты в задачах 5 и 6.
2. Ученик написал в чат посреди серии, основной тренер по привычке зовёт `coach board load`, `coach show` или `coach puzzles next`: сервер отказывает с подсказкой `coach lesson stop`, занятие продолжается. Тест в задаче 5.
3. Модель вернула не JSON, длинную реплику, ход или оценку, которых нет в контексте, назвала лучший ход до того, как ученик его нашёл, или не ответила за таймаут: ученик получает заготовленную реплику, повторного вызова нет, журнал пишет причину. Тесты в задаче 11.
4. Сервис движка упал посреди занятия: ходы из карточки отвечаются как обычно, ход вне карточки возвращается с «Не могу проверить ход: движок недоступен», помощник не падает. Тест в задаче 12.
5. Вызов модели из помощника не запускает хук `coach inbox --hook` и не съедает очередь ученика. Тест в задаче 11 (аргументы и окружение запуска), живая проверка в задаче 1.

---

## Карта файлов

| Файл | Что | Задача |
|---|---|---|
| `out/lesson-probe/*`, `web/packages/client/proto.html`, `web/packages/client/src/proto/*` | выбрасываемые замер, проба и прототип | 1, 2 |
| `docs/superpowers/plans/2026-10-18-board-lessons-probe.md` | итоги замера и прототипа, решения ученика | 1, 2 |
| `web/packages/shared/src/lesson.ts`, `index.ts`, `validate.ts` (+ `.spec.ts`) | типы и валидаторы занятия | 3 |
| `web/packages/server/src/lesson/lesson-flow.ts` (+ `.spec.ts`) | переходы занятия, чистые функции | 4 |
| `web/packages/server/src/lesson/lesson.controller.ts`, `board/board.service.ts`, `board/board.gateway.ts`, `inbox/inbox-format.ts`, `inbox/inbox.service.ts`, `app.module.ts`, `test/lesson.e2e.spec.ts` | API, WebSocket, защита доски, очередь | 5 |
| `web/packages/client/src/LessonPanel.tsx` (+ `.test.tsx`), `banner.ts`, `App.tsx`, `styles.css` | занятие на странице доски | 6 |
| `web/packages/lessons/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/root.ts`, `src/engine.ts`, `src/chess-utils.ts`, `src/card.ts`, `src/review.ts`, `src/testing/fake-engine.ts`, `.gitignore` | пакет помощника, карточка, позиция из разбора | 7 |
| `web/packages/lessons/src/check.ts` | проверка карточки движком | 8 |
| `web/packages/lessons/src/tactics.ts` | тактические факты | 9 |
| `web/packages/lessons/src/verdict.ts`, `src/rules.ts` | вердикт хода, правила | 10 |
| `web/packages/lessons/src/settings.ts`, `src/model/*` | настройки из замера, контекст, ответ, запуск модели | 11 |
| `web/packages/lessons/src/board-link.ts`, `src/session.ts`, `src/journal.ts`, `src/cli.ts` | помощник целиком, команды | 12 |
| `coach/lessoncmd.py`, `coach/cli.py`, `coach/boardcmd.py`, `tests/test_lesson_cli.py`, `tests/test_board_cli.py` | `coach lesson`, строка занятия в `board state` | 13 |
| `.claude/skills/board-lesson/SKILL.md`, `CLAUDE.md`, `ROADMAP.md`, `SETUP.md` | документы, скилл основного тренера | 14 |

---

### Task 1: Замер скорости модели и проба на доске (с учеником, остановка А)

**Files:**
- Create (выбрасываются в конце задачи): `out/lesson-probe/` - `system.txt`, `context.txt`, `oneshot.ts`, `stream.ts`, `sdk.ts`, `detach.ts`, `loop.ts`, `live.ts`, свой `package.json` для SDK
- Create: `docs/superpowers/plans/2026-10-18-board-lessons-probe.md`

**Interfaces:**
- Produces (раздел «Замер» в файле итогов, его читают задачи 11, 12, 14): способ вызова `oneshot` | `stream` | `sdk`; точные флаги или опции, проверенные на этой машине; модель (алиас или полное имя); нужен ли `--json-schema` / `outputFormat`; значение `LESSON_MODEL_TIMEOUT_MS`; переменные окружения, которые надо убрать; откуда запускать помощника (из Bash сессии или из терминала ученика); политика `modelExplainsWrong: boolean`; дословный ответ ученика о скорости.

- [ ] **Step 1: Свериться с документацией.** `claude --version`, `claude --help`, страницы `https://code.claude.com/docs/en/headless`, `https://code.claude.com/docs/en/agent-sdk/typescript`, `https://code.claude.com/docs/en/agent-sdk/overview`, `npm view @anthropic-ai/claude-agent-sdk version`. Расхождения с Global Constraints записать в файл итогов.

- [ ] **Step 2: Контекст замера.** `context.txt` - типичный запрос помощника по позиции 185135620088 · 49 (ход 25.Nd3 из дизайна), собранный руками по формату задачи 11: привычка, задание, идея, ожидаемые ходы с оценками из `coach analyze --game 185135620088 --ply 49 --multipv 3`, вердикт, три тактических факта, четыре реплики, фраза ученика «Он закрывает короля и нападает на ферзя, и ничего не висит». `system.txt` - черновик системной подсказки по требованиям задачи 11. Ответ - JSON `{ say, action, note? }` из задачи 11.

- [ ] **Step 3: Одиночный вызов с запуском (`oneshot.ts`).** 10 запусков подряд, каждый - новый процесс, `cwd` - пустая `os.tmpdir()/chess-coach-lesson`, окружение без `CLAUDECODE`:

```bash
claude -p --model haiku --safe-mode --tools "" --no-session-persistence \
  --system-prompt "$(cat system.txt)" --output-format json --json-schema "$(cat schema.json)" < context.txt
```

Мерить время от запуска до разобранного ответа (p50, p90), `duration_ms` и `duration_api_ms` из JSON, модель из `modelUsage`, долю ответов, прошедших схему. Второй прогон без `--json-schema` (JSON по просьбе в подсказке). Если `--safe-mode` не сочетается с `--system-prompt` или алиас `haiku` не принят, пробовать `--setting-sources ""` с `--strict-mcp-config` и полное имя `claude-haiku-5-5`; в итоги - то, что сработало.

- [ ] **Step 4: Изоляция.** Один вызов с `--output-format stream-json --verbose`: в событии `system/init` пустые `tools`, `plugins`, `mcp_servers`, событий хуков нет. Затем ход на доске в свободном режиме, вызов модели, `uv run coach inbox --peek` - ход всё ещё в очереди.

- [ ] **Step 5: Постоянная сессия через CLI (`stream.ts`).** Один процесс `claude -p --input-format stream-json --output-format stream-json --verbose` с флагами шага 3; 10 запросов по одному, время до события `result` для каждого. Отдельно: первый запрос (с запуском) и цена сброса (закрыть процесс, открыть новый, первый запрос).

- [ ] **Step 6: Постоянная сессия через Agent SDK (`sdk.ts`).** В `out/lesson-probe` (вне workspace `web/`) `npm i @anthropic-ai/claude-agent-sdk@0.3.302`. `query({ prompt: <AsyncIterable из очереди>, options: { model, systemPrompt: <строка>, tools: [], settingSources: [], persistSession: false, cwd, env: <process.env без CLAUDECODE>, outputFormat } })`, запуск через `env -u ANTHROPIC_API_KEY`: вход должен пройти по подписке. Те же замеры, что в шаге 5, сброс - `close()` и новый `query()`. В итоги: что `system/init` говорит о входе и версии встроенного Claude Code.

- [ ] **Step 7: Жизнь фонового процесса (`detach.ts`).** Из инструмента Bash сессии Claude Code: `node detach.ts` порождает `loop.ts` через `spawn(process.execPath, ['loop.ts'], { detached: true, stdio: ['ignore', log, log] }).unref()` и сразу выходит; `loop.ts` 5 минут раз в 30 с вызывает модель лучшим вариантом шагов 3-6. Проверить: процесс жив после конца вызова Bash и после конца хода Claude, вызовы проходят (песочница, вход, вложенный `claude`). Если нет - то же из терминала ученика; в итоги - откуда запускать помощника.

- [ ] **Step 8: Проба на живой доске с учеником (`live.ts`).** `docker compose up -d engine board`, превью `board`, `uv run coach board load --game 185135620088 --ply 49`, `uv run coach board mode free`. Скрипт слушает `ws://127.0.0.1:8765/ws`; на каждый новый узел ученика сразу пишет в заметку панели (`PATCH /api/board/panel { note }`) вердикт движка (`EngineClient` из `@board/shared` по относительному пути, `compareMove` с лучшей линией), например «25.Nd3 - верно (выигрыш). Тренер думает…», затем ответ модели самым быстрым вариантом в ту же заметку. Ученик делает 5-10 ходов и говорит, приемлема ли скорость. Поля ввода на странице ещё нет, поэтому фразы в пробе не участвуют: их задержка - тот же вызов модели. Заметку после пробы снять (`uv run coach board note --clear`).

- [ ] **Step 9: Итоги и остановка А.** В файл итогов - таблица (способ × p50 × p90 × первый вызов × сброс × доля валидных ответов) и предложение: способ вызова и `modelExplainsWrong` (`true` - модель коротко объясняет ошибку вне карточки, правило R6; `false` - сухой режим: R6 отвечает шаблоном, модель остаётся только для фраз ученика и ответов на «почему», R10, R11, R14). Остальные случаи в любом режиме решают правила задачи 10. Показать ученику таблицу и предложение, дождаться ответа, записать его дословно. Удалить `out/lesson-probe/`. Не коммитить.

---

### Task 2: Черновой прототип страницы (с учеником, остановка Б)

**Files:**
- Create (выбрасываются в конце задачи): `web/packages/client/proto.html`, `web/packages/client/src/proto/main.tsx`, `web/packages/client/src/proto/variants.tsx`
- Modify временно: `.claude/launch.json` (конфигурация `board-proto`)
- Modify: `docs/superpowers/plans/2026-10-18-board-lessons-probe.md` (раздел «Страница»)

**Interfaces:**
- Produces (раздел «Страница» в файле итогов, его читает задача 6): одобренный дизайн из Claude Design (`Занятие у доски.dc.html`) вместо скриншота `out/lesson-proto.png`, правила раскладки, состояния, кнопки, полоса движка и что это меняет в задачах 3, 5 и 6.

- [x] **Step 1: Прототип.** `proto.html` и `src/proto/main.tsx` рисуют настоящий `BoardView` с живым состоянием из `useBoardSocket` (Vite проксирует `/ws` на 8765) и 2-3 варианта расположения по `?v=a|b|c`: (a) колонка справа вместо списка ходов: последняя реплика крупно сверху, история ниже, поле ответа внизу, список ходов свёрнут; (b) реплика пузырём над доской, история и поле под доской; (c) реплика и поле под доской, список ходов справа как сейчас. Во всех вариантах есть всё из раздела «Страница доски» дизайна; данные - поддельная история реплик, кнопка в углу листает состояния: ждём ход, тренер отвечает, вердикт «верно», ошибка с «Ещё раз», конец позиции с «Дальше», конец серии с предложением вернуться в чат, помощник не подключён. Сервер не меняется.
- [x] **Step 2: Запуск.** Добавить в `.claude/launch.json` конфигурацию `board-proto` (`npm run dev -w @board/client` в `web`, порт 5173), `preview_start board-proto`, открыть `/proto.html?v=a`. Бюджет браузерных вызовов - по глобальным правилам, скриншоты только как доказательство.
- [x] **Step 3: Остановка Б.** Показать ученику варианты, дождаться выбора или правок (можно переставить элементы и показать ещё раз), записать решение и скриншот `out/lesson-proto.png`.
- [x] **Step 4: Убрать прототип.** Удалить `proto.html` и `src/proto/`, убрать `board-proto` из `.claude/launch.json`. `git status` не показывает изменений этой задачи в `web/packages/client` и `.claude/`. Не коммитить.

---

### Task 3: Общие типы и валидаторы занятия

**Files:**
- Create: `web/packages/shared/src/lesson.ts`
- Modify: `web/packages/shared/src/index.ts`, `web/packages/shared/src/validate.ts`
- Test: `web/packages/shared/src/validate.spec.ts`, `web/packages/shared/src/lesson.spec.ts`

**Interfaces:**
- Produces (`@board/shared`):

```ts
// lesson.ts
export const LESSON_SAY_MAX = 240;
export const LESSON_SENTENCES_MAX = 2;
export const STUDENT_SAY_MAX = 500;
export const LESSON_TRANSCRIPT_MAX = 40;
export type LessonPhase = 'student' | 'coach' | 'feedback' | 'pause' | 'done';
export type LessonStatus = 'running' | 'done' | 'stopped';
export type LessonVerdictKind = 'correct' | 'weaker' | 'wrong' | 'unavailable' | 'info';
export interface LessonVerdict { kind: LessonVerdictKind; text: string }
export interface LessonEntry { who: 'coach' | 'student'; kind: 'say' | 'move' | 'verdict'; text: string; at: string }
export type LessonInput =
  | { id: number; kind: 'move'; node: NodeId; uci: string; san: string; resume: 'student' }
  | { id: number; kind: 'say'; text: string; resume: 'student' | 'feedback' | 'pause' }
  | { id: number; kind: 'next'; resume: 'pause' };
export interface LessonPositionSetup {
  fen: string; orientation: Orientation; label: string; context: string; task: string; gameId?: string; ply?: number;
  /** Игроки и ходы партии в SAN до позиции занятия: список «Ходы партии» на странице. */
  game?: LessonGame;
}
export interface LessonGame { white: string; black: string; moves: string[] }
/** Видимое состояние занятия. node - узел главной линии, от которого принимается ход ученика. */
export interface LessonView {
  lessonId: string; title: string; status: LessonStatus;
  index: number; total: number; label: string;
  phase: LessonPhase; node: NodeId;
  pending?: LessonInput; verdict?: LessonVerdict;
  transcript: LessonEntry[]; seq: number; online: boolean; summary?: string;
  game?: LessonGame;
}
export type LessonAction =
  | { type: 'none' }
  | { type: 'ask' }
  | { type: 'play'; uci: string }
  | { type: 'line'; from: NodeId; moves: string[]; arrows?: Arrow[]; then: 'feedback' | 'pause' }
  | { type: 'arrows'; arrows: Arrow[] }
  | { type: 'back' }
  | { type: 'feedback'; arrows?: Arrow[] }
  | { type: 'pause' }
  | { type: 'position'; index: number; position: LessonPositionSetup }
  | { type: 'end'; summary: string; stats: { modelCalls: number; fallbacks: number } };
export interface LessonStartBody { lessonId: string; title: string; total: number; index: number; intro?: string; position: LessonPositionSetup }
export interface LessonVerdictBody { inputId: number; verdict: LessonVerdict }
export interface LessonReplyBody { inputId: number; say?: string; verdict?: LessonVerdict; accept?: boolean; action: LessonAction; note?: string }
export interface LessonSayData { text: string }
/** Границы предложений: [.!?…]+, за которыми пробел или конец текста; хвост без знака - тоже предложение. */
export function countSentences(text: string): number;
```

- `index.ts`: `Mode` получает `'lesson'`; `ErrorCode` - `'stale'` (ответ на уже обработанное событие); `InboxKind` - `'lesson'`; `BoardState.lesson?: LessonView`; `ClientMessage` - `{ event: 'lessonSay'; data: LessonSayData }`, `{ event: 'lessonRetry'; data: Record<string, never> }`, `{ event: 'lessonNext'; data: Record<string, never> }`; реэкспорт `./lesson.ts`.
- `validate.ts`: `validateLessonStartBody`, `validateLessonVerdictBody`, `validateLessonReplyBody`, `validateLessonSay` по образцу существующих (`string | null`). `say`, `intro`, `summary`, `context`, `task` проверяются на `LESSON_SAY_MAX` и `countSentences <= LESSON_SENTENCES_MAX`, кроме `context` и `task` (только длина 500). `moves` в `line` - SAN или UCI, как `AddLineBody.moves`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('countSentences', () => {
  expect(countSentences('Хороший ход! Почему именно его?')).toBe(2);
  expect(countSentences('После 25.Nd3 конь связан.')).toBe(1);
  expect(countSentences('Оценка +1.2, было +3.0. Дальше')).toBe(2);
  expect(countSentences('')).toBe(0);
});
it('reply body: valid play, line, end', ...);
it('reply body: say of 241 chars is rejected', ...);
it('reply body: three sentences are rejected', ...);
it('reply body: unknown action type, play without uci, line with empty moves, then outside feedback|pause', ...);
it('reply body: inputId must be a positive integer', ...);
it('start body: needs lessonId, title, total >= 1, 0 <= index < total, position.fen', ...);
it('say: empty after trim and 501 chars are rejected', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/shared` - FAIL.
- [ ] **Step 3: Реализовать `lesson.ts`, правки `index.ts` и `validate.ts`.**
- [ ] **Step 4: Запустить:** `cd web && npm test -w @board/shared && npm run typecheck` - PASS (сервер и клиент компилируются: новые члены союзов пока не используются).
- [ ] **Step 5: Не коммитить.**

---

### Task 4: Сервер: переходы занятия (чистые функции)

**Files:**
- Create: `web/packages/server/src/lesson/lesson-flow.ts`, `web/packages/server/src/lesson/lesson-flow.spec.ts`

**Interfaces:**
- Consumes: типы задачи 3; `fromGame`, `addMove`, `addLine` из `tree/tree.ts`; `treeOf` из `puzzles/puzzle-flow.ts`; `moveToken` из `inbox/inbox-format.ts`; `BoardError`.
- Produces:

```ts
export const LESSON_RUNNING = 'a lesson is running: stop it first with coach lesson stop';
export function isLessonRunning(s: BoardState): boolean;          // mode 'lesson' и status 'running'
export function startLesson(s: BoardState, b: LessonStartBody, now: Date): BoardState;
export function lessonMove(s: BoardState, parentId: NodeId, uci: string, now: Date): BoardState;
export function lessonSay(s: BoardState, text: string, now: Date): BoardState;
export function lessonNext(s: BoardState, now: Date): BoardState;
export function lessonRetry(s: BoardState): BoardState;
export function applyLessonVerdict(s: BoardState, b: LessonVerdictBody, now: Date): BoardState;
export function applyLessonReply(s: BoardState, b: LessonReplyBody, now: Date): BoardState;
export function stopLesson(s: BoardState, now: Date): BoardState;
export function setAssistantOnline(s: BoardState, online: boolean): BoardState;
```

Правила переходов (это контракт с помощником):

| Функция | Когда можно | Что делает |
|---|---|---|
| `startLesson` | всегда (повторный старт = продолжение) | `mode: 'lesson'`, дерево из `position.fen` (`seqStart: s.seq`), курсор и `node` в корне, `orientation` из позиции, `panel: PANEL_OFF`, `puzzle: undefined`, `treeEpoch + 1`, `meta.title = title`; `lesson` = `running`, `phase: 'student'`, `seq` сохраняется из старого `lesson` того же `lessonId` или 0, `online` сохраняется; история: `intro` (если есть), `context`, `task` как реплики тренера |
| `lessonMove` | `phase: 'student'`, `parentId === lesson.node`, курсор на `node` | ход ученика (`author: 'student'`), курсор на новый узел, `pending: { kind: 'move', id: seq + 1, ... }`, `seq + 1`, `phase: 'coach'`, в историю `moveToken(...)`; иначе `BoardError('frozen', ...)` |
| `lessonSay` | `phase` `student`, `feedback` или `pause` | `pending: { kind: 'say', resume: <фаза> }`, `phase: 'coach'`, в историю фраза ученика (обрезанная, 1-500 символов, иначе `bad_request`) |
| `lessonNext` | `phase: 'pause'` | `pending: { kind: 'next' }`, `phase: 'coach'` |
| `lessonRetry` | `phase: 'feedback'` | курсор на `node`, `phase: 'student'`, `verdict: undefined` |
| `applyLessonVerdict` | `phase: 'coach'`, `pending.id === inputId` | `verdict`, запись `verdict` в историю; иначе `BoardError('stale', ...)` |
| `applyLessonReply` | `phase: 'coach'`, `pending.id === inputId` | применяет действие (таблица ниже), `say` и `verdict` (если ещё не было) в историю, `pending: undefined`; чужой `inputId` - `stale` |
| `stopLesson` | `status: 'running'` | `mode: 'free'`, `status: 'stopped'`, `pending: undefined` |
| `setAssistantOnline` | есть `lesson` | `online` |

Действия ответа (`accept: true` у хода сначала делает `node = pending.node`; без `accept` ход остаётся боковой веткой):

| Действие | Для какого события | Итог |
|---|---|---|
| `none` | `say`, `next` | `phase = pending.resume`; для `move` - `bad_request` |
| `ask` | `move` с `accept`, `say` | `phase: 'student'`, курсор на `node` |
| `play { uci }` | любое | ход тренера (`author: 'coach'`) от `node`, `node` и курсор на него, `phase: 'student'` |
| `line { from, moves, arrows, then }` | любое | вариант тренера от `from`, курсор на конец, стрелки на нём, `phase = then` |
| `arrows { arrows }` | `say` | стрелки на узле курсора, `phase = pending.resume` |
| `back` | `move` без `accept`, `say` | курсор на `node`, `phase: 'student'` |
| `feedback { arrows }` | `move` без `accept` | курсор остаётся на ходе ученика, стрелки на нём, `phase: 'feedback'` |
| `pause` | любое | `phase: 'pause'` |
| `position { index, position }` | любое | новая позиция как в `startLesson`, история с нуля (`context`, `task`), `index`, `label` |
| `end { summary, stats }` | любое | `status: 'done'`, `phase: 'done'`, `mode: 'free'`, `summary` |

История обрезается до последних `LESSON_TRANSCRIPT_MAX` записей.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('start: mode lesson, tree from fen, panel off, intro+context+task in transcript, phase student', ...);
it('start again with the same lessonId keeps seq (resume), new id starts from 0', ...);
it('move: only in phase student and only from lesson.node; second move while coach thinks is frozen', ...);
it('move: pending has id seq+1, san, resume student; transcript has "25.Nd3"', ...);
it('say: allowed in student, feedback, pause; resume remembers the phase; empty and 501 chars -> bad_request', ...);
it('verdict and reply with a stale inputId -> stale, state unchanged', ...);
it('reply accept + play: node moves to the student move, then to the coach move', ...);
it('reply without accept + feedback: cursor on the student move, retry returns to node', ...);
it('reply line then feedback: coach line added from the student move, cursor at its end with arrows', ...);
it('reply none to a move -> bad_request', ...);
it('demo move after ask (no accept) + play: coach move from node, the demo stays a side branch', ...);
it('position: new tree, transcript reset, index set, seq kept', ...);
it('end: status done, mode free, summary set; stop: status stopped, mode free', ...);
it('transcript keeps the last 40 entries', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/server/src/lesson` - FAIL.
- [ ] **Step 3: Реализовать `lesson-flow.ts`.**
- [ ] **Step 4: Запустить тот же файл** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 5: Сервер: API, WebSocket, защита доски, очередь

**Files:**
- Create: `web/packages/server/src/lesson/lesson.controller.ts`, `web/packages/server/test/lesson.e2e.spec.ts`
- Modify: `web/packages/server/src/board/board.service.ts`, `board/board.gateway.ts`, `panel/panel.service.ts`, `inbox/inbox-format.ts`, `inbox/inbox.service.ts`, `app.module.ts`
- Test: `web/packages/server/src/inbox/inbox-format.spec.ts`

**Interfaces:**
- Consumes: задача 4.
- Produces:
  - HTTP (все отвечают `BoardState`, ошибки через `BoardErrorFilter`): `POST /api/lesson/start` (`LessonStartBody`), `POST /api/lesson/verdict` (`LessonVerdictBody`), `POST /api/lesson/reply` (`LessonReplyBody`), `POST /api/lesson/stop`. Код `stale` отдаётся как 409.
  - WebSocket от браузера: `lessonSay { text }`, `lessonRetry {}`, `lessonNext {}`; ход ученика - существующий `move`.
  - Помощник подключается к `/ws?role=assistant`; сервер считает такие соединения, `lesson.online = count > 0`; при старте сервера `online: false`.
  - `BoardService`: `startLesson`, `lessonVerdict`, `lessonReply`, `stopLesson`, `studentSay`, `lessonRetry`, `lessonNext`, `assistantConnected(delta: 1 | -1)`; `studentMove` в режиме `lesson` идёт в `lessonMove`.
  - Защита: `replace`, `startPuzzle`, `setMode` бросают `BoardError('forbidden', LESSON_RUNNING)`, пока `isLessonRunning`. `addCoachLine`, `setCursor`, `setPanel` не меняются.
  - `PanelService` в режиме `lesson` не смотрит на `BoardState.panel`: анализ курсора с `multipv: 3` идёт в фазах `feedback`, `pause`, `done` и при `online: false`; в фазах `student` и `coach` анализа нет, `latest()` пуст и новому сокету ничего не уходит.
  - Очередь: `InboxService.recordLesson(prev: BoardState, next: BoardState, note?: string)`; события `kind: 'lesson'` пишутся после применённого ответа, конца и остановки. Тексты (`title`, `k/n` - позиция `index + 1` из `total`):
    - ход: `Занятие «<title>», позиция k/n: 25.Nd3 - <verdict.text>. Тренер: «<say>»`
    - фраза: `Занятие «<title>», позиция k/n: ученик: «<text>». Тренер: «<say>»`
    - заметка помощника дописывается как ` [заметка: <note>]`; ответ без `say` - без части «Тренер: ...»; ответ на кнопку «Дальше» без `say` в очередь не пишется
    - конец: `Занятие «<title>» закончено: n из n позиций, вызовов модели M, заготовленных реплик F. Журнал: uv run coach lesson journal <lessonId>`
    - остановка: `Занятие «<title>» остановлено на позиции k/n. Продолжить: uv run coach lesson start <lessonId> --resume`

- [ ] **Step 1: Написать падающие тесты** (e2e на `helpers.ts`, `WsProbe`; формат - юнит)

```ts
it('start -> state with lesson, mode lesson, panel off', ...);
it('student move over ws -> phase coach with pending; verdict -> badge; reply play -> coach move, phase student', ...);
it('lessonSay over ws in phase student -> pending say; in phase coach -> error frozen', ...);
it('reply with an old inputId -> 409 stale', ...);
it('PUT /api/board, puzzles next and PATCH mode during a running lesson -> 403 forbidden with "coach lesson stop"; lesson untouched', ...);
it('after stop or end the board can be replaced again', ...);
it('assistant socket ?role=assistant sets online true, closing it sets online false; browser socket does not', ...);
it('lesson: no analysis broadcast in phases student and coach; multipv 3 analysis after the verdict and when offline', ...);
it('server restart with a saved lesson -> online false', ...);
it('inbox: reply to a move and to a phrase, end and stop give lesson events with the texts above', ...);
it('inbox: note is appended in brackets', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npm test -w @board/server` - новые тесты FAIL.
- [ ] **Step 3: Реализовать.** `handleConnection(client, req)` читает `role` из `req.url`, на `close` такого сокета - `assistantConnected(-1)`. `recordLesson` вызывается из `BoardService` после `mutate` у `lessonReply` и `stopLesson` (как `recordPuzzle` после `step`). `eventText` получает ветку `lesson` до ветки задачи, иначе событие уйдёт в текст задачи.
- [ ] **Step 4: Запустить:** `cd web && npm test -w @board/server && npm run typecheck` - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 6: Клиент: занятие на странице доски

**Files:**
- Create: `web/packages/client/src/LessonPanel.tsx`, `web/packages/client/src/LessonPanel.test.tsx`
- Modify: `web/packages/client/src/banner.ts`, `banner.test.ts`, `App.tsx`, `App.test.tsx`, `styles.css`

**Interfaces:**
- Consumes: `LessonView`, `ClientMessage` (задача 3), `AnalysisData` по правилу занятия (задача 5); раздел «Страница» в файле итогов (задача 2) и сам дизайн `Занятие у доски.dc.html` (Claude Design, `DesignSync get_file`, проект в файле итогов). Расположение, состояния и стили берутся оттуда; где файл итогов и эта задача расходятся с дизайном, правы они.
- Produces:
  - `LessonPanel({ lesson, connected, send }: { lesson: LessonView; connected: boolean; send(msg: ClientMessage): void })`.
  - `banner(state, connected)` в режиме `lesson`: `kind: 'lesson'` с текстом `Занятие: <title>, позиция k/n`; `phase: 'coach'` - `kind: 'checking'`, текст `Тренер отвечает…`; `lesson.online === false` при `status: 'running'` - `kind: 'unavailable'`, текст `Помощник у доски не подключён. Напиши тренеру в чат`.
  - `canDrag(state, connected)`: в режиме `lesson` - только при `status: 'running'`, `phase: 'student'`, `online`, курсор на `lesson.node`.
  - Кнопки в фазе `feedback`: `Попробовать другой ход`, если последний вердикт `wrong`, `weaker` или `unavailable`, иначе `К позиции`; обе шлют `lessonRetry`. Рядом `Повторить показ`, если у позиции был `lesson.replay`: заново проигрывает его на клиенте, к серверу не идёт. Кнопка `Дальше` в фазе `pause` шлёт `lessonNext`. В фазе `done` - кнопок и поля нет, `summary` и строка `Возвращайся в чат: напиши тренеру, что закончил`.
  - Раскладка по правилам из файла итогов: размер доски считается из размера окна (`ResizeObserver`), стопка или колонки, колонка шкалы 44 всегда, страница без прокрутки.
  - Полоса движка над историей: закрыта в фазах `student` и `coach` и во время показа (там она показывает проигрываемый вариант); после вердикта `wrong` и `weaker` - оценка и показанное опровержение до конца позиции; иначе три линии или одна строка по месту. Переключатель скрывает линии и шкалу; без помощника он доступен и по умолчанию выключен.
  - Блокировка: в фазе `coach` вуаль на доске с меткой «Тренер отвечает», во время показа без вуали; в обоих случаях ход, кнопки и поле выключены, курсор «нельзя».
  - «Ходы партии ▾» в строке состояния из `lesson.game`, без навигации; без помощника список стоит в колонке вместо истории.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('Enter sends lessonSay with trimmed text and clears the field; empty is not sent', ...);
it('input is disabled in phases coach and done and when the assistant is offline', ...);
it('shows the last coach entry prominently and the rest of the position history', ...);
it('verdict badge class follows verdict.kind', ...);
it('feedback: "Попробовать другой ход" after a wrong verdict, "К позиции" after info; both send lessonRetry; "Повторить показ" replays locally', ...);
it('board size: 630x860 stack with board 456, 1280x760 columns with board 688 and column 512', ...);
it('engine strip: closed in student and coach; after wrong only the refutation; after correct three lines or one row', ...);
it('coach phase: veil on the board, input disabled; replay: no veil, input disabled', ...);
it('pause: "Дальше" sends lessonNext; done: summary and the back-to-chat line', ...);
// banner.test.ts
it('lesson banner, coach thinking, assistant offline', ...);
// App.test.tsx
it('drag allowed only in phase student at lesson.node with the assistant online', ...);
it('regular engine panel is not shown in lesson mode, only the lesson strip', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npm test -w @board/client` - FAIL.
- [ ] **Step 3: Реализовать по одобренному расположению.** Навигация по дереву в режиме `lesson` закрыта, как в задаче (`locked`).
- [ ] **Step 4: Запустить:** `cd web && npm test -w @board/client && npm run typecheck` - PASS.
- [ ] **Step 5: Проверить на живой доске.** Пересобрать образ (`docker compose up -d --build board`), превью `board`, начать занятие руками: `curl -X POST /api/lesson/start` с позицией и ответить `curl` на ход ученика (`verdict`, затем `reply` с `play`). Сверить с состояниями дизайна на 630×860 и 1280×760, свои скриншоты - как доказательство. Остановить: `curl -X POST /api/lesson/stop`.
- [ ] **Step 6: Не коммитить.**

---

### Task 7: Пакет `@board/lessons`: карточка и позиция из разбора

**Files:**
- Create: `web/packages/lessons/package.json`, `tsconfig.json` (копия `web/packages/puzzles/tsconfig.json`), `vitest.config.ts` (копия puzzles), `src/root.ts`, `src/engine.ts`, `src/chess-utils.ts`, `src/card.ts`, `src/review.ts`, `src/testing/fake-engine.ts`
- Test: `src/card.spec.ts`, `src/review.spec.ts`, `src/chess-utils.spec.ts`, `src/engine.spec.ts`
- Modify: `.gitignore` (строка `data/lessons/`)

**Interfaces:**
- Consumes: `@board/shared` (типы, `countSentences`, `LESSON_SAY_MAX`).
- Produces:

```ts
// package.json: name "@board/lessons", type "module", scripts { lesson: "node src/cli.ts", test: "vitest run", typecheck: "tsc -p tsconfig.json" },
// dependencies { "@board/shared": "*", "chess.js": "1.4.0", "ws": "8.22.0" }, devDependencies { "@types/ws": "8.18.2" }
// root.ts - корень репозитория как findRoot в web/packages/puzzles/src/config.ts (копия: пакеты друг от друга не зависят)
export function findRoot(start?: string, env?: NodeJS.ProcessEnv): string;
export const lessonsDir = (root: string) => join(root, 'data', 'lessons');
// engine.ts
export interface Engine { analyse(fen: string, opts?: AnalyseOptions): Promise<EngineLine[]> }
/** Кэш последних 200 ответов по fen и опциям, одинаковые запросы в полёте склеиваются (как AnalysisService сервера). */
export class CachedEngine implements Engine { constructor(inner: Engine, size?: number) }
/** EngineClient с приоритетом и проверкой health(); недоступен - Error 'engine unavailable: docker compose up -d engine'. */
export async function connectEngine(priority: EnginePriority, url?: string): Promise<EngineClient>;
// chess-utils.ts
export function sanToUci(fen: string, san: string): string;            // бросает Error с SAN и FEN, если ход нелегален
export function uciToSan(fen: string, uci: string): string;
export function walk(fen: string, sans: string[]): string;              // FEN после пути SAN
export function sanLine(fen: string, ucis: string[]): string;           // '25.Nd3 Rxd3 26.Qxd3'
// card.ts
export type CheckKind = 'none' | 'why' | 'move';
export interface CardScore { cp?: number; mate?: number }               // со стороны ученика, ставит lesson check
export interface CardMove { san: string; check: CheckKind; say: string; why?: string; score?: CardScore; outcome?: OutcomeClass }
export interface CardMistake { san: string; say: string; refutation?: string[]; score?: CardScore; outcome?: OutcomeClass }
export interface CardTrap { after: string[]; san: string; why: string; say?: string; refutation?: string[]; score?: CardScore }
export interface CardLine { id: string; from: string[]; moves: string[]; caption?: string }
export interface CardPosition {
  id: string;
  source: { gameId: string; ply: number } | { fen: string; label: string };
  context: string; task: string; idea: string;
  expected: CardMove[]; mistakes: CardMistake[]; traps: CardTrap[]; lines: CardLine[];
  continuation: { plies: number; until?: string };
  finish: string; weakTheme?: boolean;
  fallback: { neutral: string; wrong?: string; weaker?: string; good?: string };
}
export interface LessonCard {
  id: string; title: string; habit: { id: string; text: string };
  intro: string; outro: string; positions: CardPosition[]; debrief: string[];
  check?: { at: string; hash: string };
}
export function parseCard(json: unknown): { card: LessonCard; errors: string[]; warnings: string[] };
export function cardHash(card: LessonCard): string;                     // sha256 hex канонического JSON без поля check
export function loadCard(root: string, id: string): LessonCard;          // data/lessons/<id>.json; ошибки - Error с текстом
// review.ts
export interface ResolvedPosition { fen: string; student: 'white' | 'black'; label: string; context: string; gameId?: string; ply?: number }
export function resolvePosition(p: CardPosition, root: string): ResolvedPosition;
export function formatClock(sec: number): string;
```

Смысл полей карточки:
- `after` и `from` - путь SAN от корня позиции (ход ученика, ответ, ...). `expected` и `mistakes` без пути относятся к корню; ходы дальше по линии описываются ловушками (`traps`) и `continuation`.
- `check: 'why'` требует `why` (текст вопроса); `check: 'move'` требует ловушку с `after: [san]` - это ответ соперника, который проверяет понимание.
- `context` может содержать `{myClock}` и `{oppClock}`: время ученика после его предыдущего хода (полуход `ply - 2`) и соперника после его последнего хода (`ply - 1`), из `clock_sec` разбора. `formatClock`: меньше 60 с - `19 секунд` (`1 секунду`, `3 секунды`), иначе `1:47`.
- `label` для партии: `Партия с <opponent>, <дд.мм.гггг>, <номер хода>` (`18.` для белых, `18...` для чёрных), как `gameRef` в `web/packages/puzzles/src/games/review.ts`.

Ошибки структуры (`errors`): нет позиций или больше 6 (меньше 3 - `warnings`); повтор `id` позиции или линии; `check` вне списка; нет `why` при `check: 'why'`; нет ловушки при `check: 'move'`; нет `fallback.neutral`; `intro`, `outro`, `finish`, `say`, `why`, `fallback.*` длиннее 240 символов или больше 2 предложений; в `context` другие `{...}`; `source` - не ровно один из вариантов; `continuation.plies` не целое 0-6.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('parseCard: a valid card has no errors; 2 positions give a warning, 7 an error', ...);
it('parseCard: check why without why, check move without a trap after [san], missing fallback.neutral', ...);
it('parseCard: say with three sentences and 241 chars are errors', ...);
it('cardHash ignores check and key order, changes when a say changes', ...);
it('resolvePosition from a review: fen_before of the ply, student color, label, clocks filled', ...);
it('resolvePosition: the ply is the opponent move -> Error "полуход 50 в партии X - ход соперника"', ...);
it('resolvePosition: {myClock} without clock data -> Error', ...);
it('formatClock: 1 секунду, 3 секунды, 19 секунд, 1:47, 10:05', ...);
it('sanToUci / uciToSan / sanLine with castling and promotion', ...);
it('CachedEngine: second identical request is served from the cache, parallel ones share one call', ...);
```

Разборы для тестов - маленькие JSON во временном каталоге (`mkdtempSync`) с полями `meta.color`, `meta.opponent`, `meta.date`, `moves[].ply|color|san|uci|fen_before|clock_sec`.

- [ ] **Step 2: Запустить:** `cd web && npm install && npx vitest run packages/lessons` - FAIL.
- [ ] **Step 3: Реализовать.** `testing/fake-engine.ts` - копия `web/packages/puzzles/src/testing/fake-engine.ts`, но `pv` задаётся явно (`on(fen, [{ move, cp, pv }])`).
- [ ] **Step 4: Запустить:** `cd web && npm test -w @board/lessons && npm run typecheck -w @board/lessons` - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 8: Проверка карточки движком (`lesson check`)

**Files:**
- Create: `web/packages/lessons/src/check.ts`, `web/packages/lessons/src/check.spec.ts`

**Interfaces:**
- Consumes: задача 7 (`Engine` из `engine.ts`); `compareMove`, `outcomeClass` из `@board/shared`.
- Produces:

```ts
export interface CheckReport { ok: boolean; errors: string[]; warnings: string[]; card: LessonCard; positions: number; moves: number }
export async function checkCard(card: LessonCard, engine: Engine, root: string): Promise<CheckReport>;
```

Алгоритм (все запросы `priority: 'batch'`, оценки пересчитываются в сторону ученика):
1. Ошибки `parseCard` - отчёт без движка.
2. Для каждой позиции `resolvePosition`; каждый путь (`after`, `from`, `lines[].moves`) легален, иначе ошибка с SAN, номером позиции и FEN.
3. Ожидаемые ходы: `analyse(fen, { multipv: 3 })`, линия хода из тройки или `searchmoves`; заполняются `score` и `outcome`. Если `compareMove(лучшая, ход) === 'wrong'` - ошибка `позиция p2: ожидаемый ход Nd3 по движку ошибка (<класс>)`.
4. Соблазнительные ошибки: `compareMove(лучшая, ход)` должен быть `wrong`, иначе ошибка `... не ошибка по движку`. Пустое `refutation` заполняется первыми 4 полуходами `pv` после хода (SAN); заданное проверяется: его первый ход - лучший ответ движка в позиции после ошибки или равноценный ему (`compareMove` со стороны соперника не `wrong`).
5. Ловушки: позиция после `after`, ход соперника легален; `compareMove(лучший ход соперника, ловушка)` со стороны соперника должен быть `wrong` (у подвоха есть опровержение), иначе ошибка `ход с подвохом на самом деле сильный`. Пустое `refutation` - первые 4 полухода `pv` ловушки после неё; `score` - оценка позиции после ловушки при лучшей игре ученика.
6. Записать `check = { at: <ISO>, hash: cardHash(card) }` только при `ok`.

- [ ] **Step 1: Написать падающие тесты на `FakeEngine`**

```ts
it('fills score and outcome of expected moves from the student side', ...);
it('expected move that drops the class -> error with position id and SAN', ...);
it('mistake that is not wrong -> error; empty refutation is filled from pv', ...);
it('given refutation whose first move is not the best reply nor equal -> error', ...);
it('trap that is the opponent best move -> error "на самом деле сильный"; real trap gets refutation and score', ...);
it('illegal SAN in a path -> error naming the SAN and the FEN', ...);
it('ok card gets check.hash equal to cardHash; card with errors gets no check', ...);
it('move outside top 3 is asked with searchmoves', () => { /* engine.calls */ });
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/lessons/src/check.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `check.ts`.**
- [ ] **Step 4: Запустить тот же файл** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 9: Тактические факты

**Files:**
- Create: `web/packages/lessons/src/tactics.ts`, `web/packages/lessons/src/tactics.spec.ts`

**Interfaces:**
- Consumes: `chess.js` (`attackers`, `isAttacked`, `moves({ verbose: true })`, `setTurn`), `Arrow` из `@board/shared`.
- Produces:

```ts
export type FactKind = 'hanging' | 'check' | 'capture' | 'pin' | 'unguarded';
export interface Fact { id: string; kind: FactKind; text: string; arrows: Arrow[] }
export const FACTS_MAX = 8;
/** Позиция после хода ученика: что у него висит, шахи и взятия соперника, связки, что перестала защищать ушедшая фигура. */
export function factsAfterMove(fenBefore: string, uci: string, student: 'white' | 'black'): Fact[];
/** Позиция, где думает ученик (для фраз): то же для его фигур плюс висящие фигуры соперника. */
export function factsInPosition(fen: string, student: 'white' | 'black'): Fact[];
```

Определения (ценность: пешка 1, конь 3, слон 3, ладья 5, ферзь 9; король не «висит»):
- **hanging** - фигура под боем стороны соперника и либо без защиты, либо её бьёт фигура дешевле. Текст: `Твой конь f3 висит: его бьёт слон g4, защиты нет.` / `...: его бьёт пешка e5, она дешевле.` Для фигур соперника: `Конь соперника e5 висит: ...`. Стрелка красная от самого дешёвого нападающего.
- **check** - шахи стороны, которая ходит после хода ученика: `У соперника есть шахи: Qb4+, Bxf7+.` Не больше 4 ходов в тексте, синие стрелки.
- **capture** - взятия этой стороны (кроме уже названных в `check`): `У соперника есть взятия: Nxe4, Bxf3.` Не больше 6.
- **pin** - связка фигуры ученика дальнобойной фигурой соперника с королём или ферзём за ней: `Твой конь d3 связан: ладья d8 бьёт сквозь него короля d1.` (`ферзя d1`). Стрелка красная от связывающей фигуры к тому, что за связанной.
- **unguarded** - фигуры ученика, которые ходившая фигура защищала со старого поля, после хода без защиты и под боем: `После Nd3 без защиты осталась пешка e5, её бьёт ферзь e7.`
- Порядок: hanging (ученик), check, capture, pin, unguarded, затем в `factsInPosition` hanging (соперник); id `f1`, `f2`, ... по порядку; обрезка до `FACTS_MAX`.

- [ ] **Step 1: Написать падающие тесты** (позиции подбирает исполнитель, утверждения - точные тексты и id)

```ts
it('chess.js attackers(square, ownColor) finds defenders of an occupied square', ...);  // фиксирует поведение библиотеки
it('hanging: knight attacked by a bishop with no defender', ...);
it('hanging: rook defended but attacked by a pawn', ...);
it('defended piece attacked by a more expensive piece is not hanging', ...);
it('checks and captures of the opponent after the student move, capped at 4 and 6', ...);
it('absolute pin to the king and relative pin to the queen', ...);
it('unguarded: the moved knight no longer defends e5 which the queen attacks', ...);
it('factsInPosition adds hanging opponent pieces; ids are f1..fn in order; at most 8', ...);
it('promotion and castling moves do not throw', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/lessons/src/tactics.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `tactics.ts`.** Названия фигур: пешка, конь, слон, ладья, ферзь, король (винительный падеж там, где нужен: «короля», «ферзя»).
- [ ] **Step 4: Запустить тот же файл** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 10: Вердикт хода и правила

**Files:**
- Create: `web/packages/lessons/src/verdict.ts`, `src/verdict.spec.ts`, `src/rules.ts`, `src/rules.spec.ts`

**Interfaces:**
- Consumes: задачи 7 и 9; `compareMove`, `outcomeClass`, `OUTCOME_WORD`, `winPct`, `materialBalance`, `materialWord` из `@board/shared`. Политику `LessonPolicy` правила получают параметром, значение задаёт задача 11 (`SETTINGS`).
- Produces:

```ts
// verdict.ts
export interface MoveJudgement {
  uci: string; san: string;
  verdict: MoveVerdict | 'unavailable';
  best?: EngineLine; played?: EngineLine; lines?: EngineLine[];
  onlyMove: boolean;              // вторая линия уступает лучшей 15+ пунктов win%
  reply?: string;                 // лучший ответ соперника (pv[1] линии хода), UCI
  refutation: string[];           // для wrong: pv[1..4] линии хода, UCI
}
export async function judgeMove(engine: Engine, fen: string, uci: string): Promise<MoveJudgement>;  // EngineUnavailable и таймаут -> 'unavailable'
export function humanScore(score: CardScore): string;          // 'выигрыш, +3.1' | 'мат в 3' | 'равно, +0.2' (со стороны ученика)
export function verdictOf(j: MoveJudgement, moveToken: string): LessonVerdict;
//   correct/equal/better -> { kind: 'correct', text: '25.Nd3 - верно (выигрыш, +3.1)' }; weaker -> 'weaker' '... - неплохо, но есть сильнее';
//   wrong -> 'wrong' '... - ошибка (было: выигрыш, стало: равно)'; unavailable -> 'Не могу проверить ход: движок недоступен'
export function cardVerdict(m: CardMove | CardMistake, moveToken: string): LessonVerdict;  // те же тексты по score и outcome из карточки
export function wrongText(fen: string, j: MoveJudgement): string;  // 'После Qd2 ты теряешь фигуру.' | 'После Qd2 соперник ставит мат в 2.' | 'После Qd2 перевес уходит.'
/** Красная стрелка - ответ соперника; если он тихий (не взятие и не шах), синяя - его следующий ход. Как refutationArrows в server/src/puzzles/judge.ts. */
export function refutationArrows(fenAfter: string, pv: string[]): Arrow[];
// rules.ts
export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13' | 'R14';
export type ModelActionType = 'none' | 'ask' | 'continue' | 'back' | 'arrows' | 'show' | 'next';
export interface LessonPolicy { modelExplainsWrong: boolean }
export interface PositionState {
  card: CardPosition; resolved: ResolvedPosition; index: number; total: number;
  path: string[];                 // SAN главной линии от корня позиции
  correct: number;                // принятые ходы ученика в этой позиции
  awaiting: 'move' | 'why'; followUps: number;
}
export interface Step {          // что отправить на доску и как поменять PositionState
  verdict?: LessonVerdict; say?: string; accept?: boolean; action: PlannedAction; state: Partial<PositionState>;
}
export type PlannedAction = LessonAction | { type: 'continue' } | { type: 'next' };  // continue и next разворачивает сессия (задача 12)
export type Decision =
  | { by: 'rule'; rule: RuleId; step: Step }
  | { by: 'model'; rule: RuleId; verdict?: LessonVerdict; allowed: ModelActionType[]; forced?: PlannedAction; fallback: Step };
export interface DecideInput {
  st: PositionState; input: LessonInput; judgement: MoveJudgement | null; facts: Fact[];
  isMain: boolean;                // ход от lesson.node по главной линии (иначе - показ после вопроса)
  gameOver: boolean;
}
export function decide(d: DecideInput, policy: LessonPolicy): Decision;
```

Таблица правил (ход ученика `m` по пути `st.path`, «карточка» - записи позиции с этим путём):

| Правило | Ситуация | Решение |
|---|---|---|
| R1 | `m` в `expected`, `check: 'none'` | вердикт из карточки, `say` из карточки или `Отлично.`, `accept`, `continue` |
| R2 | `m` в `expected`, `check: 'why'` | вердикт, `say` + `why` (вместе не больше 2 предложений, иначе только `why`), `accept`, `ask`; `awaiting: 'why'` |
| R3 | `m` в `expected`, `check: 'move'` | вердикт, `say`, `accept`, `play` ловушки с `after: [...path, m]` |
| R4 | `m` в `mistakes` | вердикт `wrong`, `say` из карточки, `line` с `refutation` из карточки от хода ученика, `then: 'feedback'` |
| R5 | после ловушки `m` - первый ход её `refutation` | вердикт `correct`, `say` ловушки или `Отлично, подвох не сработал.`, `accept`, `continue` |
| R6 | `m` вне карточки, вердикт `wrong` | вердикт `wrong`, действие `line` с `judgement.refutation` и `then: 'feedback'` (стрелки как `refutationArrows` в `server/src/puzzles/judge.ts`); `say`: `fallback.wrong` из карточки, иначе модель при `modelExplainsWrong` (разрешено только `none`, действие зафиксировано), иначе и при сбое модели - `wrongText` |
| R7 | вне карточки, `weaker` | вердикт `weaker`, `say` `fallback.weaker` или `Неплохо, но есть сильнее.`, `feedback` |
| R8 | вне карточки, `equal` или `better` | вердикт `correct`; если `weakTheme`, `onlyMove` или после хода висит фигура ученика (факт `hanging`) - `say` `fallback.good` или `Хороший ход. Почему именно он?`, `accept`, `ask`, `awaiting: 'why'`; иначе `Отлично.`, `accept`, `continue` |
| R9 | `continue` после принятого хода (`correct` уже увеличен) | партия кончилась или `correct >= 1 + continuation.plies` - `say: finish`, `pause`; иначе ход соперника: ловушка с этим путём, иначе `judgement.reply` (для хода из карточки сессия тоже зовёт `judgeMove`, обычно из кэша); движок недоступен и ловушки нет - позиция кончается (`finish`, `pause`) |
| R10 | фраза при `awaiting: 'move'` | модель; разрешено: в фазе `student` - `none`, `arrows`; в `feedback` - `none`, `arrows`, `show`; в `pause` - `none`, `arrows`, `show`, `next`. Сбой - `fallback.neutral`, `none` |
| R11 | ход при `awaiting: 'why'` (показ) | `judgeMove` показа, модель; разрешено `back`, `continue`, `arrows`. Сбой - `fallback.neutral`, `back` |
| R12 | кнопка «Дальше» | следующая позиция или `end` с `outro` на последней |
| R13 | `m` вне карточки, движок недоступен | вердикт `unavailable`, `back` (ход остаётся боковой веткой) |
| R14 | фраза при `awaiting: 'why'` | модель; разрешено `continue`, `arrows`, `show`, и `ask`, пока `followUps < 1`. Сбой - `fallback.neutral`, `continue` |

- [ ] **Step 1: Написать падающие тесты**

```ts
// verdict.spec.ts (FakeEngine)
it('judgeMove: move in top 3 needs one request; outside - second with searchmoves', ...);
it('judgeMove: onlyMove when the second line is 15+ win% worse', ...);
it('judgeMove: engine error -> unavailable, no throw', ...);
it('verdictOf texts for correct, weaker, wrong, unavailable from the student side (black to move)', ...);
it('wrongText: piece loss, mate against, plain drop', ...);
// rules.spec.ts - по тесту на строку таблицы
it('R1 card move without check -> rule, accept, continue', ...);
it('R2 why: say + question within 2 sentences, awaiting why', ...);
it('R3 test by move: play the trap after [...path, m]', ...);
it('R4 card mistake -> line with card refutation, then feedback', ...);
it('R5 refutation of a trap -> correct, continue', ...);
it('R6 with fallback.wrong -> rule; without and modelExplainsWrong -> model with forced line; with false -> wrongText', ...);
it('R7 weaker -> feedback, no model', ...);
it('R8 good move asks when weakTheme / onlyMove / a student piece hangs; otherwise continue', ...);
it('R9 finish after 1 + plies accepted moves or game over; trap before engine reply', ...);
it('R10 allowed actions depend on the phase', ...);
it('R11 demo move -> model with back/continue/arrows; fallback back', ...);
it('R12 next on the last position -> end with outro', ...);
it('R13 engine unavailable -> unavailable verdict, back', ...);
it('R14 allows one follow-up ask only', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/lessons/src/verdict.spec.ts packages/lessons/src/rules.spec.ts` - FAIL.
- [ ] **Step 3: Реализовать `verdict.ts` и `rules.ts`.** `rules.ts` - чистые функции без движка и модели.
- [ ] **Step 4: Запустить те же файлы** - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 11: Модель: контекст, ответ, запуск

**Files:**
- Create: `web/packages/lessons/src/settings.ts`, `src/model/prompt.ts`, `context.ts`, `reply.ts`, `runner.ts`, `fake-runner.ts`
- Test: `src/model/context.spec.ts`, `src/model/reply.spec.ts`, `src/model/runner.spec.ts`
- Modify (только если задача 1 выбрала `sdk`): `web/packages/lessons/package.json` (`"@anthropic-ai/claude-agent-sdk": "0.3.302"`)

**Interfaces:**
- Consumes: задачи 7, 9, 10 (`ModelActionType`, `LessonPolicy`, `PositionState` из `rules.ts`); раздел «Замер» в файле итогов (способ, флаги, модель, схема, таймаут, окружение, политика).
- Produces:

```ts
// settings.ts - значения из итогов задачи 1; LESSON_MODEL и LESSON_MODEL_TIMEOUT_MS из окружения их заменяют
export const SETTINGS: { runner: 'oneshot' | 'stream' | 'sdk'; model: string; timeoutMs: number; schema: boolean;
  dropEnv: string[]; policy: LessonPolicy };
// model/*
export interface ModelReply { say: string; action: { type: ModelActionType; facts?: string[]; line?: string }; note?: string }
export const REPLY_SCHEMA: object;   // JSON Schema ответа; action.type - enum ModelActionType
export interface ModelContext {
  system: string; user: string; allowed: ModelActionType[];
  factIds: string[]; lineIds: string[];
  knownSan: Set<string>;            // все SAN из карточки, линий, вердикта, фактов и истории позиции
  knownEvals: Set<string>;          // все оценки в тексте контекста ('+3.1', '−0.4', 'мат в 3')
  forbiddenSan: Set<string>;        // лучший ход в узле, который ученик ещё не нашёл
}
export interface ContextInput {
  card: LessonCard; st: PositionState; fen: string; transcript: LessonEntry[];
  input: LessonInput; judgement: MoveJudgement | null; facts: Fact[]; allowed: ModelActionType[];
  bestAtNode?: string;              // UCI лучшего хода в lesson.node, пока ученик его не нашёл (из кэша движка)
}
export function buildContext(c: ContextInput): ModelContext;
export function parseReply(text: string, ctx: ModelContext): { ok: true; reply: ModelReply } | { ok: false; reason: string };
export interface ModelRunner { ask(ctx: ModelContext, signal: AbortSignal): Promise<string>; reset(): Promise<void>; close(): Promise<void> }
export interface RunnerDeps { spawn?: typeof import('node:child_process').spawn; query?: unknown; env?: NodeJS.ProcessEnv; tmp?: string }
export function createRunner(deps?: RunnerDeps): ModelRunner;   // только способ, выбранный в задаче 1
export type AskResult =
  | { ok: true; reply: ModelReply; ms: number }
  | { ok: false; reason: 'timeout' | 'error' | 'invalid'; detail: string; ms: number };
export async function askModel(runner: ModelRunner, ctx: ModelContext, timeoutMs: number): Promise<AskResult>;
export class FakeRunner implements ModelRunner { answers: (string | Error | 'hang')[]; asked: ModelContext[]; resets: number }
```

Системная подсказка (`SYSTEM_PROMPT` в `prompt.ts`) обязана сказать:
- ты тренер у доски, ученик около 1100 в блице; отвечаешь одной-двумя короткими фразами на «ты», по-русски, без длинного тире;
- говоришь только то, что есть в контексте: карточка, вердикт движка, тактические факты; не придумываешь оценки, варианты и мотивы, не называешь ходы, которых в контексте нет;
- не называешь лучший ход, пока ученик его не нашёл; на просьбу подсказать отвечаешь наводящим вопросом;
- разбирая ответ на «почему», подтверди верное, одной фразой поправь неточное, если помогает - стрелки фактов или вариант из карточки; неточность рассуждения запиши в `note` (ученик его не видит);
- больше одного уточняющего вопроса подряд не задаёшь, после ответа ученика обычно `continue`;
- отвечаешь только JSON по схеме, одно действие из списка «Можно».

Текст запроса (`user`) по разделам, в этом порядке: `Привычка занятия`, `Позиция k/n` (метка, цвет ученика, FEN текущего узла), `Задание`, `Идея позиции`, `Ходы в этой позиции` (`sanLine` от корня), `Карточка` (ожидаемые ходы, ошибки, подвохи с оценками `humanScore` и фразами; линии с id `[L1]`), `Вердикт движка` (`verdictOf`, лучший ход, `humanScore` лучшей линии и хода ученика; линия хода ученика до 4 полуходов), `Тактические факты` (`[f1] ...`), `Последние реплики` (до 6 записей истории), `Ученик сейчас` (ход с пометкой «показ в ответ на вопрос» или фраза), `Можно` (действия; для `arrows` - id фактов, для `show` - id линий; `refutation` - id текущего опровержения, если оно на доске), `Формат ответа`.

`parseReply` (сбой - `ok: false` с причиной, без повторного вызова):
- текст или блок ```` ```json ```` разбирается как JSON нужной формы;
- длинное тире в `say` заменяется на `-`;
- `say` не пустая, не длиннее 240 символов и не больше 2 предложений (`countSentences`);
- `action.type` из `ctx.allowed`; `facts` из `ctx.factIds`; `line` из `ctx.lineIds`;
- каждый ход в `say` есть в `ctx.knownSan` и нет в `ctx.forbiddenSan`; ходом считаются SAN фигуры (`Nd3`, `Qxf7+`), взятие пешкой (`exd5`), рокировка и любой ход с номером (`25.Nd3`, `25...e5`); голое поле (`e5`) не проверяется, его пишут и факты;
- каждая оценка в `say` (`[+−-]\d+[.,]\d`, `#\d+`, `мат в \d+`) есть в `ctx.knownEvals`.

Запуск (`createRunner`):
- все способы: рабочая папка `deps.tmp ?? join(os.tmpdir(), 'chess-coach-lesson')` (создаётся), окружение - `process.env` без `CLAUDECODE` и без переменных из итогов задачи 1, модель `LESSON_MODEL` или из итогов;
- `oneshot`: новый процесс на каждый вызов с флагами из итогов (база: `-p --model <m> --safe-mode --tools "" --no-session-persistence --system-prompt <SYSTEM_PROMPT> --output-format json [--json-schema <REPLY_SCHEMA>]`), запрос в stdin, ответ - `structured_output` или `result`; `reset` и `close` ничего не делают;
- `stream`: один процесс `claude -p --input-format stream-json --output-format stream-json --verbose` с теми же флагами на позицию; `reset` закрывает процесс, следующий `ask` открывает новый;
- `sdk`: `query()` со streaming input и опциями из итогов (база: `settingSources: []`, `tools: []`, `persistSession: false`, `systemPrompt`, `model`, `cwd`, `env`, `outputFormat`); `reset` - `close()`, следующий `ask` - новый `query()`;
- `askModel`: `AbortSignal.timeout(timeoutMs)`; прерванный вызов убивает процесс (`oneshot`) или закрывает сессию (`stream`, `sdk`) и возвращает `timeout`.

- [ ] **Step 1: Свериться с документацией** выбранного способа (`claude --help` или справочник SDK для 0.3.302): флаги и опции из итогов задачи 1 на месте. Расхождения - в файл итогов.
- [ ] **Step 2: Написать падающие тесты**

```ts
// context.spec.ts
it('user text has the sections in order and fact/line ids', ...);
it('knownSan has card, line, verdict, fact and transcript moves; knownEvals has every eval in the text', ...);
it('forbiddenSan holds the best move while the student has not found it, empty after an accepted best move', ...);
it('transcript is cut to the last 6 entries; the profile and other positions never appear', ...);
// reply.spec.ts
it('accepts a valid reply and a ```json fenced reply', ...);
it('rejects: not JSON, 241 chars, 3 sentences, action not allowed, unknown fact id, unknown line id', ...);
it('rejects a SAN that is not in the context and the forbidden best move', ...);
it('rejects an eval that is not in the context; replaces the long dash', ...);
// runner.spec.ts
it('spawn args (oneshot/stream) or options (sdk) are isolated: no settings/hooks/tools, cwd outside the repo, env without CLAUDECODE', ...);
it('reset closes a persistent session and the next ask opens a new one', ...);
it('askModel: timeout aborts and returns timeout; error returns error; garbage returns invalid', ...);
```

- [ ] **Step 3: Запустить:** `cd web && npx vitest run packages/lessons/src/model` - FAIL.
- [ ] **Step 4: Реализовать.** Второй способ (не выбранный) не пишется.
- [ ] **Step 5: Запустить тот же каталог** - PASS.
- [ ] **Step 6: Живой вызов.** `node --input-type=module -e` со скриптом из `web/packages/lessons`: `createRunner()` и `askModel` на контексте из `buildContext` по позиции 185135620088 · 49 - ответ проходит `parseReply`, время близко к замеру задачи 1. Потом `uv run coach inbox --peek` - очередь не тронута.
- [ ] **Step 7: Не коммитить.**

---

### Task 12: Помощник: связь с доской, ход занятия, журнал, команды

**Files:**
- Create: `web/packages/lessons/src/board-link.ts`, `src/session.ts`, `src/journal.ts`, `src/cli.ts`
- Test: `src/board-link.spec.ts`, `src/session.spec.ts`, `src/journal.spec.ts`

**Interfaces:**
- Consumes: задачи 3, 5, 7-11; `EngineClient`, `DEFAULT_ENGINE_URL` из `@board/shared`.
- Produces:

```ts
// board-link.ts - ws://<host>/ws?role=assistant, переподключение 500 мс .. 10 с; HTTP через fetch
export interface BoardLinkLike {
  onState(cb: (s: BoardState) => void): void;
  start(b: LessonStartBody): Promise<BoardState>;
  verdict(b: LessonVerdictBody): Promise<void>;     // 409 stale - молча
  reply(b: LessonReplyBody): Promise<void>;         // 409 stale - молча
  stop(): Promise<void>;
  close(): void;
}
export class BoardLink implements BoardLinkLike { constructor(baseUrl: string = process.env.COACH_BOARD_URL ?? 'http://127.0.0.1:8765') }
// journal.ts - JSONL, одна запись на строку, запись синхронная (appendFileSync)
export type JournalEvent =
  | { t: 'start'; at: string; lessonId: string; resume: boolean; runner: string }
  | { t: 'position'; at: string; index: number; id: string }
  | { t: 'input'; at: string; index: number; inputId: number; kind: LessonInput['kind']; san?: string; text?: string; demo?: boolean }
  | { t: 'verdict'; at: string; inputId: number; kind: LessonVerdictKind; text: string; ms: number }
  | { t: 'reply'; at: string; inputId: number; by: 'rule' | 'model' | 'fallback'; rule: RuleId; say?: string; action: string;
      note?: string; modelMs?: number; failure?: string }
  | { t: 'finish'; at: string; index: number }
  | { t: 'end'; at: string; modelCalls: number; fallbacks: number }
  | { t: 'stop'; at: string };
export class Journal { constructor(path: string); write(e: JournalEvent): void }
export function resumeIndex(events: JournalEvent[]): number | 'done';   // первая позиция без finish; все закончены - 'done'
export function readJournal(path: string): JournalEvent[];
export function journalSummary(card: LessonCard, events: JournalEvent[]): string;
// session.ts
export interface SessionDeps {
  card: LessonCard; root: string; board: BoardLinkLike; engine: Engine; runner: ModelRunner; journal: Journal;
  policy: LessonPolicy; modelTimeoutMs: number; now?: () => number; sleep?: (ms: number) => Promise<void>;
}
export class LessonSession {
  constructor(deps: SessionDeps);
  start(resume: boolean): Promise<void>;
  handle(s: BoardState): Promise<void>;   // вызывается на каждое state; события обрабатываются по одному
  stop(): Promise<void>;                  // журнал stop, runner.close(); доску не трогает
}
```

Ход сессии:
1. `start`: индекс - 0 или `resumeIndex` журнала (`done` - выход с сообщением `lesson <id> is already finished`); `board.start` с `intro` только при индексе 0; журнал `start` и `position`; `runner.reset()`.
2. `handle(s)`: работает, только если `s.lesson.lessonId === card.id`, `status: 'running'`, `phase: 'coach'` и `pending.id` больше последнего обработанного. В фазе `student` заранее зовёт `engine.analyse(fen узла, { multipv: 3 })` без ожидания.
3. Ход: показ (`awaiting: 'why'` или родитель хода не `lesson.node`) или ход главной линии. Для хода главной линии сразу `board.verdict`: из карточки без движка, иначе после `judgeMove`. Затем факты, `decide`, при `by: 'model'` - `buildContext` и `askModel` с `modelTimeoutMs`; отказ - `fallback` этого решения.
4. Разворот ответа модели в `LessonReplyBody`: `none` - `none`; `ask` - `ask` (`awaiting: 'why'`, `followUps + 1`); `continue` - правило R9 (для показа - ход соперника от `lesson.node` без `accept`); `back` - `back`; `arrows` - стрелки фактов: на фразу `arrows`, на ход-показ `feedback { arrows }` (сервер не принимает `arrows` на ход); `show` - `line` из карточки (`from` - узел по пути `CardLine.from`) или текущее опровержение, `then: 'feedback'`; `next` - R12.
5. `continue` и `next` из правил разворачиваются так же (R9, R12). Ответ с `play` уходит не раньше чем через 400 мс после события (`sleep`).
6. Новая позиция - `runner.reset()`, журнал `finish` и `position`. Конец - `end` с `outro` и `stats`, журнал `end`, выход из процесса через `cli.ts`.

Команды `cli.ts` (корень - `findRoot()`, каталог `data/lessons/`):
- `check <id>`: `connectEngine('batch')` (недоступен - его сообщение, код 1), `checkCard`, при `ok` - запись карточки (JSON, 2 пробела), печать `ok: <positions> positions, <moves> moves checked` или ошибок, код 1 при ошибках.
- `run <id> [--resume]`: проверка `card.check.hash === cardHash(card)` (иначе `card changed after check: uv run coach lesson check <id>`, код 1); доска отвечает на `GET /api/health`; движок недоступен - предупреждение, не выход; `CachedEngine` поверх `connectEngine('interactive')`; `createRunner()`, политика и таймаут из `SETTINGS`; `LessonSession`; SIGTERM и SIGINT - `session.stop()` и выход.
- `start <id> [--resume]`: живой pid в `assistant.pid` - отказ `assistant already running (pid N)`; иначе `spawn(process.execPath, [cli, 'run', id, ...], { detached: true, stdio: ['ignore', log, log] }).unref()` с логом `assistant.log`, запись pid; ждать до 15 с, пока `GET /api/board` не покажет `lesson.lessonId === id` и `online`; печать `lesson <id> started: position k/n` или последних 20 строк лога и код 1.
- `stop`: SIGTERM живому pid, `POST /api/lesson/stop`, удалить pid-файл; печать `lesson stopped at position k/n`.
- `status`: жив ли процесс, строка занятия с доски, из журнала - вызовы модели, заготовленные реплики, среднее и p90 времени модели.
- `journal <id>`: `journalSummary`: по позициям - ходы ученика с вердиктами и кем отвечено (правило или модель), вопросы «почему» с ответом ученика, ответом тренера и `note`; итоги - вызовы модели, время, заготовленные реплики с причинами.

- [ ] **Step 1: Написать падающие тесты**

```ts
// board-link.spec.ts - маленький сервер на node:http + ws.WebSocketServer
it('connects with role=assistant, delivers state messages, reconnects after a drop', ...);
it('409 stale on verdict/reply is swallowed; other errors throw', ...);
// journal.spec.ts
it('resumeIndex: first position without finish; all finished -> done', ...);
it('journalSummary lists moves with verdicts, why-answers with notes and model totals', ...);
// session.spec.ts - FakeBoard (BoardLinkLike), FakeEngine, FakeRunner, sleep без ожидания
it('card move with check none: verdict posted before reply, reply play the engine reply, no model call', ...);
it('card move with check why, then a phrase: model called once with R14 context, continue plays the opponent', ...);
it('demo move after the question: judged, model R11, back keeps the main line', ...);
it('wrong move outside the card: refutation line, feedback; model only when modelExplainsWrong', ...);
it('model timeout and invalid reply -> fallback phrase, journal failure, exactly one ask', ...);
it('engine down: card move still answered, non-card move -> unavailable verdict and back', ...);
it('position finished after 1 + plies accepted moves -> pause; next -> new position and runner.reset', ...);
it('last position next -> end with outro and stats', ...);
it('stale state (pending already handled) is ignored; events are handled one at a time', ...);
it('resume starts from the first unfinished position without intro', ...);
it('reply with play is not sent before 400 ms after the input', ...);
```

- [ ] **Step 2: Запустить:** `cd web && npx vitest run packages/lessons` - новые тесты FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить:** `cd web && npm test -w @board/lessons && npm run typecheck -w @board/lessons` - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 13: `coach lesson` и строка занятия в `coach board state`

**Files:**
- Create: `coach/lessoncmd.py`, `tests/test_lesson_cli.py`
- Modify: `coach/cli.py`, `coach/boardcmd.py`, `tests/test_board_cli.py`

**Interfaces:**
- Consumes: команды `cli.ts` из задачи 12.
- Produces:

```python
SUBCOMMANDS = ("check", "start", "stop", "status", "journal")
def add_lesson_parser(sub) -> None:          # coach lesson <sub> [id] [--resume]
def cmd_lesson(args, cfg, runner=subprocess.run) -> None:
    """node src/cli.ts <sub> [id] [--resume] в ROOT/'web/packages/lessons', вывод не перехватывается,
    код возврата пробрасывается через SystemExit; FileNotFoundError -> 'Node не найден: установи через fnm (SETUP.md)', код 1."""
def lesson_line(state: dict) -> str | None:  # в boardcmd.py
    """'lesson <id> «<title>»: running, position 2/5, phase coach, assistant online'; нет lesson - None."""
```

- `id` обязателен для `check`, `start`, `journal`; `--resume` только у `start`.
- `print_state` печатает `lesson_line` после строки задачи.

- [ ] **Step 1: Написать падающие тесты**

```python
def test_lesson_forwards_args_and_cwd():        # runner записывает args и cwd: ['node', 'src/cli.ts', 'start', 'les1', '--resume']
def test_lesson_passes_exit_code():
def test_lesson_without_node(capsys):            # runner бросает FileNotFoundError
def test_lesson_requires_id_for_check():
def test_board_state_prints_lesson_line(fake_board):
```

- [ ] **Step 2: Запустить:** `uv run pytest tests/test_lesson_cli.py tests/test_board_cli.py -q` - FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить:** `uv run pytest -q` - PASS.
- [ ] **Step 5: Не коммитить.**

---

### Task 14: Документы, скилл основного тренера и приёмка с учеником

**Files:**
- Create: `.claude/skills/board-lesson/SKILL.md`
- Modify: `CLAUDE.md`, `ROADMAP.md`, `SETUP.md`, `profile/player.md` (раздел «Модель мышления», шаг 4)

- [ ] **Step 1: Скилл `board-lesson`.** Когда: «давай разберём у доски», «занятие», «разберём ...» с серией позиций. Шаги основного тренера:
  1. прочитать профиль и раздел «Модель мышления», выбрать одну привычку;
  2. подобрать 3-6 позиций, свои партии первыми (`coach games`, `data/reviews/`), для каждой - `coach analyze` по нужным ходам;
  3. написать карточку `data/lessons/<дата>-<привычка>.json` по типам `web/packages/lessons/src/card.ts` (в скилле - пример одной позиции целиком и правила проверки понимания из дизайна: когда `check: 'why'`, когда `check: 'move'`, когда `none`);
  4. `uv run coach lesson check <id>`, исправить ошибки до `ok`;
  5. `uv run coach lesson start <id>` (откуда запускать - из итогов задачи 1), `preview_start board`, одна строка в чат;
  6. пока занятие идёт: не заменять доску (`board load`, `show`, `puzzles next`); строки занятия приходят в контексте с сообщением ученика; если ученик написал посреди серии - ответить коротко, остановить только при необходимости (`coach lesson stop`, потом `start --resume`);
  7. после: `uv run coach lesson journal <id>`, обсудить с учеником вопросы из `debrief`, обновить «Модель мышления» и «Журнал занятий» в профиле.
  Формат раздела «Модель мышления»: на привычку - формулировка, примеры (партия · полуход), статус (новая, отрабатываем, закреплено), что ученик уже объяснял верно, неточности рассуждения из журналов.
- [ ] **Step 2: `CLAUDE.md`.** В таблицу команд - `lesson check|start|stop|status|journal`. Раздел «Занятия у доски»: помощник на хосте, правила главного тренера из шага 1.6, карточка проверяется до старта, все цифры в карточке - из `lesson check`. В «Сценарии» - «давай разберём у доски», «занятие» -> скилл `board-lesson`. В «Файлы» - `data/lessons/`, `web/packages/lessons/`.
- [ ] **Step 3: `ROADMAP.md` и `SETUP.md`.** ROADMAP: пункт «Занятия у доски - готово (дата)» со ссылками на спецификацию, этот план и файл итогов. SETUP: `cd web && npm install` (новый пакет), Claude Code с входом по подписке, `docker compose up -d engine board`.
- [ ] **Step 4: Полный прогон:** `cd web && npm test`, `cd web && npm run typecheck`, `uv run pytest -q` - всё PASS. Пересобрать `board` (`docker compose up -d --build board`).
- [ ] **Step 5: Приёмка с учеником** (основная сессия, превью `board`, бюджет браузерных вызовов по глобальным правилам, состояние - через `coach board state` и `coach lesson status`):
  1. вместе с учеником завести раздел «Модель мышления» в профиле из «Слабостей» и «Наблюдений»;
  2. карточка на 3 позиции с позицией 185135620088 · 49, `lesson check` - `ok`, `lesson start`;
  3. на доске видно: вердикт сразу после хода, реплики не длиннее двух фраз, вопрос «почему» с ответом фразой, проверка ходом (ловушка), ошибка с опровержением, «Повторить показ» и «Попробовать другой ход», фраза ученика посреди позиции, «Дальше», итог серии с предложением вернуться в чат;
  4. посреди серии ученик пишет в чат: строки занятия пришли в контексте; `uv run coach board load ...` отказано с подсказкой; `lesson stop` и `lesson start --resume` продолжают с той же позиции;
  5. после: `lesson journal` - вызовы модели и время; ученик говорит, как прошло занятие; его слова - в файл итогов.
- [ ] **Step 6: Не коммитить.** Отчитаться списком решений, принятых без ученика: раздел спецификации «Решения тренера без ученика» плюс решения этого плана (транспорт WebSocket + HTTP, схема карточки и журнала, правила R1-R14, тексты заготовок, обращение на «ты», запуск через отвязанный процесс) и решения исполнителей из журнала.
