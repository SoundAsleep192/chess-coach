"""`coach puzzles next|stats`: tactics puzzles on the live board server (web/packages/server)."""
from __future__ import annotations

import re
import sys

from .boardclient import BoardClient, BoardError, BoardUnavailable
from .boardcmd import position_line
from .config import Config
from .gamespuzzles import run_import

SIDE = {"white": "White", "black": "Black"}


def next_body(args, cfg: Config) -> dict:
    """--id wins; else --theme or the default themes from coach.toml; rating from coach.toml for Lichess."""
    if args.id:
        return {"id": args.id}
    body: dict = {}
    if args.theme:
        body["theme"] = args.theme
    elif cfg.puzzle_themes:
        body["themes"] = cfg.puzzle_themes
    if args.source:
        body["source"] = args.source
    if cfg.puzzle_rating:
        body["rating"] = cfg.puzzle_rating
    return body


def describe(p: dict) -> str:
    parts = [p.get("ref") or p["source"]]
    if p.get("rating"):
        parts.append(f"rating {p['rating']}")
    if p.get("page"):
        parts.append(f"page {p['page']}")
    parts.append(", ".join(p["themes"]) or "no themes")
    return "; ".join(parts)


def pct(row: dict) -> str:
    return f"  {round(100 * row['solved'] / row['attempts'])}%" if row["attempts"] else ""


def _when(iso: str) -> str:
    return iso[:16].replace("T", " ")


def puzzles_next(client: BoardClient, args, cfg: Config) -> None:
    res = client.puzzle_next(next_body(args, cfg))
    p, state = res["puzzle"], res["state"]
    kind = {"due": "review", "new": "new", "id": "by id"}[p["kind"]]
    print(f"puzzle {p['id']} ({kind}): {describe(p)}")
    print(f"{SIDE[p['side']]} to move. The board checks the moves itself; read the result with: coach board state")
    print(f"FEN {state['rootFen']}")
    print(position_line(state))


def puzzles_stats(client: BoardClient, args) -> None:
    if args.since and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.since):
        raise SystemExit(f"--since must be YYYY-MM-DD, got {args.since}")
    s = client.puzzle_stats(args.since)
    t = s["total"]
    head = f"since {s['since']}" if s["since"] else "all time"
    print(f"puzzles {head}: {t['solved']}/{t['attempts']} solved{pct(t)}")
    for title, rows in (("by source", s["bySource"]), ("by theme", s["byTheme"])):
        print(f"{title}:")
        if not rows:
            print("  none")
        for r in rows:
            print(f"  {r['key']:<20} {r['solved']:>4}/{r['attempts']:<4}{pct(r)}")
    print("recent:")
    for a in s["recent"]:
        mark = "solved" if a["correct"] else "FAILED"
        extra = (f" weaker {a['weaker']}" if a.get("weaker") else "") + (" stronger-than-book" if a.get("altBetter") else "")
        print(f"  {_when(a['at'])}  {a['id']:<18} {mark:<6} {a['ms'] / 1000:.0f}s{extra}  {a.get('ref') or ''}".rstrip())
    print("queue (next reviews first):")
    for q in s["queue"]:
        last = "last solved" if q["lastCorrect"] else "last failed"
        print(f"  {_when(q['due'])}  {q['id']:<18} {last}  {q.get('ref') or ''}".rstrip())
    counts = ", ".join(f"{c['source']} {c['puzzles']}" + (f" ({c['disputed']} disputed)" if c["disputed"] else "")
                       for c in s["counts"])
    print(f"in base: {counts or 'nothing imported'}")


def import_games() -> None:
    ok, text = run_import()
    if not ok:
        print(f"import-games: {text}", file=sys.stderr)
        raise SystemExit(1)
    print(text)


def cmd_puzzles(args, cfg: Config) -> None:
    if args.puzzles_cmd == "import-games":
        import_games()
        return
    client = BoardClient()
    try:
        if args.puzzles_cmd == "next":
            puzzles_next(client, args, cfg)
        else:
            puzzles_stats(client, args)
    except BoardUnavailable as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
    except BoardError as e:
        print(f"puzzles error: {e}", file=sys.stderr)
        available = e.payload.get("available")
        if available:
            themes = ", ".join(f"{a['theme']} ({a['count']})" for a in available[:30])
            print(f"themes with puzzles: {themes}", file=sys.stderr)
        raise SystemExit(1)


def add_puzzles_parser(sub) -> None:
    p = sub.add_parser("puzzles", help="tactics puzzles on the live board: next one, stats")
    psub = p.add_subparsers(dest="puzzles_cmd", required=True)
    q = psub.add_parser("next", help="put the next puzzle on the board (due reviews first, then new ones)")
    q.add_argument("--theme", help="Lichess theme: fork, pin, mateIn2 ... (default: [puzzles].themes in coach.toml)")
    q.add_argument("--source", choices=["games", "polgar", "raduga", "lichess"])
    q.add_argument("--id", help="a specific puzzle, e.g. raduga:3-021, polgar:0123 or games:Mp0A6gfU-036")
    q = psub.add_parser("stats", help="solved share by theme and source, recent attempts, review queue")
    q.add_argument("--since", help="YYYY-MM-DD")
    psub.add_parser("import-games", help="turn reviewed own-game mistakes into puzzles (runs the TypeScript import)")
