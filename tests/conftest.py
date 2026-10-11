"""Fake board server for `coach board` / `coach show` tests."""
from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeBoard:
    def __init__(self):
        self.requests: list[tuple[str, str, object]] = []
        self.routes: dict[tuple[str, str], tuple[int, object]] = {}

    def route(self, method: str, path: str, status: int, payload) -> None:
        self.routes[(method, path)] = (status, payload)


@pytest.fixture
def fake_board(monkeypatch):
    board = FakeBoard()

    class Handler(BaseHTTPRequestHandler):
        def _handle(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            board.requests.append((self.command, self.path, body))
            status, payload = board.routes.get((self.command, self.path), (404, {"code": "not_found", "message": "no route"}))
            data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/plain" if isinstance(payload, str) else "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_PUT = do_POST = do_PATCH = do_DELETE = _handle

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("COACH_BOARD_URL", f"http://127.0.0.1:{server.server_address[1]}")
    yield board
    server.shutdown()
    server.server_close()


@pytest.fixture
def no_board(monkeypatch):
    """COACH_BOARD_URL points to a port where nothing listens."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setenv("COACH_BOARD_URL", f"http://127.0.0.1:{port}")
