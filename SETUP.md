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

## 5. Готово

Проверь, что `uv run coach fetch --days 7` скачивает партии: Lichess и chess.com должны быть доступны из сети. Потом запусти скилл `build-profile`, это первое занятие.

## Чего пока не ставим

Lc0, Maia-2, базы задач и дебютов, таблицы Syzygy ставим на этапе 3 (см. ROADMAP.md). Сначала нужен работающий цикл «партия → разбор → профиль».
