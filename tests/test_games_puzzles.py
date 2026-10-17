from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest

from coach import cli, gamespuzzles
from coach.cli import main
from coach.config import ROOT

SUMMARY_LINE = "games: 3 puzzles from 1 reviews (5 candidates, 2 rejected); report out/x.html"


def result(code=0, out="", err=""):
    return SimpleNamespace(returncode=code, stdout=out, stderr=err)


def test_after_review_prints_count(capsys):
    gamespuzzles.after_review("abc", runner=lambda *a, **k: result(0, f"> board\n\n{SUMMARY_LINE}\n"))
    assert "задач из партии: 3" in capsys.readouterr().out


def test_after_review_survives_failure(capsys):
    err = (
        "engine service is not running: docker compose up -d engine\n"
        "npm error Lifecycle script `import` failed with error:\n"
        "npm error code 1\n"
        "npm error command sh -c node src/cli.ts games --game abc\n"
    )
    gamespuzzles.after_review("abc", runner=lambda *a, **k: result(1, "", err))
    out = capsys.readouterr().out
    assert "не добавлены: engine service is not running: docker compose up -d engine." in out
    assert "npm error" not in out
    assert "uv run coach puzzles import-games" in out


def test_after_review_survives_missing_npm(capsys):
    def runner(*a, **k):
        raise FileNotFoundError("npm")
    gamespuzzles.after_review("abc", runner=runner)
    out = capsys.readouterr().out
    assert "npm not found" in out
    assert "import-games" in out


def test_run_import_reports_timeout():
    def runner(*a, **k):
        raise subprocess.TimeoutExpired("npm", 1800)
    assert gamespuzzles.run_import(runner=runner) == (False, "timeout")


def test_run_import_passes_game_and_cwd():
    seen = {}

    def runner(args, **kw):
        seen["args"], seen["cwd"], seen["timeout"] = args, kw["cwd"], kw["timeout"]
        return result(0, SUMMARY_LINE)
    assert gamespuzzles.run_import("abc", runner=runner) == (True, SUMMARY_LINE)
    assert seen["args"][:3] == ["npm", "run", "--silent"]
    assert seen["args"][-3:] == ["games", "--game", "abc"]
    assert seen["cwd"] == ROOT / "web"
    assert seen["timeout"] == 1800


def test_run_import_without_game_has_no_game_flag_and_no_timeout():
    seen = {}

    def runner(args, **kw):
        seen["args"], seen["timeout"] = args, kw["timeout"]
        return result(0, SUMMARY_LINE)
    gamespuzzles.run_import(runner=runner)
    assert seen["args"][-1] == "games"
    assert seen["timeout"] is None


def test_run_import_only_npm_error_lines_falls_back():
    runner = lambda *a, **k: result(1, "", "npm error code 1\nnpm error boom\n")
    assert gamespuzzles.run_import(runner=runner) == (False, "npm error boom")


def test_import_games_command_exit_code(monkeypatch, capsys):
    from coach import puzzlescmd
    monkeypatch.setattr(cli, "load_config", lambda: SimpleNamespace())
    monkeypatch.setattr(puzzlescmd, "run_import", lambda: (True, SUMMARY_LINE))
    main(["puzzles", "import-games"])
    assert SUMMARY_LINE in capsys.readouterr().out
    monkeypatch.setattr(puzzlescmd, "run_import", lambda: (False, "engine down"))
    with pytest.raises(SystemExit) as exc:
        main(["puzzles", "import-games"])
    assert exc.value.code == 1
    assert "engine down" in capsys.readouterr().err


def _review_env(monkeypatch, tmp_path, cached):
    path = tmp_path / "g1.json"
    if cached:
        path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cli, "load_config", lambda: SimpleNamespace())
    monkeypatch.setattr(cli, "resolve_game", lambda *a: ({}, "g1", "lichess"))
    monkeypatch.setattr(cli, "REVIEWS", tmp_path)
    monkeypatch.setattr(cli, "ROOT", tmp_path)
    monkeypatch.setattr(cli, "review_game", lambda *a, **k: {})
    monkeypatch.setattr(cli, "format_review", lambda r: "review")
    calls = []
    monkeypatch.setattr(cli, "after_review", calls.append)
    return calls


def test_cached_review_does_not_import(monkeypatch, tmp_path):
    calls = _review_env(monkeypatch, tmp_path, cached=True)
    main(["review", "g1"])
    assert calls == []


def test_fresh_review_imports(monkeypatch, tmp_path):
    calls = _review_env(monkeypatch, tmp_path, cached=False)
    main(["review", "g1"])
    assert calls == ["g1"]
