"""Game import from Lichess / Chess.com / over-the-board PGN, local storage, index and lookup."""
from __future__ import annotations

import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import chess.pgn

from .config import GAMES, REVIEWS, Config

UA = "chess-coach/0.1 (personal training tool; python-chess)"
SOURCES = ("lichess", "chesscom", "otb")
INDEX = GAMES / "index.json"
SYNC = GAMES / "sync.json"


# ---------------------------------------------------------------- http

def http_get(url: str, accept: str | None = None) -> bytes:
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                print("  rate limited, waiting 60s...", file=sys.stderr)
                time.sleep(61)
                continue
            raise
    raise RuntimeError("unreachable")


# ---------------------------------------------------------------- helpers

def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def game_id_from_headers(h: chess.pgn.Headers) -> str | None:
    if h.get("GameId"):
        return h["GameId"]
    for key in ("Site", "Link"):
        url = h.get(key, "")
        m = re.search(r"lichess\.org/([A-Za-z0-9]{8})", url)
        if m:
            return m.group(1)
        m = re.search(r"chess\.com/(?:game/)?(?:live|daily)/(?:game/)?(\d+)", url)
        if m:
            return m.group(1)
    return None


def time_class(tc: str) -> str:
    """Lichess-style time class from a PGN TimeControl tag."""
    if not tc or tc in ("-", "?"):
        return "unknown"
    if "/" in tc:
        return "daily"
    base, _, inc = tc.partition("+")
    try:
        est = int(base) + 40 * int(inc or 0)
    except ValueError:
        return "unknown"
    if est < 29:
        return "ultrabullet"
    if est < 179:
        return "bullet"
    if est < 479:
        return "blitz"
    if est < 1499:
        return "rapid"
    return "classical"


_FAMILY_END = {"Defense", "Defence", "Opening", "Game", "Attack", "Gambit", "System", "Countergambit"}


def opening_name(h: chess.pgn.Headers) -> tuple[str, str]:
    """(full name, family). Lichess has an Opening tag; Chess.com has ECOUrl."""
    name = h.get("Opening", "")
    if not name and h.get("ECOUrl"):
        slug = h["ECOUrl"].rstrip("/").rsplit("/", 1)[-1]
        words = []
        for w in slug.split("-"):
            if re.match(r"^\d+\.", w) or re.match(r"^\d+$", w):
                break
            words.append(w)
        name = " ".join(words)
    if not name or name == "?":
        return ("Unknown", "Unknown")
    if ":" in name:
        return (name, name.split(":", 1)[0].strip())
    words = name.split()
    fam = []
    for w in words:
        fam.append(w)
        if w in _FAMILY_END:
            break
    return (name, " ".join(fam))


def _iso_date(h: chess.pgn.Headers) -> str:
    d = h.get("UTCDate") or h.get("Date") or "????.??.??"
    t = h.get("UTCTime") or h.get("StartTime") or "00:00:00"
    return f"{d.replace('.', '-')}T{t}"


def index_record(h: chess.pgn.Headers, source: str, gid: str, cfg: Config) -> dict:
    white, black = h.get("White", "?"), h.get("Black", "?")
    names = cfg.usernames
    color = "white" if white.lower() in names else "black" if black.lower() in names else None
    result = h.get("Result", "*")
    if color is None or result == "*":
        pres = None
    elif result == "1/2-1/2":
        pres = "draw"
    else:
        pres = "win" if (result == "1-0") == (color == "white") else "loss"
    full, family = opening_name(h)

    def elo(key):
        try:
            return int(h.get(key, ""))
        except ValueError:
            return None

    my_elo = elo("WhiteElo") if color == "white" else elo("BlackElo") if color == "black" else None
    opp_elo = elo("BlackElo") if color == "white" else elo("WhiteElo") if color == "black" else None
    return {
        "id": gid,
        "source": source,
        "date": _iso_date(h),
        "white": white,
        "black": black,
        "result": result,
        "color": color,
        "player_result": pres,
        "my_elo": my_elo,
        "opponent": black if color == "white" else white if color == "black" else None,
        "opp_elo": opp_elo,
        "time_control": h.get("TimeControl", ""),
        "time_class": h.get("TimeClass") or time_class(h.get("TimeControl", "")),
        "rated": "rated" in h.get("Event", "").lower() or source == "chesscom",
        "eco": h.get("ECO", ""),
        "opening": full,
        "family": family,
        "termination": h.get("Termination", ""),
    }


def _save_game(game: chess.pgn.Game, source: str, text: str | None = None) -> str | None:
    gid = game_id_from_headers(game.headers)
    if not gid:
        return None
    d = GAMES / source
    d.mkdir(parents=True, exist_ok=True)
    if text is None:
        text = str(game)
    (d / f"{gid}.pgn").write_text(text.strip() + "\n", encoding="utf-8")
    return gid


# ---------------------------------------------------------------- fetch

def fetch_lichess(cfg: Config, since: datetime | None, max_games: int | None) -> int:
    user = cfg.lichess
    params = {"clocks": "true", "opening": "true", "evals": "false", "moves": "true", "tags": "true"}
    if since:
        params["since"] = str(int(since.timestamp() * 1000))
    if max_games:
        params["max"] = str(max_games)
    url = f"https://lichess.org/api/games/user/{urllib.parse.quote(user)}?{urllib.parse.urlencode(params)}"
    print(f"lichess: downloading games of {user}...", file=sys.stderr)
    raw = http_get(url, accept="application/x-chess-pgn").decode("utf-8")
    stream = io.StringIO(raw)
    n = 0
    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        if game.headers.get("Variant", "Standard") not in ("Standard", "From Position"):
            continue
        if _save_game(game, "lichess"):
            n += 1
    return n


def fetch_lichess_game(gid: str) -> str:
    url = f"https://lichess.org/game/export/{gid}?clocks=true&opening=true&evals=false"
    raw = http_get(url, accept="application/x-chess-pgn").decode("utf-8")
    game = chess.pgn.read_game(io.StringIO(raw))
    if game is None:
        raise SystemExit(f"Lichess returned no game for id {gid}")
    game.headers.setdefault("GameId", gid)
    _save_game(game, "lichess")
    return gid


def fetch_chesscom(cfg: Config, since: datetime | None, max_games: int | None) -> int:
    user = cfg.chesscom.lower()
    print(f"chess.com: downloading games of {user}...", file=sys.stderr)
    archives = json.loads(http_get(f"https://api.chess.com/pub/player/{user}/games/archives"))["archives"]
    if since:
        cutoff = (since.year, since.month)
        archives = [a for a in archives if tuple(map(int, a.rstrip("/").split("/")[-2:])) >= cutoff]
    n = 0
    for url in reversed(archives):  # newest first, so --max keeps the most recent
        data = json.loads(http_get(url))
        for g in reversed(data.get("games", [])):
            if g.get("rules") != "chess" or "pgn" not in g:
                continue
            if since and g.get("end_time", 0) < since.timestamp():
                continue
            game = chess.pgn.read_game(io.StringIO(g["pgn"]))
            if game is None:
                continue
            gid = g.get("url", "").rstrip("/").rsplit("/", 1)[-1]
            if gid:
                game.headers["GameId"] = gid
            if _save_game(game, "chesscom"):
                n += 1
            if max_games and n >= max_games:
                return n
        time.sleep(0.3)  # be polite: chess.com asks for serial requests
    return n



# ---------------------------------------------------------------- over-the-board import

_CHAPTER_PLAYERS = re.compile(r"^(?:(?:Тур|Партия|Round|Game)\s*\d+\.?\s*)?(.+?)\s+-\s+(.+)$")


def _chapter_players(chapter: str) -> tuple[str, str] | None:
    """'Тур 2. Исаханов (1047) - Зубков (1350)' -> ('Исаханов', 'Зубков')."""
    chapter = chapter.strip()
    # 'Партия 1 (Колесников - Исаханов)': players wrapped in parentheses after the prefix
    wrapped = re.match(r"^((?:Тур|Партия|Round|Game)\s*\d+\.?\s*)\((.+ - .+)\)$", chapter)
    if wrapped:
        chapter = wrapped.group(1) + wrapped.group(2)
    m = _CHAPTER_PLAYERS.match(chapter)
    if not m:
        return None
    clean = lambda s: re.sub(r"\s*\(.*?\)\s*", " ", s).strip()
    return clean(m.group(1)), clean(m.group(2))


def import_otb(cfg: Config, ref: str, tc: str, color: str | None = None,
               results: list[str] | None = None) -> int:
    """Import over-the-board games from a Lichess study URL/id or a PGN file into data/games/otb.

    tc: TimeControl tag like '600+5', or a time class ('rapid', 'classical') when the exact control is unknown.
    color: player's colour for chapters whose players can't be identified from headers or chapter name.
    results: results in chapter order, used where the source has no result ('*').
    """
    if results and any(r not in ("1-0", "0-1", "1/2-1/2", "*") for r in results):
        raise SystemExit(f"Bad --results {results}: use 1-0, 0-1, 1/2-1/2 or *")
    if not cfg.otb_name:
        raise SystemExit("Set [player].otb_name in coach.toml (your name as written in tournament PGNs)")
    p = Path(ref).expanduser()
    if p.is_file():
        raw, study = p.read_text(encoding="utf-8"), p.stem
    else:
        m = re.search(r"(?:lichess\.org/study/)?([A-Za-z0-9]{8})(?:/|$)", ref)
        if not m:
            raise SystemExit(f"Not a Lichess study or PGN file: {ref}")
        study = m.group(1)
        raw = http_get(f"https://lichess.org/api/study/{study}.pgn?comments=false&variations=false&clocks=true",
                       accept="application/x-chess-pgn").decode("utf-8")
    surname = cfg.otb_name.split()[0].lower()
    stream = io.StringIO(raw)
    n = chapter_no = 0
    while (src := chess.pgn.read_game(stream)) is not None:
        chapter_no += 1
        h = src.headers
        chapter = h.get("ChapterName", "") or h.get("Event", "")
        if not any(True for _ in src.mainline_moves()):
            print(f"  skip (no moves): {chapter}", file=sys.stderr)
            continue
        white, black = h.get("White", "?"), h.get("Black", "?")
        if white in ("?", "") or black in ("?", ""):
            white, black = _chapter_players(chapter) or ("?", "?")
        me = "white" if surname in white.lower() else "black" if surname in black.lower() else color
        if me is None:
            print(f"  skip (can't tell your colour, pass --color): {chapter}", file=sys.stderr)
            continue
        if me == "white":
            white = cfg.otb_name
        else:
            black = cfg.otb_name
        if white == "?" or black == "?":
            white, black = (cfg.otb_name, "Opponent") if me == "white" else ("Opponent", cfg.otb_name)
        game = chess.pgn.Game()
        for key in ("Date", "ECO", "Opening"):
            if h.get(key):
                game.headers[key] = h[key]
        game.headers["Event"] = h.get("StudyName") or h.get("Event", "OTB")
        game.headers["Round"] = chapter
        game.headers["White"], game.headers["Black"] = white, black
        game.headers["Result"] = h.get("Result", "*")
        if game.headers["Result"] == "*" and results and chapter_no <= len(results):
            game.headers["Result"] = results[chapter_no - 1]
        for key in ("WhiteElo", "BlackElo"):
            if h.get(key):
                game.headers[key] = h[key]
        if re.fullmatch(r"\d+(\+\d+)?", tc):
            game.headers["TimeControl"] = tc
        else:
            game.headers["TimeControl"] = "-"
            game.headers["TimeClass"] = tc
        url = h.get("ChapterURL", "")
        chap_id = url.rstrip("/").rsplit("/", 1)[-1] if url else f"{study}-{n + 1}"
        game.headers["Site"] = url or "OTB"
        game.headers["GameId"] = f"otb-{chap_id}"
        node = game
        for src_node in src.mainline():
            node = node.add_variation(src_node.move)
            if src_node.clock() is not None:
                node.set_clock(src_node.clock())
        if _save_game(game, "otb"):
            n += 1
            print(f"  {game.headers['GameId']}: {white} - {black} {game.headers['Result']}", file=sys.stderr)
    rebuild_index(cfg)
    return n


def fetch(cfg: Config, sources: list[str], since: str | None, days: int | None, max_games: int | None) -> None:
    sync = _read_json(SYNC, {})
    now = datetime.now(timezone.utc)
    for src in sources:
        user = cfg.lichess if src == "lichess" else cfg.chesscom
        if not user:
            print(f"{src}: no username in coach.toml, skipping", file=sys.stderr)
            continue
        if since:
            start = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
        elif days:
            start = now - timedelta(days=days)
        elif src in sync:
            start = datetime.fromisoformat(sync[src]) - timedelta(hours=1)  # incremental, small overlap
        else:
            start = now - timedelta(days=180)
        try:
            n = (fetch_lichess if src == "lichess" else fetch_chesscom)(cfg, start, max_games)
        except urllib.error.HTTPError as e:
            print(f"{src}: HTTP {e.code} {e.reason}", file=sys.stderr)
            continue
        except urllib.error.URLError as e:
            print(f"{src}: network error: {e.reason}", file=sys.stderr)
            continue
        sync[src] = now.isoformat()
        print(f"{src}: saved {n} games (since {start.date()})", file=sys.stderr)
    _write_json(SYNC, sync)
    idx = rebuild_index(cfg)
    print(f"index: {len(idx)} games total", file=sys.stderr)


# ---------------------------------------------------------------- index & lookup

def rebuild_index(cfg: Config) -> list[dict]:
    records = []
    for src in SOURCES:
        d = GAMES / src
        if not d.is_dir():
            continue
        for p in d.glob("*.pgn"):
            with p.open(encoding="utf-8") as f:
                h = chess.pgn.read_headers(f)
            if h is None:
                continue
            records.append(index_record(h, src, p.stem, cfg))
    records.sort(key=lambda r: r["date"], reverse=True)
    _write_json(INDEX, records)
    return records


def load_index(cfg: Config) -> list[dict]:
    idx = _read_json(INDEX, None)
    if idx is None:
        idx = rebuild_index(cfg)
    return idx


def is_reviewed(gid: str) -> bool:
    return (REVIEWS / f"{gid}.json").is_file()


def filter_games(idx: list[dict], source=None, result=None, tclass=None, color=None, opening=None,
                 unreviewed=False, since=None) -> list[dict]:
    out = []
    for r in idx:
        if source and r["source"] != source:
            continue
        if result and r["player_result"] != result:
            continue
        if tclass and r["time_class"] != tclass:
            continue
        if color and r["color"] != color:
            continue
        if opening and opening.lower() not in r["opening"].lower():
            continue
        if unreviewed and is_reviewed(r["id"]):
            continue
        if since and r["date"] < since:
            continue
        out.append(r)
    return out


def player_color(game: chess.pgn.Game, cfg: Config) -> bool | None:
    """The student's colour in the game (chess.WHITE / chess.BLACK) by username, or None if unknown."""
    if game.headers.get("Black", "").lower() in cfg.usernames:
        return chess.BLACK
    if game.headers.get("White", "").lower() in cfg.usernames:
        return chess.WHITE
    return None


def resolve_game(ref: str, cfg: Config) -> tuple[chess.pgn.Game, str, str]:
    """ref: path to .pgn, game id, Lichess/Chess.com URL, 'latest' or 'last-loss'. Returns (game, id, source)."""
    p = Path(ref).expanduser()
    if p.suffix == ".pgn" and p.is_file():
        with p.open(encoding="utf-8") as f:
            game = chess.pgn.read_game(f)
        if game is None:
            raise SystemExit(f"No game in {p}")
        gid = game_id_from_headers(game.headers) or p.stem
        return game, gid, "file"

    if ref in ("latest", "last-loss"):
        idx = load_index(cfg)
        if ref == "last-loss":
            idx = [r for r in idx if r["player_result"] == "loss"]
        if not idx:
            raise SystemExit("No games in the local index. Run: coach fetch")
        ref = idx[0]["id"]

    m = re.search(r"lichess\.org/([A-Za-z0-9]{8})", ref)
    if m:
        ref = m.group(1)
    m = re.search(r"chess\.com/.*?(\d{6,})", ref)
    if m:
        ref = m.group(1)

    for src in SOURCES:
        f = GAMES / src / f"{ref}.pgn"
        if f.is_file():
            with f.open(encoding="utf-8") as fh:
                return chess.pgn.read_game(fh), ref, src

    if re.fullmatch(r"[A-Za-z0-9]{8}", ref) and not ref.isdigit():
        print(f"Game {ref} not stored locally, fetching from Lichess...", file=sys.stderr)
        fetch_lichess_game(ref)
        rebuild_index(cfg)
        with (GAMES / "lichess" / f"{ref}.pgn").open(encoding="utf-8") as fh:
            return chess.pgn.read_game(fh), ref, "lichess"

    raise SystemExit(f"Game '{ref}' not found locally. For chess.com games run: coach fetch --source chesscom")
