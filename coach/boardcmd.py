"""`coach board ...` commands and `coach show` on the live board server."""
from __future__ import annotations

import re
import sys

import chess
import chess.pgn
import chess.svg

from . import board as boardmod
from .boardclient import BoardClient, BoardError, BoardUnavailable
from .config import Config
from .engine import split_moves  # noqa: F401  (re-exported)
from .games import player_color, resolve_game

COLOR_NAMES = {boardmod.GREEN: "green", boardmod.RED: "red", boardmod.BLUE: "blue"}
COLOR_HEX = {name: color for color, name in COLOR_NAMES.items()}


def parse_at(token: str) -> int | str:
    """'86' -> 86 (position before ply 86 on the main line), 'n17' -> node id."""
    token = token.strip()
    if token.isdigit():
        return int(token)
    if re.fullmatch(r"n\d+", token):
        return token
    raise SystemExit(f"Bad position '{token}': use a ply number (86) or a node id (n17)")


def main_line(state: dict) -> list[dict]:
    nodes = state["nodes"]
    line = [nodes[state["rootId"]]]
    while line[-1]["children"]:
        line.append(nodes[line[-1]["children"][0]])
    return line


def node_at(state: dict, at: int | str) -> dict:
    if isinstance(at, int):
        for node in main_line(state):
            if node["ply"] == at - 1:
                return node
        line = main_line(state)
        raise BoardError(404, "not_found", f"position {at} is outside the main line: available "
                                           f"{line[0]['ply'] + 1}..{line[-1]['ply'] + 1}")
    if at not in state["nodes"]:
        raise BoardError(404, "not_found", f"node {at} not found")
    return state["nodes"][at]


def move_label(state: dict, node: dict) -> str:
    parent = state["nodes"][node["parent"]]
    _, turn, _, _, _, full = parent["fen"].split(" ")
    return f"{full}.{node['san']}" if turn == "w" else f"{full}...{node['san']}"


def arrow_dict(arrow: chess.svg.Arrow) -> dict:
    return {"from": chess.square_name(arrow.tail), "to": chess.square_name(arrow.head),
            "color": COLOR_NAMES.get(arrow.color, "blue")}


def svg_arrow(arrow: dict) -> chess.svg.Arrow:
    """Inverse of arrow_dict: for the out/board.html fallback."""
    return chess.svg.Arrow(chess.parse_square(arrow["from"]), chess.parse_square(arrow["to"]),
                           color=COLOR_HEX[arrow["color"]])


def arrows_for(fen: str, best: str | None, played: str | None, arrows: str | None) -> list[dict]:
    b = chess.Board(fen)
    out = []
    try:
        if best:
            out.append(boardmod.parse_arrow(b, best, boardmod.GREEN))
        if played:
            out.append(boardmod.parse_arrow(b, played, boardmod.RED))
        for tok in (arrows or "").split(","):
            if tok.strip():
                out.append(boardmod.parse_arrow(b, tok, boardmod.BLUE))
    except ValueError as e:
        raise SystemExit(str(e))
    return [arrow_dict(a) for a in out]


def walk_line(state: dict, start_id: str, moves: list[str]) -> list[dict]:
    """Nodes of a line just added from start_id, matched by UCI (castling e1g1, promotion e7e8q)."""
    nodes = state["nodes"]
    cur = nodes[start_id]
    out = []
    for tok in moves:
        b = chess.Board(cur["fen"])
        try:
            uci = b.parse_san(tok).uci()
        except ValueError:
            uci = chess.Move.from_uci(tok).uci()
        cur = next(nodes[c] for c in cur["children"] if nodes[c]["uci"] == uci)
        out.append(cur)
    return out


def position_line(state: dict) -> str:
    cur = state["nodes"][state["cursor"]]
    return f"cursor {cur['id']} (position {cur['ply'] + 1}), mode {state['mode']}, version {state['version']}"


def variation_lines(state: dict) -> list[str]:
    """One row per variation start and per student run: first node id, moves, author, last node id."""
    nodes = state["nodes"]
    rows = []
    stack = [state["rootId"]]
    while stack:
        node = nodes[stack.pop()]
        stack.extend(reversed(node["children"]))
        if node["parent"] is None:
            continue
        parent = nodes[node["parent"]]
        is_variation = parent["children"][0] != node["id"]
        student_start = node["author"] == "student" and parent["author"] != "student"
        if not (is_variation or student_start):
            continue
        line = [node]
        while line[-1]["children"]:
            line.append(nodes[line[-1]["children"][0]])
        authors = sorted({n["author"] for n in line})
        moves = " ".join(move_label(state, n) for n in line)
        rows.append(f"{node['id']}  {moves}  [{', '.join(authors)}]  -> {line[-1]['id']}")
    return rows


def print_state(client: BoardClient) -> None:
    print(client.pgn().rstrip())
    state = client.state()
    print(position_line(state))
    rows = variation_lines(state)
    print("variations:" if rows else "variations: none")
    for row in rows:
        print(f"  {row}")


def _orientation(game: chess.pgn.Game, cfg: Config, args) -> str:
    if args.white:
        return "white"
    if args.black:
        return "black"
    return "black" if player_color(game, cfg) == chess.BLACK else "white"


def board_load(client: BoardClient, args, cfg: Config) -> None:
    game, gid, _ = resolve_game(args.game, cfg)
    pgn = game.accept(chess.pgn.StringExporter(headers=True, variations=True, comments=True))
    orientation = _orientation(game, cfg, args)
    body = {"pgn": pgn, "orientation": orientation, "gameId": gid, "plyOffset": 0,
            "title": f"{game.headers.get('White', '?')} - {game.headers.get('Black', '?')}"}
    if args.ply is not None:
        body["cursorPly"] = args.ply
    if args.upto is not None:
        body["upto"] = args.upto
    state = client.replace(body)
    plies = len(main_line(state)) - 1
    print(f"loaded {gid}: {plies} plies, {orientation} at the bottom, {position_line(state)}")


def board_line(client: BoardClient, args) -> None:
    at = parse_at(args.at)
    moves = split_moves(args.moves)
    if not moves:
        raise SystemExit("--moves is empty")
    state = client.add_line(at, moves, args.caption)
    start = node_at(state, at)
    for node in walk_line(state, start["id"], moves):
        mark = " (ученик)" if node["author"] == "student" else ""
        print(f"{node['id']}  {move_label(state, node)}{mark}")
    print(position_line(state))


def board_goto(client: BoardClient, args) -> None:
    at = parse_at(args.at)
    arrows = None
    if args.best or args.played or args.arrows:
        arrows = arrows_for(node_at(client.state(), at)["fen"], args.best, args.played, args.arrows)
    state = client.set_cursor(at, arrows=arrows, caption=args.caption)
    print(position_line(state))
    print(f"FEN {state['nodes'][state['cursor']]['fen']}")


def board_mode(client: BoardClient, args) -> None:
    state = client.set_mode("frozen" if args.mode == "freeze" else "free")
    print(position_line(state))


def board_delete(client: BoardClient, args) -> None:
    state = client.delete_node(args.node_id)
    print(f"deleted {args.node_id}; {position_line(state)}")


def cmd_board(args, cfg: Config) -> None:
    client = BoardClient()
    try:
        if args.board_cmd == "load":
            board_load(client, args, cfg)
        elif args.board_cmd == "line":
            board_line(client, args)
        elif args.board_cmd == "goto":
            board_goto(client, args)
        elif args.board_cmd == "mode":
            board_mode(client, args)
        elif args.board_cmd == "state":
            print_state(client)
        elif args.board_cmd == "delete":
            board_delete(client, args)
    except BoardUnavailable as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
    except BoardError as e:
        print(f"board error: {e}", file=sys.stderr)
        if e.status == 404:
            try:
                print_state(client)
            except (BoardError, BoardUnavailable):
                pass
        raise SystemExit(1)


def show_on_server(client: BoardClient, b: chess.Board, orientation: bool, arrows: list[dict],
                   caption: str | None, ply_offset: int | None) -> dict:
    """Replace the server tree with one position; the last move (if any) stays as one step to see it."""
    base = b.copy()
    moves = []
    if base.move_stack:
        moves = [base.pop().uci()]
    body: dict = {"fen": base.fen(), "moves": moves, "orientation": "white" if orientation == chess.WHITE else "black"}
    if ply_offset is not None:
        body["plyOffset"] = ply_offset
    state = client.replace(body)
    if arrows or caption:
        state = client.set_cursor(state["cursor"], arrows=arrows, caption=caption or None)
    return state


def add_board_parser(sub) -> None:
    p = sub.add_parser("board", help="live board server: load a game, add lines, move the cursor, freeze")
    bsub = p.add_subparsers(dest="board_cmd", required=True)

    q = bsub.add_parser("load", help="load a game as the main line")
    q.add_argument("--game", required=True, help="game ref: id, URL, path.pgn, 'latest', 'last-loss'")
    q.add_argument("--ply", type=int, help="cursor on the position BEFORE ply N (review numbering)")
    q.add_argument("--upto", type=int, help="cut the game: the position before ply N is the last one")
    side = q.add_mutually_exclusive_group()
    side.add_argument("--white", action="store_true", help="White at the bottom")
    side.add_argument("--black", action="store_true", help="Black at the bottom")

    q = bsub.add_parser("line", help="add a coach/engine line from position N or node id")
    q.add_argument("--at", required=True, help="ply number (position before it) or node id like n17")
    q.add_argument("--moves", required=True, help="SAN/UCI moves, move numbers allowed")
    q.add_argument("--caption", help="caption at the last position of the line")

    q = bsub.add_parser("goto", help="move the cursor, set arrows and caption there")
    q.add_argument("at", help="ply number (position before it) or node id like n17")
    q.add_argument("--best", help="green arrow (SAN or e2e4)")
    q.add_argument("--played", help="red arrow (SAN or e2e4)")
    q.add_argument("--arrows", help="blue arrows, comma-separated")
    q.add_argument("--caption", help="text under the board")

    q = bsub.add_parser("mode", help="freeze the board or let the student browse and move")
    q.add_argument("mode", choices=["freeze", "free"])

    bsub.add_parser("state", help="PGN with student branches, cursor, mode, variation ids")

    q = bsub.add_parser("delete", help="delete a branch by node id")
    q.add_argument("node_id")
