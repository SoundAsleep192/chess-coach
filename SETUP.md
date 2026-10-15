# Установка (инструкция для Claude Code)

Платформа: macOS на Apple Silicon (M1). Выполняй по шагам. После каждого шага коротко сообщай ученику результат.

## 1. Homebrew и Xcode Command Line Tools

```bash
brew --version
xcode-select -p
```

Если чего-то нет, попроси ученика поставить самому. Это интерактивные установщики: Homebrew — с https://brew.sh, CLT — через `xcode-select --install`.

## 2. Stockfish и uv

```bash
brew install stockfish uv
echo uci | stockfish | head -1
```

Нужен Stockfish 19 (вышел в сентябре 2026). Если Homebrew поставил версию старше, собери из исходников. Тег последнего релиза посмотри на https://github.com/official-stockfish/Stockfish/releases (формат `sf_NN`):

```bash
mkdir -p engines/src
git clone --depth 1 --branch sf_19 https://github.com/official-stockfish/Stockfish engines/src/Stockfish
make -C engines/src/Stockfish/src -j profile-build ARCH=apple-silicon
cp engines/src/Stockfish/src/stockfish engines/stockfish
```

Затем в `coach.toml` пропиши `path = "engines/stockfish"`.

## 3. Настройки движка

```bash
sysctl -n hw.perflevel0.physicalcpu
```

Это число производительных ядер. Запиши его в `[engine].threads` в `coach.toml`. Для `hash_mb` хватит 512–1024.

## 4. Python-окружение

```bash
uv sync
uv run coach doctor
uv run coach analyze start --time 2
```

`doctor` должен показать Stockfish 19, `analyze` — три линии с оценками.

## 5. Доска

Нужны Docker Desktop с Compose v2 и Node 24.21.0 (версия записана в `.node-version`, fnm переключается на неё сам; Node нужен для разработки и тестов доски, сама доска работает в Docker).

```bash
docker --version
docker compose version
node --version
docker compose build --pull=false engine board
docker compose up -d --no-build engine board
curl -s http://127.0.0.1:8766/health
curl -s http://127.0.0.1:8765/api/health
```

Первая сборка `engine` компилирует Stockfish 19 из исходников внутри образа и скачивает его сеть NNUE, поэтому нужна сеть. Ответ движка `{"ok":true,"version":"Stockfish 19","workers":4,"busy":0,"queued":0}`, доски - `{"ok":true}`. Движок слушает только `127.0.0.1:8766`; доска ходит к нему по сети Docker и поднимается и без него (тогда в задачах проверяются только ход из решения и мат). Настройки движка - переменные `ENGINE_WORKERS` (процессов, 4), `ENGINE_HASH_MB` (64 на процесс), `ENGINE_NODES` (узлов на анализ, 1 000 000) в `docker-compose.yml`. Остановить: `docker compose stop`. Дерево хранится в томе `chess-coach_board-mongo` и переживает перезапуск. `docker compose down -v` удаляет его вместе с томом. На занятии доску запускает `preview_start` с именем `board`.

Разработка доски:

```bash
(cd web && npm ci && npm test)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo
cd web && npm run dev
```

Клиент с горячей перезагрузкой на `http://127.0.0.1:5173`, сервер на 8765, база на `127.0.0.1:27018`. Тесты Python: `uv run pytest`.

## 6. Задачи

Нужны утилиты poppler, `tesseract` и `zstd`:

```bash
brew install poppler tesseract zstd
pdftotext -v && tesseract --version && zstd --version
```

Импорт пишет в базу доски через порт для разработки и считает решения в сервисе движка, поэтому сначала Mongo и движок:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --pull never mongo engine
```

Без движка импорт Полгар и «Радуги» сразу завершается с подсказкой `docker compose up -d engine`.

База Lichess (CC0, около 300 МБ, перед загрузкой проверь размер: `curl -sI https://database.lichess.org/lichess_db_puzzle.csv.zst | grep -i content-length`):

```bash
mkdir -p data/lichess
curl -fL --retry 3 -o data/lichess/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
cd web && npm run import -w @board/puzzles -- lichess data/lichess/lichess_db_puzzle.csv.zst
```

Книги ученика лежат в `[puzzles] books_dir` из `coach.toml`. Полгар:

```bash
cd web && npm run import -w @board/puzzles -- polgar
```

«Радуга» требует разметки (образцы, эталон, заголовки в `data/books/`, см. задачу 6 плана `docs/superpowers/plans/2026-10-11-puzzles.md`). Решения всегда считает движок, ответов книги для сверки нет: первый ход должен выигрывать (мат или около +3), линия идёт до мата, до выигрыша двух пешек материала или до 8 ходов решающего. После разметки:

```bash
cd web && npm run books -w @board/puzzles -- raduga-scan
cd web && npm run import -w @board/puzzles -- raduga
```

Повторный импорт «Радуги» (например, после смены правил решения) не требует нового распознавания: если `data/books/raduga-diagrams.json` есть, достаточно второй команды. Id задач, которые остаются в базе, не меняются, их карточки FSRS сохраняются. Позиции, которые новое правило отвергает, уходят из базы и перечислены в отчёте, их история решений остаётся.

Отчёты импорта - `data/books/import-<источник>.md`. Импорт можно повторять: задачи обновляются, история решений не трогается. Повторный импорт Lichess не удаляет задачи, которых нет в новой выгрузке. Тесты на книгах (`npm test -w @board/puzzles`) пропускаются, если книг или `data/books/` нет на машине.

## 7. Готово

Проверь, что `uv run coach fetch --days 7` скачивает партии: Lichess и chess.com должны быть доступны из сети. Потом запусти скилл `build-profile`, это первое занятие.

## Чего пока не ставим

Lc0, Maia-2, базы задач и дебютов, таблицы Syzygy ставим на этапе 3 (см. ROADMAP.md). Сначала нужен работающий цикл «партия → разбор → профиль».
