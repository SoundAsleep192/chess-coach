"""Aggregate statistics over the game index and stored reviews."""
from __future__ import annotations

import json
from collections import defaultdict

from .config import REVIEWS


def _wdl(rs: list[dict]) -> tuple[int, int, int, float | None]:
    w = sum(r["player_result"] == "win" for r in rs)
    d = sum(r["player_result"] == "draw" for r in rs)
    l = sum(r["player_result"] == "loss" for r in rs)
    n = w + d + l
    return w, d, l, (round(100 * (w + 0.5 * d) / n, 1) if n else None)


def _fmt(label: str, rs: list[dict]) -> str:
    w, d, l, s = _wdl(rs)
    return f"  {label:<38} {len(rs):>4} games  +{w} ={d} -{l}  score {s}%"


def stats_text(idx: list[dict], since: str | None = None, tclass: str | None = None) -> str:
    games = [r for r in idx if r["player_result"]]
    if since:
        games = [r for r in games if r["date"] >= since]
    if tclass:
        games = [r for r in games if r["time_class"] == tclass]
    if not games:
        return "No games with a detected player yet. Run: coach fetch\n\n" + reviews_text()
    out = []
    span = f"{games[-1]['date'][:10]} .. {games[0]['date'][:10]}"
    out.append(f"GAMES ({span})")
    out.append(_fmt("all", games))
    for src in ("lichess", "chesscom"):
        rs = [r for r in games if r["source"] == src]
        if rs:
            out.append(_fmt(src, rs))

    out.append("\nBY TIME CLASS (rating first -> last, peak)")
    by_tc = defaultdict(list)
    for r in games:
        by_tc[(r["source"], r["time_class"])].append(r)
    for (src, tc), rs in sorted(by_tc.items(), key=lambda kv: -len(kv[1])):
        chrono = sorted((r for r in rs if r["my_elo"]), key=lambda r: r["date"])
        rating = ""
        if chrono:
            rating = f"  rating {chrono[0]['my_elo']} -> {chrono[-1]['my_elo']} (peak {max(r['my_elo'] for r in chrono)})"
        out.append(_fmt(f"{src} {tc}", rs) + rating)

    out.append("\nBY COLOR")
    for c in ("white", "black"):
        out.append(_fmt(c, [r for r in games if r["color"] == c]))

    for c in ("white", "black"):
        out.append(f"\nOPENINGS AS {c.upper()} (families, >=3 games; '!' = score < 40%)")
        fam = defaultdict(list)
        for r in games:
            if r["color"] == c:
                fam[r["family"]].append(r)
        rows = sorted(((k, v) for k, v in fam.items() if len(v) >= 3), key=lambda kv: -len(kv[1]))[:10]
        for k, v in rows:
            s = _wdl(v)[3]
            out.append(_fmt(k[:38], v) + ("  !" if s is not None and s < 40 else ""))

    out.append("\n" + reviews_text())

    unreviewed = [r for r in games if r["player_result"] == "loss" and not (REVIEWS / f"{r['id']}.json").is_file()][:5]
    if unreviewed:
        out.append("\nRECENT UNREVIEWED LOSSES")
        for r in unreviewed:
            out.append(f"  {r['date'][:10]} {r['source']:<8} {r['id']:<12} {r['time_class']:<9} "
                       f"vs {r['opponent']} ({r['opp_elo']})  {r['opening']}")
    return "\n".join(out)


def reviews_text() -> str:
    files = sorted(p for p in REVIEWS.glob("*.json") if not p.name.endswith(".notes.json"))
    revs = []
    for p in files:
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if r.get("meta", {}).get("color"):
            revs.append(r)
    if not revs:
        return "REVIEWS: none yet (run: coach review <game>)"
    n = len(revs)
    mine = [r["summary"][r["meta"]["color"]] for r in revs]
    acc = [m["accuracy"] for m in mine if m["accuracy"] is not None]
    lines = [f"REVIEWS ({n} games reviewed)"]
    lines.append(f"  avg accuracy≈{round(sum(acc) / len(acc), 1) if acc else None}")
    for k in ("inaccuracy", "mistake", "blunder", "missed_chances", "in_time_trouble"):
        tot = sum(m[k] for m in mine)
        lines.append(f"  {k:<16} {tot:>4} total  {tot / n:.2f} per game")
    phase = defaultdict(lambda: defaultdict(int))
    for m in mine:
        for ph, d in m["by_phase"].items():
            for cls, c in d.items():
                phase[ph][cls] += c
    lines.append("  errors by phase: " + ", ".join(
        f"{ph}: " + "/".join(f"{phase[ph].get(c, 0)}" for c in ("inaccuracy", "mistake", "blunder"))
        for ph in ("opening", "middlegame", "endgame")) + "  (inacc/mist/blund)")
    by_res = defaultdict(list)
    for r in revs:
        by_res[r["meta"]["player_result"]].append(r["id"])
    lines.append("  reviewed: " + ", ".join(f"{k} {len(v)}" for k, v in by_res.items()))
    return "\n".join(lines)
