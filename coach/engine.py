from __future__ import annotations

import math
import re
from contextlib import contextmanager
from dataclasses import dataclass

import chess
import chess.engine

from .config import Config, find_stockfish

MATE_CP = 10000


def win_pct(cp: int) -> float:
    """Lichess win% model: centipawns (White POV) -> White's winning chances, 0..100."""
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(drop: float) -> float:
    """Lichess-style per-move accuracy from a win% drop."""
    acc = 103.1668 * math.exp(-0.04354 * max(0.0, drop)) - 3.1669
    return max(0.0, min(100.0, acc))


def fmt_score(score: chess.engine.Score) -> str:
    """Format a White-POV score: +1.25, -0.40, #3, #-2."""
    if score.is_mate():
        m = score.mate()
        if m == 0:
            return "mate, White won" if score.score(mate_score=1) > 0 else "mate, Black won"
        return f"#{m}" if m > 0 else f"#-{-m}"
    return f"{score.score() / 100:+.2f}"


def fmt_cp(cp: int) -> str:
    if abs(cp) >= MATE_CP - 500:
        return "#" if cp > 0 else "#-"
    return f"{cp / 100:+.2f}"


@contextmanager
def open_engine(cfg: Config):
    eng = chess.engine.SimpleEngine.popen_uci(find_stockfish(cfg))
    try:
        opts = {"Threads": cfg.threads, "Hash": cfg.hash_mb}
        if "UCI_ShowWDL" in eng.options:
            opts["UCI_ShowWDL"] = True
        eng.configure(opts)
        yield eng
    finally:
        eng.quit()


def make_limit(time: float | None = None, depth: int | None = None) -> chess.engine.Limit:
    if depth:
        return chess.engine.Limit(depth=depth)
    return chess.engine.Limit(time=time or 1.0)


@dataclass
class Line:
    rank: int
    score: chess.engine.Score  # White POV
    cp: int  # White POV, mates mapped to +-MATE_CP
    wdl: tuple[int, int, int] | None  # White POV, per mille
    depth: int | None
    moves: list[chess.Move]
    san: str  # numbered SAN of the PV

    def as_dict(self, board: chess.Board) -> dict:
        return {
            "rank": self.rank,
            "eval": fmt_score(self.score),
            "cp": self.cp,
            "wdl": list(self.wdl) if self.wdl else None,
            "depth": self.depth,
            "best": board.san(self.moves[0]) if self.moves else None,
            "best_uci": self.moves[0].uci() if self.moves else None,
            "pv": self.san,
        }


def terminal_line(board: chess.Board) -> Line | None:
    if board.is_checkmate():
        # Side to move is mated. White POV: MateGiven if Black is mated, Mate(-0) if White is.
        white_won = board.turn == chess.BLACK
        score = chess.engine.MateGiven if white_won else -chess.engine.MateGiven
        cp = MATE_CP if white_won else -MATE_CP
        wdl = (1000, 0, 0) if white_won else (0, 0, 1000)
        return Line(1, score, cp, wdl, None, [], "checkmate")
    if board.is_stalemate() or board.is_insufficient_material():
        return Line(1, chess.engine.Cp(0), 0, (0, 1000, 0), None, [], "draw")
    return None


def analyse(
    eng: chess.engine.SimpleEngine,
    board: chess.Board,
    limit: chess.engine.Limit,
    multipv: int = 1,
    pv_plies: int = 10,
) -> list[Line]:
    term = terminal_line(board)
    if term:
        return [term]
    infos = eng.analyse(board, limit, multipv=multipv)
    lines = []
    for i, info in enumerate(infos, 1):
        score = info["score"].white()
        pv = info.get("pv", [])[:pv_plies]
        wdl = info.get("wdl")
        wdl_t = None
        if wdl is not None:
            w = wdl.white()
            wdl_t = (w.wins, w.draws, w.losses)
        lines.append(
            Line(
                rank=i,
                score=score,
                cp=score.score(mate_score=MATE_CP),
                wdl=wdl_t,
                depth=info.get("depth"),
                moves=pv,
                san=board.variation_san(pv) if pv else "",
            )
        )
    return lines


_MOVE_NO = re.compile(r"^\d+\.+")


def _move_tokens(text: str):
    """Yield (raw, token) for each move in '1. e4 e5, 2... Nf3'; move numbers, '...' and '*' are skipped."""
    for raw in text.replace(",", " ").split():
        tok = _MOVE_NO.sub("", raw).rstrip("!?")
        if tok and tok not in ("...", "*"):
            yield raw, tok


def split_moves(text: str) -> list[str]:
    """'43... Kd6 44. Ne2, Ne5' -> ['Kd6', 'Ne2', 'Ne5']."""
    return [tok for _, tok in _move_tokens(text)]


def apply_moves(board: chess.Board, moves: str) -> chess.Board:
    """Apply a space-separated list of SAN/UCI moves (move numbers allowed). Raises ValueError on illegal moves."""
    b = board.copy()
    for raw, tok in _move_tokens(moves):
        try:
            mv = b.parse_san(tok)
        except ValueError:
            try:
                mv = chess.Move.from_uci(tok)
                if mv not in b.legal_moves:
                    raise ValueError
            except ValueError:
                legal = " ".join(b.san(m) for m in b.legal_moves)
                raise ValueError(
                    f"Illegal or unparsable move '{raw}' at ply {b.ply()} in position {b.fen()}. "
                    f"Legal moves: {legal}"
                ) from None
        b.push(mv)
    return b
