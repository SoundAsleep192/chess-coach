# Roadmap

## Stage 1 - Done: The "Game → Review → Profile" Loop

Stockfish + python-chess, game import from Lichess and chess.com, review with critical moments, statistics, board and HTML report, student profile, the `build-profile` and `review-game` skills.

## Stage 2 - Live Two-Way Board

Goal: the student makes moves on the board, and the coach reads them.

### 2a - Done (2026-10-11)

Spec and plan in `docs/superpowers/`.

- `web/`: Nest server with MongoDB (REST and WebSocket, one move tree), client on Vite + React + TypeScript, board `react-chessboard` (MIT), logic `chess.js` (BSD-2). Runs in Docker (`docker compose up board`, port 8765).
- Game and lines with branches, navigation with arrow keys and clicks, as in Lichess analysis.
- The coach switches between the `freeze` and `free` modes. In free mode the student browses and makes their own moves; the coach sees them in `coach board state` marked `{ученик}` (student).
- `coach board load|line|goto|mode|state|delete`. `coach show` goes through the server, and without the server writes `out/board.html` as before.

### 2b - Done (2026-10-16)

Spec and plan in `docs/superpowers/`.

- Queue of student actions on the server and the `coach inbox` command.
- The `UserPromptSubmit` hook in `.claude/settings.json` attaches the queue to the student's message.
- Panel next to the board: eval bar and engine lines, which only the coach turns on, and a coach's note (`coach board panel`, `coach board note`).
- Loose ends from 2a closed: Origin check on the WebSocket, validation of HTTP request bodies, trimming lines from the PGN by `--upto`, pawn promotion by dragging, healthcheck for the `board` service.

## Stage 3 - Training Content

- **Maia-2** (CSSLab, MIT, PyTorch; runs on M1 via MPS). Before installing, check the README at github.com/CSSLab/maia2.
  - In the review: which move a human of your rating would play and with what probability. If Stockfish wants one move and Maia at your level almost certainly plays another, that is a blind spot typical for the level, and therefore a training topic.
  - Sparring: `coach play --maia 1600` on the board from stage 2.
- **Puzzles - done (2026-10-11).** Spec and plan in `docs/superpowers/`. The Lichess database with a quality filter, Polgar's «5334» and Dorofeeva's «Радуга тактических приёмов» ("Rainbow of Tactical Techniques") 1-7 (book data stays local only, `data/books/`), solutions from Stockfish (always for «Радуга», for Polgar where there is no book answer). A puzzle is solved on the live board (`puzzle` mode), FSRS repetition (`ts-fsrs`), `coach puzzles next|stats`.
- **Puzzles v2 - done (2026-10-12).** Spec and plan in `docs/superpowers/`. Engine service in Docker (`web/packages/engine`: Stockfish 19 from source, a process pool with `Threads=1`, HTTP API), used by the board and the import. Every move in a puzzle is judged by the engine: an equivalent one is accepted, «слабее» (weaker) is not a mistake, a wrong one is refuted on the board with arrows and a description, «Ещё раз» (Try again), «Показать решение» (Show solution), «Найти другое» (Find another) for a second solution. New puzzles come from the books first, «Радуга» was re-imported with the soft rule (the first move wins).
- **Puzzles from own games - done, accepted 2026-10-17 (74 puzzles from 66 reviews).** Spec `docs/superpowers/specs/2026-10-16-own-game-puzzles-design.md`, plan `docs/superpowers/plans/2026-10-16-own-game-puzzles.md`. Missed tactics and only moves from reviewed games become puzzles of the `games` source in the same deck and are served before books and Lichess; the import runs by itself after `coach review`, and there is `coach puzzles import-games`; a new bottom outcome class "lost" (проигрыш).
- **Openings.** The `lichess-org/chess-openings` catalog (CC0) to detect the moment of leaving theory. The repertoire is stored in PGN, line training with spaced repetition.
- **Endgame.** The Lichess tablebase API (`tablebase.lichess.ovh`) or local 5-piece Syzygy (about 1 GB). Practicing typical positions against the engine.
- **Lc0.** Needed once the PC with an RTX 3070 is built (CUDA, 8 GB is enough for standard networks). On M1 it should work via Metal - check `brew info lc0`. For training it adds little on top of Stockfish, but it is also what runs the Maia-1 weights.
- **Experiment.** Fine-tune Maia on your own games and get a "digital twin" that predicts your moves. Positions where the twin confidently goes wrong become a personal puzzle set. This is where the 3070 comes in.

## Stage 4 - Platform

- Turn the `coach` core into an MCP server with the tools analyze, review, show, puzzles, profile. The same server will work both in Claude Code and in the web app.
- At the same time move `coach` from Python to TypeScript as a separate package in the `web/` monorepo (decision of 2026-10-10: the whole project in one language, the student does not write Python). Replacements: `chess.js`, PGN parsing with branches, an own UCI wrapper for Stockfish, the MCP SDK for TypeScript. Safety net: the new version on the same games must match the saved reviews in `data/reviews/` (they are not in git, only on disk - make a backup before the migration) in move classes and critical moments, with automatic comparison. Until this stage `coach` stays in Python and runs on the host, outside Docker. During the migration `coach analyze` and `review` switch from the local Stockfish to the engine service from stage 3 (`web/packages/engine`, `POST /analyse`).
- A web app with Claude via the Claude API or Agent SDK, profiles for several students, sign-in via Lichess OAuth to import games.
- Licenses:
  - Stockfish (GPL-3) can be used on the server.
  - If the binary is distributed together with the app, the GPL has to be followed.
  - Build the front end on MIT/BSD libraries.
  - Lichess data is CC0, Maia-2 is MIT.
  - Lichess and chess.com APIs: respect their rate limits and rules.
