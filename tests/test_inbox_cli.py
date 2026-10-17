from coach.cli import main
from coach.inboxcmd import EMPTY, HOOK_HEADER

EVENTS = {"events": [{"id": 7, "at": "2026-10-15T10:00:00Z", "kind": "line", "text": "ветка ученика от 1...e5: 2.Nf3 (узел n9)"}],
          "more": 0, "cursor": "курсор после 2.Nf3 (ветка ученика), режим free"}


def test_inbox_prints_events_and_cursor_then_acks(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox"])
    out = capsys.readouterr().out
    assert "- ветка ученика от 1...e5: 2.Nf3 (узел n9)" in out
    assert out.rstrip().endswith("курсор после 2.Nf3 (ветка ученика), режим free")
    assert fake_board.requests[-1] == ("POST", "/api/inbox/ack", {"upto": 7})


def test_inbox_peek_does_not_ack(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    main(["inbox", "--peek"])
    assert all(r[0] == "GET" for r in fake_board.requests)


def test_inbox_empty_says_so_and_more_is_reported(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, {"events": [], "more": 0, "cursor": "курсор в начальной позиции, режим free"})
    main(["inbox"])
    assert EMPTY in capsys.readouterr().out
    fake_board.route("GET", "/api/inbox", 200, {**EVENTS, "more": 3})
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox"])
    assert "... и ещё 3" in capsys.readouterr().out


def test_hook_prints_header_and_acks(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, EVENTS)
    fake_board.route("POST", "/api/inbox/ack", 200, {"ok": True})
    main(["inbox", "--hook"])
    out = capsys.readouterr().out
    assert out.startswith(HOOK_HEADER)
    assert fake_board.requests[-1] == ("POST", "/api/inbox/ack", {"upto": 7})


def test_hook_is_silent_without_events(fake_board, capsys):
    fake_board.route("GET", "/api/inbox", 200, {"events": [], "more": 0, "cursor": "x"})
    main(["inbox", "--hook"])
    assert capsys.readouterr().out == ""


def test_hook_is_silent_when_server_is_down_or_broken(fake_board, monkeypatch, capsys):
    fake_board.route("GET", "/api/inbox", 500, {"code": "storage", "message": "boom"})
    main(["inbox", "--hook"])
    monkeypatch.setenv("COACH_BOARD_URL", "http://127.0.0.1:9")
    main(["inbox", "--hook"])
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""


def test_hook_is_silent_on_garbage_answers(fake_board, capsys):
    # Review Focus 5: 200 with a non-JSON body, JSON of the wrong shape, 500 with a non-JSON body.
    for status, body in [(200, "not json"), (200, [1, 2]), (200, {"events": [{"text": "x"}], "more": 0, "cursor": "c"}),
                         (200, {"events": "oops", "more": 0, "cursor": "c"}), (500, "<html>Bad Gateway</html>")]:
        fake_board.route("GET", "/api/inbox", status, body)
        main(["inbox", "--hook"])
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
    assert all(r[0] == "GET" for r in fake_board.requests)


def test_hook_is_silent_when_server_speaks_non_http(monkeypatch, capsys):
    # http.client.BadStatusLine / RemoteDisconnected are not OSError subclasses of the old list.
    import socket
    import threading

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    seen = []

    def serve():
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                return
            seen.append(conn.recv(4096))
            conn.sendall(b"\x00\x01 this is not http\r\n\r\n")
            conn.close()

    threading.Thread(target=serve, daemon=True).start()
    monkeypatch.setenv("COACH_BOARD_URL", f"http://127.0.0.1:{srv.getsockname()[1]}")
    try:
        main(["inbox", "--hook"])  # returns normally: exit code 0, no SystemExit
    finally:
        srv.close()
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
    assert seen and all(s.startswith(b"GET /api/inbox") for s in seen)  # no ack was attempted


def test_hook_survives_broken_config(monkeypatch, capsys):
    def boom():
        raise ValueError("broken coach.toml")
    monkeypatch.setattr("coach.cli.load_config", boom)
    main(["inbox", "--hook"])
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
