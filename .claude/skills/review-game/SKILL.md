---
name: review-game
description: Review the student's game with the engine from a Lichess/chess.com link, an id, «последняя» (the latest) or «последнее поражение» (the latest loss). Use when the student asks to review a game, for example «разбери партию» (review the game), or sends a link to one.
---

# Game Review

## 1. Find the Game

- Lichess link or id: `uv run coach review <ref>` downloads the game itself.
- chess.com: first `uv run coach fetch --source chesscom`, then `uv run coach review <id>`.
- «Последняя» (the latest) → `latest`, «последнее поражение» (the latest loss) → `last-loss`.
- If it is unclear which game is meant: `uv run coach games --limit 10` and ask.

## 2. Run the Engine

`uv run coach review <ref>` takes 1-3 minutes. Tell the student you started it. Read the output. If you need details (clock times, all moves), look at `data/reviews/<id>.json`.

## 3. Ask for Impressions

While the review is running, ask in one message: where, in the student's view, the game broke down, whether there was time trouble, what was unclear. Their answer will suggest which moments to take.

## 4. Pick 3-5 Moments

Priority:
1. Blunders.
2. Missed chances (`MISSED-CHANCE`).
3. Mistakes that repeat patterns from the profile.
4. Mistakes in time trouble. Here the lesson is about time management, not about chess.

Skip opening inaccuracies unless they repeat from game to game.

## 5. Each Moment

1. `uv run coach show --game <id> --ply <N> --caption "Ход за чёрных. Что играешь?"` (Black to move. What do you play?; the first time add `--open`). Do not draw the best-move arrow.
2. Ask what the student would play now and what they were thinking then. Wait for the answer.
3. If the student suggests a move, check it: `uv run coach analyze --game <id> --ply <N> --moves "<move>"`. Do not judge by eye.
4. Explain why the played move is bad (the refutation is in the review output, the "after …" line), what was better and, most importantly, by what idea this move could have been found at the board. Then show `coach show ... --played X --best Y`.
5. State the lesson in one sentence and assign the mistake to a category from CLAUDE.md.

## 6. Wrap-Up

One main takeaway and 1-2 exercises. An exercise is the FEN of a critical moment with the task "find the move for …". Do not show the solution right away.

## 7. Report

Write your notes into `data/reviews/<id>.notes.json`: the key is the half-move number, plus `_summary` with the summary. Then run `uv run coach report <id>`, the report opens in the browser.

## 8. Profile

Update `profile/player.md`:
- The category is already under «Слабости» (Weaknesses): +1 to the counter and an example `id · half-move`.
- A new category: record it under «Наблюдения» (Observations). Move it to «Слабости» when it occurs a second time.
- Add a line to the session log («Журнал занятий»).
