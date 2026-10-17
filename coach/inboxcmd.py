"""coach inbox: what the student did on the board since the coach last looked."""
from __future__ import annotations

import sys

from .boardclient import BoardClient, BoardError, BoardUnavailable
from .config import Config

HOOK_HEADER = "Действия ученика на доске с прошлого сообщения:"
EMPTY = "Новых действий ученика нет"


def add_inbox_parser(sub) -> None:
    p = sub.add_parser("inbox", help="student moves, deletions and puzzle results since the last look")
    p.add_argument("--peek", action="store_true", help="show without marking as read")
    p.add_argument("--hook", action="store_true", help="for the Claude Code hook: silent when empty or on any error")


def render(data: dict, header: str | None) -> list[str]:
    lines = [header] if header else []
    lines += [f"- {e['text']}" for e in data["events"]]
    if data.get("more"):
        lines.append(f"... и ещё {data['more']} (coach inbox ещё раз)")
    lines.append(data["cursor"])
    return lines


def cmd_inbox(args, cfg: Config) -> None:
    if args.hook:
        try:
            client = BoardClient(timeout=2.0)
            data = client.inbox()
            if not data["events"]:
                return
            text = "\n".join(render(data, HOOK_HEADER))
            last = data["events"][-1]["id"]
            print(text)
            client.inbox_ack(last)
        except Exception:  # the hook must never break the student's message
            pass
        return
    client = BoardClient()
    try:
        data = client.inbox()
        if not data["events"]:
            print(EMPTY)
            print(data["cursor"])
            return
        print("\n".join(render(data, None)))
        if not args.peek:
            client.inbox_ack(data["events"][-1]["id"])
    except BoardUnavailable as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
    except BoardError as e:
        print(f"board error: {e}", file=sys.stderr)
        raise SystemExit(1)
