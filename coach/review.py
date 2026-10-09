"""Full-game review: evaluate every position, classify moves, deep-analyse critical moments."""
from __future__ import annotations

import json
import sys

import chess
import chess.engine
import chess.pgn

from .config import REVIEWS, Config
from .engine import analyse, fmt_score, make_limit, move_accuracy, open_engine, win_pct
from .games import index_record, time_class

PIECE_VALUES = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
CLASS_ORDER = {"ok": 0, "inaccuracy": 1, "mistake": 2, "blunder": 3}


def phase(board: chess.Board) -> str:
    npm = sum(len(board.pieces(pt, c)) * v for pt, v in PIECE_VALUES.items() for c in chess.COLORS)
    if npm <= 26:
        return "endgame"
    if board.fullmove_number <= 12 and npm >= 56:
        return "opening"
    return "middlegame"


def classify(drop: float, cfg: Config) -> str:
    if drop >= cfg.blunder:
        return "blunder"
    if drop >= cfg.mistake:
        return "mistake"
    if drop >= cfg.inaccuracy:
        return "inaccuracy"
    return "ok"


def _clock_str(sec: float | None) -> str | None:
    if sec is None:
        return None
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _tc(headers) -> tuple[int | None, int]:
    tc = headers.get("TimeControl", "")
    if not tc or "/" in tc or tc in ("-", "?"):
        return None, 0
    base, _, inc = tc.partition("+")
    try:
        return int(base), int(inc or 0)
    except ValueError:
        return None, 0


def review_game(cfg: Config, game: chess.pgn.Game, gid: str, source: str,
                time_per_move: float | None = None, deep_time: float | None = None,
                quiet: bool = False) -> dict:
    tpm = time_per_move or cfg.time_per_move
    dtime = deep_time if deep_time is not None else cfg.deep_time
    quiet = quiet or not sys.stderr.isatty()  # no \r progress bars in Claude Code's captured output
    h = game.headers
    meta = index_record(h, source, gid, cfg)
    player = meta["color"]  # 'white' | 'black' | None
    base, inc = _tc(h)

    board = game.board()
    positions = [board.copy()]
    nodes = list(game.mainline())
    for node in nodes:
        board.push(node.move)
        positions.append(board.copy())

    print(f"reviewing {gid}: {len(positions)} positions x {tpm}s, then deep pass on critical moments...",
          file=sys.stderr)
    evals = []
    with open_engine(cfg) as eng:
        engine_name = eng.id.get("name", "engine")
        limit = make_limit(time=tpm)
        for i, pos in enumerate(positions):
            evals.append(analyse(eng, pos, limit, multipv=1, pv_plies=8)[0])
            if not quiet:
                print(f"\r  analysing {i + 1}/{len(positions)}", end="", file=sys.stderr, flush=True)
        if not quiet:
            print(file=sys.stderr)

        moves = []
        last_clock = {chess.WHITE: float(base) if base else None, chess.BLACK: float(base) if base else None}
        for i, node in enumerate(nodes):
            before = positions[i]
            mover = before.turn
            e0, e1 = evals[i], evals[i + 1]
            wp0, wp1 = win_pct(e0.cp), win_pct(e1.cp)
            drop = (wp0 - wp1) if mover == chess.WHITE else (wp1 - wp0)
            best_move = e0.moves[0] if e0.moves else None
            if best_move == node.move:
                drop = 0.0
            drop = max(0.0, drop)
            clock = node.clock()
            spent = None
            if clock is not None and last_clock[mover] is not None:
                spent = max(0.0, last_clock[mover] - clock + inc)
            if clock is not None:
                last_clock[mover] = clock
            color = "white" if mover == chess.WHITE else "black"
            moves.append({
                "ply": i + 1,
                "move_no": before.fullmove_number,
                "color": color,
                "san": before.san(node.move),
                "uci": node.move.uci(),
                "label": f"{before.fullmove_number}{'.' if mover == chess.WHITE else '...'} {before.san(node.move)}",
                "fen_before": before.fen(),
                "eval_before": fmt_score(e0.score),
                "eval_after": fmt_score(e1.score),
                "cp_before": e0.cp,
                "cp_after": e1.cp,
                "best_san": before.san(best_move) if best_move else None,
                "best_uci": best_move.uci() if best_move else None,
                "best_line": e0.san,
                "drop": round(drop, 1),
                "accuracy": round(move_accuracy(drop), 1),
                "class": classify(drop, cfg),
                "phase": phase(before),
                "clock": _clock_str(clock),
                "clock_sec": clock,
                "spent_sec": round(spent, 1) if spent is not None else None,
                "time_trouble": bool(clock is not None and base and clock < max(30.0, 0.1 * base)),
                "missed_chance": False,
            })

        # Missed chance: opponent blundered, and the reply failed to cash in.
        for i in range(1, len(moves)):
            prev, cur = moves[i - 1], moves[i]
            if prev["class"] == "blunder" and CLASS_ORDER[cur["class"]] >= CLASS_ORDER["mistake"]:
                cur["missed_chance"] = True

        # Critical moments: the player's mistakes/blunders and missed chances, plus the biggest drops.
        def is_player(m):
            return player is None or m["color"] == player

        critical = {m["ply"] for m in moves if is_player(m) and
                    (CLASS_ORDER[m["class"]] >= CLASS_ORDER["mistake"] or m["missed_chance"])}
        top = sorted((m for m in moves if is_player(m) and m["drop"] >= cfg.inaccuracy),
                     key=lambda m: m["drop"], reverse=True)[:3]
        critical |= {m["ply"] for m in top}
        critical_list = sorted(critical)

        if dtime and critical_list:
            dlimit = make_limit(time=dtime)
            for n, ply in enumerate(critical_list, 1):
                if not quiet:
                    print(f"\r  deep pass {n}/{len(critical_list)}", end="", file=sys.stderr, flush=True)
                m = moves[ply - 1]
                pos = positions[ply - 1]
                lines = analyse(eng, pos, dlimit, multipv=3, pv_plies=12)
                m["deep"] = [ln.as_dict(pos) for ln in lines]
                after = positions[ply]
                reply = analyse(eng, after, dlimit, multipv=1, pv_plies=12)[0]
                m["refutation"] = reply.as_dict(after)
                # The deep pass is more reliable: let it override the fast-pass verdict.
                top_line = lines[0]
                wp0, wp1 = win_pct(top_line.cp), win_pct(reply.cp)
                drop = (wp0 - wp1) if pos.turn == chess.WHITE else (wp1 - wp0)
                if top_line.moves and top_line.moves[0].uci() == m["uci"]:
                    drop = 0.0
                drop = max(0.0, drop)
                m.update({
                    "eval_before": fmt_score(top_line.score), "eval_after": fmt_score(reply.score),
                    "cp_before": top_line.cp, "cp_after": reply.cp,
                    "best_san": pos.san(top_line.moves[0]) if top_line.moves else m["best_san"],
                    "best_uci": top_line.moves[0].uci() if top_line.moves else m["best_uci"],
                    "best_line": top_line.san or m["best_line"],
                    "drop": round(drop, 1), "accuracy": round(move_accuracy(drop), 1),
                    "class": classify(drop, cfg), "deep_checked": True,
                })
            if not quiet:
                print(file=sys.stderr)

    summary = {}
    for color in ("white", "black"):
        ms = [m for m in moves if m["color"] == color]
        by_phase = {}
        for m in ms:
            if m["class"] != "ok":
                by_phase.setdefault(m["phase"], {}).setdefault(m["class"], 0)
                by_phase[m["phase"]][m["class"]] += 1
        summary[color] = {
            "accuracy": round(sum(m["accuracy"] for m in ms) / len(ms), 1) if ms else None,
            "inaccuracy": sum(m["class"] == "inaccuracy" for m in ms),
            "mistake": sum(m["class"] == "mistake" for m in ms),
            "blunder": sum(m["class"] == "blunder" for m in ms),
            "missed_chances": sum(m["missed_chance"] for m in ms),
            "in_time_trouble": sum(m["time_trouble"] and m["class"] in ("mistake", "blunder") for m in ms),
            "by_phase": by_phase,
        }

    review = {
        "id": gid,
        "source": source,
        "meta": meta,
        "time_class": time_class(h.get("TimeControl", "")),
        "settings": {"engine": engine_name, "time_per_move": tpm, "deep_time": dtime,
                     "thresholds_win_pct": [cfg.inaccuracy, cfg.mistake, cfg.blunder]},
        "summary": summary,
        "critical": critical_list,
        "eval_curve": [e.cp for e in evals],
        "moves": moves,
    }
    REVIEWS.mkdir(parents=True, exist_ok=True)
    (REVIEWS / f"{gid}.json").write_text(json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8")
    return review


def format_review(r: dict) -> str:
    meta = r["meta"]
    you = meta["color"]
    lines = []
    lines.append(f"Game {r['id']} ({r['source']}) {meta['date'][:10]} · {meta['time_class']} {meta['time_control']} · "
                 f"{meta['eco']} {meta['opening']}")
    lines.append(f"White {meta['white']} vs Black {meta['black']} · {meta['result']}"
                 + (f" · you: {you}, {meta['player_result']}" if you else " · player not detected (check usernames)"))
    s = r["summary"]

    def side(c):
        x = s[c]
        return (f"{c}: accuracy≈{x['accuracy']} | {x['inaccuracy']} inacc, {x['mistake']} mist, "
                f"{x['blunder']} blund | missed chances {x['missed_chances']} | "
                f"errors in time trouble {x['in_time_trouble']} | by phase {json.dumps(x['by_phase'])}")

    lines.append(side("white"))
    lines.append(side("black"))
    lines.append("Evals are White POV. Critical moments" + (" (your moves):" if you else ":"))
    for ply in r["critical"]:
        m = r["moves"][ply - 1]
        flag = " MISSED-CHANCE" if m["missed_chance"] else ""
        clock = f", clock {m['clock']}" if m["clock"] else ""
        spent = f", spent {m['spent_sec']}s" if m["spent_sec"] is not None else ""
        lines.append(f"  ply {ply}: {m['label']} {m['class'].upper()}{flag}  {m['eval_before']} -> {m['eval_after']} "
                     f"(win% drop {m['drop']})  best: {m['best_san']}  [{m['phase']}{clock}{spent}]")
        if "deep" in m:
            for d in m["deep"]:
                lines.append(f"      deep #{d['rank']} {d['eval']}: {d['pv']}")
            ref = m.get("refutation")
            if ref and ref.get("pv"):
                lines.append(f"      after {m['san']}: {ref['eval']}  {ref['pv']}")
        lines.append(f"      FEN {m['fen_before']}")
    return "\n".join(lines)
