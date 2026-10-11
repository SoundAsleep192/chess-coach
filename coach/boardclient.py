"""Thin HTTP client for the live board server (web/packages/server). Standard library only."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8765"
START_HINT = "Board server is not running. Start it: docker compose up board (or preview_start with name 'board')."


class BoardUnavailable(Exception):
    """The server is not reachable (not started, wrong port)."""


class BoardError(Exception):
    """The server answered with an error: {code, message, version}."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class BoardClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or os.environ.get("COACH_BOARD_URL") or DEFAULT_URL).rstrip("/")
        self.timeout = timeout
        # Без системных прокси: запросы идут только на локальный сервер.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _request(self, method: str, path: str, body: dict | None = None, text: bool = False):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"} if data is not None else {}
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {}
            raise BoardError(e.code, payload.get("code", "http"), payload.get("message", raw or str(e.reason))) from None
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            raise BoardUnavailable(f"{START_HINT} ({e})") from None
        return raw if text else json.loads(raw)

    def state(self) -> dict:
        return self._request("GET", "/api/board")

    def pgn(self) -> str:
        return self._request("GET", "/api/board/pgn", text=True)

    def replace(self, body: dict) -> dict:
        return self._request("PUT", "/api/board", body)

    def add_line(self, at: int | str, moves: list[str], caption: str | None = None) -> dict:
        body: dict = {"at": at, "moves": moves}
        if caption is not None:
            body["caption"] = caption
        return self._request("POST", "/api/board/lines", body)

    def set_cursor(self, at: int | str, arrows: list[dict] | None = None, caption: str | None = None) -> dict:
        body: dict = {"at": at}
        if arrows is not None:
            body["arrows"] = arrows
        if caption is not None:
            body["caption"] = caption
        return self._request("PATCH", "/api/board/cursor", body)

    def set_mode(self, mode: str) -> dict:
        return self._request("PATCH", "/api/board/mode", {"mode": mode})

    def delete_node(self, node_id: str) -> dict:
        return self._request("DELETE", f"/api/board/nodes/{urllib.parse.quote(node_id)}")
