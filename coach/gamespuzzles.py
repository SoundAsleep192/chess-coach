"""Puzzles from the student's own games: runs the TypeScript import (web/packages/puzzles) after a review."""
from __future__ import annotations

import re
import subprocess

from .config import ROOT

SUMMARY = re.compile(r"^games: (\d+) puzzles from (\d+) reviews")
TIMEOUT = 1800


def run_import(game: str | None = None, runner=subprocess.run) -> tuple[bool, str]:
    """`npm run --silent import -w @board/puzzles -- games [--game ID]` in ROOT/web.
    (True, summary line) or (False, reason: last stderr line that is not npm boilerplate,
    'npm not found', 'timeout'). The full run has no timeout, `--game` has TIMEOUT."""
    cmd = ["npm", "run", "--silent", "import", "-w", "@board/puzzles", "--", "games"]
    if game:
        cmd += ["--game", game]
    try:
        res = runner(cmd, cwd=ROOT / "web", capture_output=True, text=True, timeout=TIMEOUT if game else None)
    except FileNotFoundError:
        return False, "npm not found"
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except OSError as e:
        return False, str(e)
    if res.returncode != 0:
        lines = [ln.strip() for ln in (res.stderr or "").splitlines() if ln.strip()]
        own = [ln for ln in lines if not ln.startswith(("npm error", "npm ERR!"))]
        pick = own or lines
        return False, pick[-1] if pick else f"exit code {res.returncode}"
    for line in reversed((res.stdout or "").splitlines()):
        if SUMMARY.match(line):
            return True, line
    return False, "no summary line in the import output"


def after_review(gid: str, runner=subprocess.run) -> None:
    """Import puzzles from a fresh review and say how many came out. Never raises."""
    try:
        ok, text = run_import(gid, runner)
    except Exception as e:  # a review must not fail because of the import
        ok, text = False, str(e)
    m = SUMMARY.match(text) if ok else None
    if m:
        print(f"задач из партии: {m.group(1)}")
    else:
        print(f"задачи из партии не добавлены: {text}. Повторить: uv run coach puzzles import-games")
