---
name: build-profile
description: First session and updating the student model. Download games from Lichess and chess.com, collect statistics, review a batch of losses, fill in profile/player.md and the training plan. Use on first run, if the profile is empty, or when asked «обнови профиль» (update the profile), «что мне тренировать» (what should I train).
---

# Student Profile

## 1. Check the Environment

`uv run coach doctor`. If the engine is not found, follow SETUP.md.

## 2. Download Games

`uv run coach fetch`. The first time it downloads games for 180 days. If there are few games, repeat with `--days 365`.

## 3. Statistics

`uv run coach stats`. Determine the main time control (the one with the most games), current ratings and openings with a score below 40%.

## 4. Interview

In one message, no more than 5 questions:
- Goal: rating, a tournament, or just enjoying the game.
- Which time control is the main one and whether they want to change it.
- How much time per week they are ready to spend on training.
- What they themselves consider their weak spots.
- Experience: how long they have been playing, whether they had a coach or a club, which books they have read.

## 5. Batch Review

This is data collection. Do not discuss each game with the student.

1. Get the list: `uv run coach games --result loss --tc <main> --unreviewed --limit 8`, plus 2-3 recent wins.
2. For each one run `uv run coach review <id> --deep-time 1.5`. This takes about a minute per game. Tell the student how long it will take.
3. Go through the critical moments of each review and assign the mistakes to the categories from CLAUDE.md. For non-obvious moments check the `analyze` output.

## 6. Summary

`uv run coach stats`, the REVIEWS section: mistakes by phase, time trouble, missed chances.

## 7. Fill In profile/player.md

- Ratings and main time control.
- Goals from the interview.
- Repertoire from the opening statistics.
- Weaknesses: only confirmed ones (2+ cases), with examples `id · half-move`.
- Strengths.
- 2-week plan: 3-4 sessions, for each one what we do and with what.

## 8. Show the Student

Briefly: the 3 main weaknesses, one example for each (`coach show` positions), and the plan. Ask whether the student agrees. The student knows themselves better than the engine does: if they disagree, correct the profile.
