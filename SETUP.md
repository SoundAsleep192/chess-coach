# Setup (Instructions for Claude Code)

Platform: macOS on Apple Silicon (M1). Go step by step. After each step briefly report the result to the student.

## 1. Homebrew and Xcode Command Line Tools

```bash
brew --version
xcode-select -p
```

If something is missing, ask the student to install it themselves. These are interactive installers: Homebrew from https://brew.sh, CLT via `xcode-select --install`.

## 2. Stockfish and uv

```bash
brew install stockfish uv
echo uci | stockfish | head -1
```

Stockfish 19 is required (released in September 2026). If Homebrew installed an older version, build from source. Look up the tag of the latest release at https://github.com/official-stockfish/Stockfish/releases (format `sf_NN`):

```bash
mkdir -p engines/src
git clone --depth 1 --branch sf_19 https://github.com/official-stockfish/Stockfish engines/src/Stockfish
make -C engines/src/Stockfish/src -j profile-build ARCH=apple-silicon
cp engines/src/Stockfish/src/stockfish engines/stockfish
```

Then set `path = "engines/stockfish"` in `coach.toml`.

## 3. Engine Settings

```bash
sysctl -n hw.perflevel0.physicalcpu
```

This is the number of performance cores. Write it to `[engine].threads` in `coach.toml`. For `hash_mb` 512-1024 is enough.

## 4. Python Environment

```bash
uv sync
uv run coach doctor
uv run coach analyze start --time 2
```

`doctor` should show Stockfish 19, `analyze` three lines with evaluations.

## 5. Board

You need Docker Desktop with Compose v2 and Node 24.21.0 (the version is recorded in `.node-version`, fnm switches to it by itself; Node is needed for developing and testing the board, the board itself runs in Docker).

```bash
docker --version
docker compose version
node --version
docker compose build --pull=false engine board
docker compose up -d --no-build engine board
curl -s http://127.0.0.1:8766/health
curl -s http://127.0.0.1:8765/api/health
```

The first build of `engine` compiles Stockfish 19 from source inside the image and downloads its NNUE network, so network access is required. The engine's response is `{"ok":true,"version":"Stockfish 19","workers":4,"busy":0,"queued":0}`, the board's is `{"ok":true}`. The engine listens only on `127.0.0.1:8766`; the board reaches it over the Docker network and also starts without it (then puzzles check only a move from the solution and mate). Engine settings are the variables `ENGINE_WORKERS` (processes, 4), `ENGINE_HASH_MB` (64 per process), `ENGINE_NODES` (nodes per analysis, 1 000 000) in `docker-compose.yml`. To stop: `docker compose stop`. The tree is stored in the `chess-coach_board-mongo` volume and survives restarts. `docker compose down -v` deletes it together with the volume. In a session the board is started by `preview_start` with the name `board`.

Board development:

```bash
(cd web && npm ci && npm test)
docker compose up -d mongo
cd web && npm run dev
```

The database is always available on `127.0.0.1:27018` (the port is published in `docker-compose.yml`, no separate file is needed for this). The client with hot reload is on `http://127.0.0.1:5173`, the server on 8765, the database on `127.0.0.1:27018`. Python tests: `uv run pytest`.

### Queue Hook

The `UserPromptSubmit` hook attaches to each student message what the student did on the board since last time: moves, deleted branches, puzzle results, cursor position. It is already registered in `.claude/settings.json` (command `uv run --quiet coach inbox --hook`, timeout 10 s), nothing needs to be installed. If the board server does not respond, the hook stays silent and the message goes through as usual.

Check: make a move on the board in free mode and run `uv run coach inbox --peek`, the move should be in the list. In Claude Code, after the next message the block «Действия ученика на доске с прошлого сообщения» (Student's actions on the board since the previous message) appears in the context. An empty queue is checked by `echo '{}' | uv run --quiet coach inbox --hook; echo "exit $?"`: no output, exit code 0.

If the block does not appear, open `/hooks` in the terminal `claude` and make sure the hook is visible, and check that `uv` is on the `PATH` of the shell Claude Code was started from.

## 6. Puzzles

You need the poppler utilities, `tesseract` and `zstd`:

```bash
brew install poppler tesseract zstd
pdftotext -v && tesseract --version && zstd --version
```

The import writes to the board database on `127.0.0.1:27018` and computes solutions in the engine service, so start Mongo and the engine first:

```bash
docker compose up -d --no-build --pull never mongo engine
```

Without the engine the Polgar and «Радуга» imports exit immediately with the hint `docker compose up -d engine`.

The Lichess database (CC0, about 300 MB; check the size before downloading: `curl -sI https://database.lichess.org/lichess_db_puzzle.csv.zst | grep -i content-length`):

```bash
mkdir -p data/lichess
curl -fL --retry 3 -o data/lichess/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
cd web && npm run import -w @board/puzzles -- lichess data/lichess/lichess_db_puzzle.csv.zst
```

The student's books are in `[puzzles] books_dir` from `coach.toml`. Polgar («5334»):

```bash
cd web && npm run import -w @board/puzzles -- polgar
```

«Радуга» (Dorofeeva's «Радуга тактических приёмов», "Rainbow of Tactical Techniques") requires markup (samples, reference set, headings in `data/books/`, see task 6 of the plan `docs/superpowers/plans/2026-10-11-puzzles.md`). Solutions are always computed by the engine, there are no book answers to check against: the first move must win (mate or about +3), the line goes until mate, until winning two pawns of material, or up to 8 moves of the solver. After the markup:

```bash
cd web && npm run books -w @board/puzzles -- raduga-scan
cd web && npm run import -w @board/puzzles -- raduga
```

Re-importing «Радуга» (for example, after changing the solution rules) does not require new recognition: if `data/books/raduga-diagrams.json` exists, the second command is enough. Ids of puzzles that stay in the database do not change, their FSRS cards are kept. Positions that the new rule rejects leave the database and are listed in the report; their solving history stays.

Import reports are `data/books/import-<source>.md`. The import can be repeated: puzzles are updated, the solving history is not touched. Re-importing Lichess does not delete puzzles that are missing from the new dump. Tests on the books (`npm test -w @board/puzzles`) are skipped if the books or `data/books/` are not on the machine.

Puzzles from own games: initial fill from already reviewed games (`data/reviews/`). The engine service is required:

```bash
docker compose up -d engine
uv run coach puzzles import-games
```

The result is printed as the line `games: N puzzles from R reviews (...); report <path>`, rejection reasons go to `data/books/import-games.md` (importing a single game after `coach review` writes `data/books/import-games-game.md`, the full report is not overwritten). New reviews (`coach review`) add their puzzles by themselves; the command needs to be repeated after changing the rules and after a failed import during a review (for example, when the engine was stopped). The import can be repeated, puzzle ids and solving history do not change.

## 7. Done

Check that `uv run coach fetch --days 7` downloads games: Lichess and chess.com must be reachable from the network. Then run the `build-profile` skill, this is the first session.

## What We Do Not Install Yet

Lc0, Maia-2, puzzle and opening databases, Syzygy tables are installed at stage 3 (see ROADMAP.md). First we need a working "game → review → profile" loop.
