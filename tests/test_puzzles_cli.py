from __future__ import annotations

import pytest

from coach import cli
from coach import config as configmod
from coach.cli import main
from coach.config import Config, load_config
from tests.fakes import make_state

FORK_FEN = "q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1"


def puzzle_response(kind: str = "new") -> dict:
    state = make_state([], fen=FORK_FEN, mode="puzzle")
    state["puzzle"] = {"puzzleId": "raduga:1-001", "label": "Дорофеева, т.1 №1", "side": "white",
                       "solution": ["d5c7", "e8d7", "c7a8"], "done": 0, "status": "solving",
                       "startedAt": "2026-10-11T10:00:00.000Z"}
    return {"puzzle": {"id": "raduga:1-001", "source": "raduga", "ref": "Дорофеева, т.1 №1", "page": 7,
                       "themes": ["fork"], "side": "white", "kind": kind, "label": "Дорофеева, т.1 №1"},
            "state": state}


STATS = {
    "since": "2026-10-01",
    "total": {"attempts": 3, "solved": 2},
    "byTheme": [{"key": "fork", "attempts": 2, "solved": 1}, {"key": "mate", "attempts": 1, "solved": 1}],
    "bySource": [{"key": "raduga", "attempts": 2, "solved": 1}, {"key": "lichess", "attempts": 1, "solved": 1}],
    "recent": [
        {"id": "raduga:1-001", "ref": "Дорофеева, т.1 №1", "source": "raduga", "at": "2026-10-11T10:05:00.000Z",
         "correct": False, "ms": 41000},
        {"id": "lichess:abc", "source": "lichess", "at": "2026-10-11T10:01:00.000Z", "correct": True, "ms": 9000,
         "weaker": 1, "altBetter": True},
    ],
    "queue": [
        {"id": "raduga:1-001", "ref": "Дорофеева, т.1 №1", "due": "2026-10-11T10:06:00.000Z", "lastCorrect": False},
        {"id": "lichess:abc", "due": "2026-10-11T10:11:00.000Z", "lastCorrect": True},
    ],
    "counts": [{"source": "lichess", "puzzles": 5000, "disputed": 0}, {"source": "raduga", "puzzles": 1320, "disputed": 4}],
}


@pytest.fixture
def cfg(monkeypatch):
    c = Config(puzzle_themes=["fork", "pin"], puzzle_rating=1450)
    monkeypatch.setattr(cli, "load_config", lambda: c)
    return c


def test_next_sends_default_themes_and_rating_from_coach_toml(fake_board, cfg, capsys):
    fake_board.route("POST", "/api/puzzles/next", 200, puzzle_response())
    main(["puzzles", "next"])
    assert fake_board.requests[0] == ("POST", "/api/puzzles/next", {"themes": ["fork", "pin"], "rating": 1450})
    out = capsys.readouterr().out
    assert "puzzle raduga:1-001 (new): Дорофеева, т.1 №1; page 7; fork" in out
    assert "White to move" in out
    assert f"FEN {FORK_FEN}" in out


def test_next_with_theme_source_and_id(fake_board, cfg):
    fake_board.route("POST", "/api/puzzles/next", 200, puzzle_response("id"))
    main(["puzzles", "next", "--theme", "pin", "--source", "lichess"])
    main(["puzzles", "next", "--id", "raduga:1-001"])
    assert fake_board.requests[0][2] == {"theme": "pin", "source": "lichess", "rating": 1450}
    assert fake_board.requests[1][2] == {"id": "raduga:1-001"}


def test_next_without_puzzles_lists_available_themes(fake_board, cfg, capsys):
    fake_board.route("POST", "/api/puzzles/next", 404, {
        "code": "not_found", "message": "no puzzles for themes zugzwang", "version": 3,
        "available": [{"theme": "fork", "count": 120}, {"theme": "mate", "count": 80}]})
    with pytest.raises(SystemExit) as exc:
        main(["puzzles", "next", "--theme", "zugzwang"])
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "no puzzles for themes zugzwang" in err
    assert "themes with puzzles: fork (120), mate (80)" in err


def test_stats_prints_totals_rows_recent_queue_and_counts(fake_board, cfg, capsys):
    fake_board.route("GET", "/api/puzzles/stats?since=2026-10-01", 200, STATS)
    main(["puzzles", "stats", "--since", "2026-10-01"])
    out = capsys.readouterr().out
    assert "puzzles since 2026-10-01: 2/3 solved  67%" in out
    assert "  fork                    1/2     50%" in out
    assert "2026-10-11 10:05  raduga:1-001       FAILED 41s  Дорофеева, т.1 №1" in out
    assert "2026-10-11 10:01  lichess:abc        solved 9s weaker 1 stronger-than-book" in out
    assert out.index("queue (next reviews first):") < out.index("2026-10-11 10:06  raduga:1-001")
    assert "in base: lichess 5000, raduga 1320 (4 disputed)" in out


def test_stats_rejects_a_bad_date(fake_board, cfg):
    with pytest.raises(SystemExit) as exc:
        main(["puzzles", "stats", "--since", "11.10.2026"])
    assert "YYYY-MM-DD" in str(exc.value.code)
    assert fake_board.requests == []


def test_puzzles_fail_with_a_hint_when_the_server_is_down(no_board, cfg, capsys):
    with pytest.raises(SystemExit) as exc:
        main(["puzzles", "next"])
    assert exc.value.code == 1
    assert "docker compose up board" in capsys.readouterr().err


def test_config_reads_the_puzzles_section(tmp_path, monkeypatch):
    (tmp_path / "coach.toml").write_text('[puzzles]\nthemes = ["fork", "pin"]\nrating = 1450\n', encoding="utf-8")
    monkeypatch.setattr(configmod, "ROOT", tmp_path)
    c = load_config()
    assert c.puzzle_themes == ["fork", "pin"]
    assert c.puzzle_rating == 1450
