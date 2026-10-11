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
docker compose build board
docker compose up -d board
curl -s http://127.0.0.1:8765/api/health
```

Ответ `{"ok":true}`. Остановить: `docker compose stop`. Дерево хранится в томе `chess-coach_board-mongo` и переживает перезапуск. `docker compose down -v` удаляет его вместе с томом. На занятии доску запускает `preview_start` с именем `board`.

Разработка доски:

```bash
(cd web && npm ci && npm test)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo
cd web && npm run dev
```

Клиент с горячей перезагрузкой на `http://127.0.0.1:5173`, сервер на 8765, база на `127.0.0.1:27018`. Тесты Python: `uv run pytest`.

## 6. Готово

Проверь, что `uv run coach fetch --days 7` скачивает партии: Lichess и chess.com должны быть доступны из сети. Потом запусти скилл `build-profile`, это первое занятие.

## Чего пока не ставим

Lc0, Maia-2, базы задач и дебютов, таблицы Syzygy ставим на этапе 3 (см. ROADMAP.md). Сначала нужен работающий цикл «партия → разбор → профиль».
