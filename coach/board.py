"""Board rendering: a self-refreshing 'live' board page and a per-game HTML report."""
from __future__ import annotations

import html
import json
import shutil
import subprocess
import sys
from pathlib import Path

import chess
import chess.svg

from .config import OUT, REVIEWS

GREEN, RED, BLUE = "#3fa34dcc", "#d64545cc", "#3b7dd8cc"

CSS = """
:root { --bg:#f6f4ef; --fg:#1d1d1f; --muted:#6b6b6b; --card:#ffffff; --line:#e3e0d8; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --fg:#ececec; --muted:#9a9a9a; --card:#202225; --line:#33363a; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:24px 16px; }
h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:0 0 6px; }
.muted { color:var(--muted); } code { font:12px ui-monospace, Menlo, monospace; word-break:break-all; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin:16px 0; }
.moment { display:grid; grid-template-columns: minmax(260px, 420px) 1fr; gap:20px; align-items:start; }
@media (max-width: 760px) { .moment { grid-template-columns: 1fr; } }
.board svg { width:100%; height:auto; display:block; }
.tag { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; font-weight:600; margin-right:6px; }
.blunder { background:#d6454522; color:#d64545; } .mistake { background:#e0892a22; color:#d47a17; }
.inaccuracy { background:#c9a22722; color:#a8861a; } .missed { background:#3b7dd822; color:#3b7dd8; }
.notes { margin-top:10px; padding-top:10px; border-top:1px solid var(--line); white-space:pre-wrap; }
table { border-collapse:collapse; } td { padding:2px 10px 2px 0; vertical-align:top; }
.live { display:flex; flex-direction:column; align-items:center; gap:10px; }
.live .board { width:min(560px, 92vw); }
"""


def open_file(path: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    elif shutil.which("xdg-open"):
        subprocess.run(["xdg-open", str(path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def parse_arrow(board: chess.Board, token: str, color: str) -> chess.svg.Arrow:
    token = token.strip()
    try:
        mv = board.parse_san(token)
        return chess.svg.Arrow(mv.from_square, mv.to_square, color=color)
    except ValueError:
        pass
    if len(token) >= 4:
        return chess.svg.Arrow(chess.parse_square(token[:2]), chess.parse_square(token[2:4]), color=color)
    raise ValueError(f"Bad arrow '{token}' (use SAN legal in this position, or squares like e2e4)")


def render_svg(board: chess.Board, orientation: bool, arrows=(), lastmove: chess.Move | None = None,
               size: int = 480) -> str:
    check = board.king(board.turn) if board.is_check() else None
    return chess.svg.board(board, orientation=orientation, arrows=list(arrows), lastmove=lastmove,
                           check=check, size=size, coordinates=True)


def write_live(board: chess.Board, orientation: bool, arrows, lastmove, caption: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    side = "White" if board.turn == chess.WHITE else "Black"
    page = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2"><title>Coach board</title><style>{CSS}</style></head>
<body><main class="live">
<div class="board">{render_svg(board, orientation, arrows, lastmove, 560)}</div>
<div>{html.escape(caption) if caption else ''}</div>
<div class="muted">{side} to move · <code>{board.fen()}</code></div>
</main></body></html>"""
    path = OUT / "board.html"
    path.write_text(page, encoding="utf-8")
    return path


def _eval_curve_svg(cps: list[int], critical: list[int]) -> str:
    from .engine import win_pct
    w, h = 900, 140
    n = max(1, len(cps) - 1)
    pts = [(i * w / n, h - win_pct(cp) / 100 * h) for i, cp in enumerate(cps)]
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"0,{h} {poly} {w},{h}"
    dots = "".join(f'<circle cx="{pts[p][0]:.1f}" cy="{pts[p][1]:.1f}" r="4" fill="#d64545"/>'
                   for p in critical if p < len(pts))
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" preserveAspectRatio="none" role="img" '
            f'aria-label="Evaluation curve, White winning chances">'
            f'<rect width="{w}" height="{h}" fill="#2b2b2b"/>'
            f'<polygon points="{area}" fill="#f2f2f2"/>'
            f'<line x1="0" y1="{h / 2}" x2="{w}" y2="{h / 2}" stroke="#888" stroke-dasharray="4 4"/>'
            f'{dots}</svg>')


def write_report(review: dict) -> Path:
    gid = review["id"]
    meta = review["meta"]
    you = meta["color"]
    orientation = chess.BLACK if you == "black" else chess.WHITE
    notes_path = REVIEWS / f"{gid}.notes.json"
    notes = {}
    if notes_path.is_file():
        raw = json.loads(notes_path.read_text(encoding="utf-8"))
        notes = {str(k): v for k, v in raw.items()} if isinstance(raw, dict) else {}

    s = review["summary"]
    parts = [f"<h1>{html.escape(meta['white'])} – {html.escape(meta['black'])} · {html.escape(meta['result'])}</h1>",
             f"<div class='muted'>{meta['date'][:10]} · {review['source']} · {meta['time_class']} {meta['time_control']} · "
             f"{html.escape(meta['eco'])} {html.escape(meta['opening'])}"
             + (f" · ты: {'белые' if you == 'white' else 'чёрные'}" if you else "") + "</div>"]
    rows = "".join(
        f"<tr><td>{'Белые' if c == 'white' else 'Чёрные'}</td><td>точность≈{s[c]['accuracy']}</td>"
        f"<td>неточн. {s[c]['inaccuracy']}</td><td>ошибок {s[c]['mistake']}</td><td>зевков {s[c]['blunder']}</td></tr>"
        for c in ("white", "black"))
    parts.append(f"<div class='card'><table>{rows}</table>"
                 f"<div style='margin-top:12px'>{_eval_curve_svg(review['eval_curve'], review['critical'])}</div>"
                 f"<div class='muted'>Белая область — шансы белых. Красные точки — ключевые моменты.</div></div>")
    if "_summary" in notes:
        parts.append(f"<div class='card'><h2>Итог</h2><div class='notes'>{html.escape(notes['_summary'])}</div></div>")

    for ply in review["critical"]:
        m = review["moves"][ply - 1]
        b = chess.Board(m["fen_before"])
        played = chess.Move.from_uci(m["uci"])
        arrows = [chess.svg.Arrow(played.from_square, played.to_square, color=RED)]
        if m["best_uci"] and m["best_uci"] != m["uci"]:
            best = chess.Move.from_uci(m["best_uci"])
            arrows.append(chess.svg.Arrow(best.from_square, best.to_square, color=GREEN))
        tags = f"<span class='tag {m['class']}'>{m['class']}</span>" if m["class"] != "ok" else ""
        if m["missed_chance"]:
            tags += "<span class='tag missed'>упущенный шанс</span>"
        deep = ""
        if m.get("deep"):
            deep = "".join(f"<div><b>{html.escape(d['eval'])}</b> {html.escape(d['pv'])}</div>" for d in m["deep"])
            ref = m.get("refutation")
            if ref and ref.get("pv"):
                deep += f"<div class='muted'>После {html.escape(m['san'])}: <b>{html.escape(ref['eval'])}</b> {html.escape(ref['pv'])}</div>"
        clock = f" · часы {m['clock']}" if m["clock"] else ""
        note = notes.get(str(ply))
        parts.append(
            f"<div class='card moment'><div class='board'>{render_svg(b, orientation, arrows, None, 420)}</div>"
            f"<div><h2>{html.escape(m['label'])} {tags}</h2>"
            f"<div class='muted'>полуход {ply} · {m['phase']}{clock} · оценка {html.escape(m['eval_before'])} → "
            f"{html.escape(m['eval_after'])} (оценки с точки зрения белых)</div>"
            f"<p>Сыграно <b style='color:#d64545'>{html.escape(m['san'])}</b>, движок: "
            f"<b style='color:#3fa34d'>{html.escape(m['best_san'] or '—')}</b></p>{deep}"
            + (f"<div class='notes'>{html.escape(note)}</div>" if note else "")
            + f"<p><code>{m['fen_before']}</code></p></div></div>")

    OUT.mkdir(parents=True, exist_ok=True)
    page = (f"<!doctype html><html lang='ru'><head><meta charset='utf-8'>"
            f"<meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>Разбор {gid}</title><style>{CSS}</style></head><body><main>{''.join(parts)}</main></body></html>")
    path = OUT / f"report-{gid}.html"
    path.write_text(page, encoding="utf-8")
    return path
