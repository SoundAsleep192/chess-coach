"""Server-shaped board states for tests (same fields as web/packages/shared BoardState)."""
from __future__ import annotations

import chess


def make_state(moves: list[str], fen: str = chess.STARTING_FEN, cursor_ply: int | None = None,
               mode: str = "free", version: int = 7, plyOffset: int = 0) -> dict:
    """State in the server's shape: ids n1 (root), n2, ... along a single main line."""
    nodes = {"n1": {"id": "n1", "parent": None, "children": [], "san": None, "uci": None, "fen": fen,
                    "ply": plyOffset, "author": "game", "arrows": []}}
    b = chess.Board(fen)
    prev = "n1"
    for i, tok in enumerate(moves, start=2):
        mv = b.parse_san(tok)
        san = b.san(mv)
        b.push(mv)
        nid = f"n{i}"
        nodes[nid] = {"id": nid, "parent": prev, "children": [], "san": san, "uci": mv.uci(), "fen": b.fen(),
                      "ply": nodes[prev]["ply"] + 1, "author": "game", "arrows": []}
        nodes[prev]["children"].append(nid)
        prev = nid
    cursor = prev if cursor_ply is None else next(n["id"] for n in nodes.values() if n["ply"] == cursor_ply - 1)
    return {"rootFen": fen, "rootId": "n1", "nodes": nodes, "cursor": cursor, "seq": len(nodes), "version": version,
            "mode": mode, "orientation": "white", "meta": {"plyOffset": plyOffset}, "updatedAt": "2026-10-10T00:00:00Z"}


def add_child(state: dict, parent: str, san: str, author: str) -> str:
    nodes = state["nodes"]
    b = chess.Board(nodes[parent]["fen"])
    mv = b.parse_san(san)
    san = b.san(mv)
    b.push(mv)
    state["seq"] += 1
    nid = f"n{state['seq']}"
    nodes[nid] = {"id": nid, "parent": parent, "children": [], "san": san, "uci": mv.uci(), "fen": b.fen(),
                  "ply": nodes[parent]["ply"] + 1, "author": author, "arrows": []}
    nodes[parent]["children"].append(nid)
    return nid
