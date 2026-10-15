from __future__ import annotations

import os
import shutil
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


def _find_root() -> Path:
    env = os.environ.get("COACH_HOME")
    if env:
        return Path(env).expanduser().resolve()
    here = Path.cwd().resolve()
    for p in (here, *here.parents):
        if (p / "coach.toml").is_file():
            return p
    return Path(__file__).resolve().parent.parent


ROOT = _find_root()
DATA = ROOT / "data"
GAMES = DATA / "games"
REVIEWS = DATA / "reviews"
OUT = ROOT / "out"


@dataclass
class Config:
    lichess: str = ""
    chesscom: str = ""
    otb_name: str = ""
    engine_path: str = ""
    threads: int = 4
    hash_mb: int = 256
    time_per_move: float = 0.4
    deep_time: float = 3.0
    inaccuracy: float = 5.0
    mistake: float = 10.0
    blunder: float = 15.0
    puzzle_themes: list[str] = field(default_factory=list)
    puzzle_rating: int | None = None

    @property
    def usernames(self) -> set[str]:
        return {u.lower() for u in (self.lichess, self.chesscom, self.otb_name) if u}


def load_config() -> Config:
    cfg = Config()
    path = ROOT / "coach.toml"
    if not path.is_file():
        return cfg
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    player = data.get("player", {})
    engine = data.get("engine", {})
    review = data.get("review", {})
    puzzles = data.get("puzzles", {})
    cfg.lichess = player.get("lichess", cfg.lichess)
    cfg.chesscom = player.get("chesscom", cfg.chesscom)
    cfg.otb_name = player.get("otb_name", cfg.otb_name)
    cfg.engine_path = engine.get("path", cfg.engine_path)
    cfg.threads = int(engine.get("threads", cfg.threads))
    cfg.hash_mb = int(engine.get("hash_mb", cfg.hash_mb))
    cfg.time_per_move = float(review.get("time_per_move", cfg.time_per_move))
    cfg.deep_time = float(review.get("deep_time", cfg.deep_time))
    cfg.inaccuracy = float(review.get("inaccuracy", cfg.inaccuracy))
    cfg.mistake = float(review.get("mistake", cfg.mistake))
    cfg.blunder = float(review.get("blunder", cfg.blunder))
    cfg.puzzle_themes = [str(t) for t in puzzles.get("themes", [])]
    if puzzles.get("rating") is not None:
        cfg.puzzle_rating = int(puzzles["rating"])
    return cfg


def find_stockfish(cfg: Config) -> str:
    candidates = [
        os.environ.get("COACH_STOCKFISH"),
        cfg.engine_path,
        shutil.which("stockfish"),
        "/opt/homebrew/bin/stockfish",
        "/usr/local/bin/stockfish",
        str(ROOT / "engines" / "stockfish"),
    ]
    for c in candidates:
        if not c:
            continue
        p = Path(c).expanduser()
        if not p.is_absolute():
            p = ROOT / p
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    raise SystemExit(
        "Stockfish not found. Install it (brew install stockfish) or set [engine].path "
        "in coach.toml / $COACH_STOCKFISH."
    )
