"""coach — command-line entry point."""
from __future__ import annotations

import argparse
import json
import signal
import sys

import chess
import chess.engine

from . import board as boardmod
from .config import GAMES, REVIEWS, ROOT, find_stockfish, load_config
from .engine import analyse, apply_moves, make_limit, open_engine
from .boardclient import BoardClient, BoardError, BoardUnavailable
from .boardcmd import add_board_parser, arrows_for, cmd_board, show_on_server, svg_arrow
from .games import fetch, filter_games, import_otb, is_reviewed, load_index, player_color, rebuild_index, resolve_game
from .review import format_review, review_game
from .stats import stats_text


# ---------------------------------------------------------------- position helper

def resolve_position(args, cfg):
    """Returns (board, orientation, lastmove). --game/--ply or FEN/'start', then optional --moves."""
    orientation = None
    lastmove = None
    if getattr(args, "game", None):
        game, gid, src = resolve_game(args.game, cfg)
        b = game.board()
        moves = list(game.mainline_moves())
        n = len(moves) if args.ply is None else max(0, min(len(moves), args.ply - 1))
        for mv in moves[:n]:
            b.push(mv)
            lastmove = mv
        orientation = player_color(game, cfg)
    else:
        pos = " ".join(args.position).strip() if args.position else "start"
        try:
            b = chess.Board() if pos in ("start", "startpos") else chess.Board(pos)
        except ValueError as e:
            raise SystemExit(f"Bad FEN: {e}")
    if getattr(args, "moves", None):
        try:
            b = apply_moves(b, args.moves)
        except ValueError as e:
            raise SystemExit(str(e))
        if b.move_stack:
            lastmove = b.move_stack[-1]
    if orientation is None:
        orientation = b.turn
    if getattr(args, "black", False):
        orientation = chess.BLACK
    if getattr(args, "white", False):
        orientation = chess.WHITE
    return b, orientation, lastmove


def add_position_args(p):
    p.add_argument("position", nargs="*", help="FEN (quoted or not) or 'start'. Default: start")
    p.add_argument("--moves", help="SAN/UCI moves to apply first, e.g. '1. e4 e5 2. Nf3'")
    p.add_argument("--game", help="game ref: id, URL, path.pgn, 'latest', 'last-loss'")
    p.add_argument("--ply", type=int, help="with --game: position BEFORE ply N is played (same numbering as review). "
                                           "Default: final position")


# ---------------------------------------------------------------- commands

def cmd_doctor(args, cfg):
    print(f"project root : {ROOT}")
    print(f"players      : lichess={cfg.lichess or '-'}  chess.com={cfg.chesscom or '-'}")
    try:
        path = find_stockfish(cfg)
        eng = chess.engine.SimpleEngine.popen_uci(path)
        name = eng.id.get("name", "?")
        has_wdl = "UCI_ShowWDL" in eng.options
        max_threads = eng.options["Threads"].max if "Threads" in eng.options else "?"
        eng.quit()
        print(f"engine       : {name}  ({path})")
        print(f"engine opts  : threads={cfg.threads} (max {max_threads}), hash={cfg.hash_mb}MB, WDL={'yes' if has_wdl else 'no'}")
        if "Stockfish" in name and not any(v in name for v in ("19", "20", "21", "dev")):
            print("  ! older Stockfish than 19 — see SETUP.md to build the latest from source")
    except SystemExit as e:
        print(f"engine       : NOT FOUND — {e}")
    print(f"python-chess : {chess.__version__}")
    n_games = sum(1 for _ in GAMES.glob("*/*.pgn")) if GAMES.is_dir() else 0
    n_rev = sum(1 for p in REVIEWS.glob("*.json") if not p.name.endswith(".notes.json")) if REVIEWS.is_dir() else 0
    print(f"data         : {n_games} games, {n_rev} reviews")
    if sys.platform == "darwin":
        print("tip          : threads = performance cores: sysctl -n hw.perflevel0.physicalcpu")


def cmd_fetch(args, cfg):
    sources = ["lichess", "chesscom"] if args.source == "all" else [args.source]
    fetch(cfg, sources, args.since, args.days, args.max)


def cmd_import(args, cfg):
    results = [r.strip() for r in args.results.split(",")] if args.results else None
    n = import_otb(cfg, args.ref, args.tc, args.color, results)
    print(f"imported {n} games into data/games/otb")


def cmd_games(args, cfg):
    idx = rebuild_index(cfg) if args.reindex else load_index(cfg)
    rows = filter_games(idx, args.source, args.result, args.tc, args.color, args.opening, args.unreviewed, args.since)
    rows = rows[: args.limit]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    if not rows:
        print("No games match. Run: coach fetch")
        return
    for r in rows:
        col = {"white": "W", "black": "B"}.get(r["color"], "?")
        rev = " [reviewed]" if is_reviewed(r["id"]) else ""
        print(f"{r['date'][:10]}  {r['source']:<8} {r['id']:<12} {col}  {(r['player_result'] or '?'):<5} "
              f"{r['time_class']:<9} {r['my_elo'] or '?':>5} vs {r['opponent']} ({r['opp_elo']})  "
              f"{r['eco']} {r['opening']}{rev}")


def cmd_analyze(args, cfg):
    b, _, _ = resolve_position(args, cfg)
    with open_engine(cfg) as eng:
        lines = analyse(eng, b, make_limit(args.time, args.depth), multipv=args.multipv, pv_plies=args.pv)
        name = eng.id.get("name", "engine")
    if args.json:
        print(json.dumps({"fen": b.fen(), "turn": "white" if b.turn else "black", "engine": name,
                          "lines": [ln.as_dict(b) for ln in lines]}, ensure_ascii=False, indent=1))
        return
    side = "White" if b.turn == chess.WHITE else "Black"
    depth = lines[0].depth if lines else None
    print(f"FEN {b.fen()}")
    print(f"{side} to move · {name} · depth {depth} · evals White POV")
    for ln in lines:
        d = ln.as_dict(b)
        wdl = f"  W/D/L {ln.wdl[0] / 10:.0f}/{ln.wdl[1] / 10:.0f}/{ln.wdl[2] / 10:.0f}%" if ln.wdl else ""
        print(f" {ln.rank}) {d['eval']:>7}{wdl}   {ln.san}")


def cmd_review(args, cfg):
    game, gid, src = resolve_game(args.game, cfg)
    path = REVIEWS / f"{gid}.json"
    if path.is_file() and not args.force:
        r = json.loads(path.read_text(encoding="utf-8"))
        print("(cached review; --force to re-run)")
    else:
        deep = 0 if args.no_deep else args.deep_time
        r = review_game(cfg, game, gid, src, time_per_move=args.time, deep_time=deep)
    print(format_review(r))
    print(f"\nSaved: {path.relative_to(ROOT)} · report: coach report {gid}")


def cmd_stats(args, cfg):
    idx = load_index(cfg)
    print(stats_text(idx, args.since, args.tc))


def cmd_show(args, cfg):
    b, orientation, lastmove = resolve_position(args, cfg)
    arrows = arrows_for(b.fen(), args.best, args.played, args.arrows)
    client = BoardClient()
    try:
        ply_offset = max(0, len(b.move_stack) - 1) if getattr(args, "game", None) else None
        state = show_on_server(client, b, orientation, arrows, args.caption, ply_offset)
        print(f"board: {client.base_url}  (live server, version {state['version']})")
        print(f"FEN {b.fen()}")
        return
    except BoardUnavailable:
        print("board server is not running: writing out/board.html (no live board)")
    except BoardError as e:
        raise SystemExit(f"board server rejected the position: {e}")
    path = boardmod.write_live(b, orientation, [svg_arrow(a) for a in arrows], lastmove, args.caption or "")
    print(f"board: {path}  (page auto-refreshes every 2s)")
    print(f"FEN {b.fen()}")
    if args.open:
        boardmod.open_file(path)


def cmd_report(args, cfg):
    _, gid, _ = resolve_game(args.game, cfg)
    path = REVIEWS / f"{gid}.json"
    if not path.is_file():
        raise SystemExit(f"No review for {gid}. Run: coach review {gid}")
    out = boardmod.write_report(json.loads(path.read_text(encoding="utf-8")))
    print(f"report: {out}")
    if not args.no_open:
        boardmod.open_file(out)


# ---------------------------------------------------------------- parser

def main(argv=None):
    ap = argparse.ArgumentParser(prog="coach", description="Chess coaching toolkit (Stockfish + your games)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="check engine, config and data")

    p = sub.add_parser("fetch", help="download your games from Lichess / Chess.com")
    p.add_argument("--source", choices=["all", "lichess", "chesscom"], default="all")
    p.add_argument("--since", help="YYYY-MM-DD (default: incremental, or last 180 days on first run)")
    p.add_argument("--days", type=int, help="last N days")
    p.add_argument("--max", type=int, help="max games per source")

    p = sub.add_parser("import", help="import over-the-board games from a Lichess study or PGN file")
    p.add_argument("ref", help="Lichess study URL/id or path.pgn")
    p.add_argument("--tc", required=True, help="TimeControl like 600+5, or a time class: rapid, classical")
    p.add_argument("--color", choices=["white", "black"], help="your colour where the PGN doesn't name players")
    p.add_argument("--results", help="results in chapter order where the PGN has '*', e.g. '1-0,0-1,1/2-1/2'")

    p = sub.add_parser("games", help="list stored games (newest first)")
    p.add_argument("--source", choices=["lichess", "chesscom", "otb"])
    p.add_argument("--result", choices=["win", "loss", "draw"])
    p.add_argument("--tc", help="time class: bullet, blitz, rapid, classical, daily")
    p.add_argument("--color", choices=["white", "black"])
    p.add_argument("--opening", help="substring of the opening name")
    p.add_argument("--unreviewed", action="store_true")
    p.add_argument("--since", help="YYYY-MM-DD")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--reindex", action="store_true")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("analyze", help="engine analysis of a position (also validates move sequences)")
    add_position_args(p)
    p.add_argument("--multipv", type=int, default=3)
    p.add_argument("--time", type=float, default=3.0, help="seconds (default 3)")
    p.add_argument("--depth", type=int, help="fixed depth instead of time")
    p.add_argument("--pv", type=int, default=10, help="plies of each line to print")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("review", help="full-game review with critical moments")
    p.add_argument("game", help="id, URL, path.pgn, 'latest' or 'last-loss'")
    p.add_argument("--time", type=float, help="seconds per position (default from coach.toml)")
    p.add_argument("--deep-time", type=float, help="seconds per critical position (default from coach.toml)")
    p.add_argument("--no-deep", action="store_true")
    p.add_argument("--force", action="store_true", help="re-run even if a review exists")

    p = sub.add_parser("stats", help="results by time class, color, opening + aggregated review errors")
    p.add_argument("--since", help="YYYY-MM-DD")
    p.add_argument("--tc", help="time class filter")

    p = sub.add_parser("show", help="show one position on the live board (falls back to out/board.html)")
    add_position_args(p)
    p.add_argument("--best", help="green arrow (SAN or e2e4)")
    p.add_argument("--played", help="red arrow (SAN or e2e4)")
    p.add_argument("--arrows", help="blue arrows, comma-separated")
    p.add_argument("--caption", help="text under the board")
    p.add_argument("--white", action="store_true", help="force White at the bottom")
    p.add_argument("--black", action="store_true", help="force Black at the bottom")
    p.add_argument("--open", action="store_true", help="open in the browser (needed once per session)")

    add_board_parser(sub)

    p = sub.add_parser("report", help="HTML report of a reviewed game (boards, eval curve, coach notes)")
    p.add_argument("game")
    p.add_argument("--no-open", action="store_true")

    args = ap.parse_args(argv)
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # quiet exit when piped into head/less
    cfg = load_config()
    {
        "doctor": cmd_doctor, "fetch": cmd_fetch, "import": cmd_import, "games": cmd_games, "analyze": cmd_analyze,
        "review": cmd_review, "stats": cmd_stats, "show": cmd_show, "report": cmd_report, "board": cmd_board,
    }[args.cmd](args, cfg)


if __name__ == "__main__":
    main()
