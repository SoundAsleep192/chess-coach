from __future__ import annotations

import pytest

from coach import board as boardmod
from coach.boardcmd import split_moves, variation_lines, walk_line
from coach.cli import main
from tests.fakes import add_child, make_state

GAME = """[Event "Live Chess"]
[Site "Chess.com"]
[White "Somebody"]
[Black "Student"]
[Result "*"]
[GameId "g1"]

1. e4 { [%clk 0:09:59.6] } 1... e5 { [%clk 0:09:58.7] } 2. Nf3 { [%clk 0:09:57.7] } 2... Nc6 3. Bb5 a6 *
"""


@pytest.fixture
def game_file(tmp_path):
    p = tmp_path / "g1.pgn"
    p.write_text(GAME, encoding="utf-8")
    return str(p)


def test_load_sends_pgn_with_clock_comments_cursor_upto_and_side(fake_board, game_file, capsys):
    state = make_state(["e4", "e5", "Nf3"], cursor_ply=4)
    fake_board.route("PUT", "/api/board", 200, state)
    main(["board", "load", "--game", game_file, "--ply", "4", "--upto", "4", "--black"])
    method, path, body = fake_board.requests[0]
    assert (method, path) == ("PUT", "/api/board")
    assert "[%clk 0:09:59.6]" in body["pgn"]
    assert body["cursorPly"] == 4 and body["upto"] == 4
    assert body["orientation"] == "black" and body["plyOffset"] == 0 and body["gameId"] == "g1"
    assert body["title"] == "Somebody - Student"
    out = capsys.readouterr().out
    assert "loaded g1: 3 plies" in out and "cursor n4 (position 4)" in out


def test_line_prints_new_node_ids_and_marks_student_moves(fake_board, capsys):
    state = make_state(["e4", "e5"])
    nf3 = add_child(state, "n3", "Nf3", "student")
    nc6 = add_child(state, nf3, "Nc6", "coach")
    fake_board.route("POST", "/api/board/lines", 200, state)
    main(["board", "line", "--at", "3", "--moves", "2. Nf3 Nc6", "--caption", "развитие"])
    assert fake_board.requests[0][2] == {"at": 3, "moves": ["Nf3", "Nc6"], "caption": "развитие"}
    out = capsys.readouterr().out
    assert f"{nf3}  2.Nf3 (ученик)" in out
    assert f"{nc6}  2...Nc6" in out


def test_goto_sends_arrows_in_server_format(fake_board):
    state = make_state(["e4", "e5"])
    fake_board.route("GET", "/api/board", 200, state)
    fake_board.route("PATCH", "/api/board/cursor", 200, state)
    main(["board", "goto", "n3", "--best", "Nf3", "--played", "f2f4", "--arrows", "d1h5,f1c4", "--caption", "план"])
    patch = fake_board.requests[-1]
    assert patch[0:2] == ("PATCH", "/api/board/cursor")
    assert patch[2] == {"at": "n3", "caption": "план", "arrows": [
        {"from": "g1", "to": "f3", "color": "green"},
        {"from": "f2", "to": "f4", "color": "red"},
        {"from": "d1", "to": "h5", "color": "blue"},
        {"from": "f1", "to": "c4", "color": "blue"},
    ]}


def test_mode_freeze_maps_to_frozen(fake_board, capsys):
    fake_board.route("PATCH", "/api/board/mode", 200, make_state(["e4"], mode="frozen"))
    main(["board", "mode", "freeze"])
    assert fake_board.requests[0][2] == {"mode": "frozen"}
    assert "mode frozen" in capsys.readouterr().out


def test_state_prints_pgn_cursor_and_variation_ids(fake_board, capsys):
    state = make_state(["e4", "e5"])
    d5 = add_child(state, "n2", "d5", "student")
    fake_board.route("GET", "/api/board/pgn", 200, "1. e4 e5 (1... d5 {ученик}) *\n")
    fake_board.route("GET", "/api/board", 200, state)
    main(["board", "state"])
    out = capsys.readouterr().out
    assert "1. e4 e5 (1... d5 {ученик}) *" in out
    assert "cursor n3 (position 3), mode free" in out
    assert f"{d5}  1...d5  [student]  -> {d5}" in out


def test_delete_calls_the_node_url(fake_board):
    fake_board.route("DELETE", "/api/board/nodes/n9", 200, make_state(["e4"]))
    main(["board", "delete", "n9"])
    assert fake_board.requests[0][0:2] == ("DELETE", "/api/board/nodes/n9")


def test_line_past_the_end_of_a_cut_game_prints_error_and_state(fake_board, capsys):
    fake_board.route("POST", "/api/board/lines", 404,
                     {"code": "not_found", "message": "position 90 is outside the main line: available 1..86", "version": 3})
    fake_board.route("GET", "/api/board/pgn", 200, "1. e4 *\n")
    fake_board.route("GET", "/api/board", 200, make_state(["e4"]))
    with pytest.raises(SystemExit) as exc:
        main(["board", "line", "--at", "90", "--moves", "Kd6"])
    assert exc.value.code == 1
    captured = capsys.readouterr()
    assert "available 1..86" in captured.err
    assert "1. e4 *" in captured.out


def test_illegal_move_message_comes_from_the_server(fake_board, capsys):
    fake_board.route("POST", "/api/board/lines", 422,
                     {"code": "illegal", "message": "move 2 (Ke3) is illegal", "version": 3})
    with pytest.raises(SystemExit):
        main(["board", "line", "--at", "1", "--moves", "e4 Ke3"])
    assert "move 2 (Ke3) is illegal" in capsys.readouterr().err


def test_board_commands_fail_with_a_hint_when_the_server_is_down(no_board, capsys):
    with pytest.raises(SystemExit) as exc:
        main(["board", "state"])
    assert exc.value.code == 1
    assert "docker compose up board" in capsys.readouterr().err


def test_show_falls_back_to_the_file_without_a_server(no_board, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(boardmod, "OUT", tmp_path)
    main(["show", "start", "--moves", "e4", "--caption", "x"])
    assert (tmp_path / "board.html").is_file()
    assert "board server is not running" in capsys.readouterr().out


def test_show_puts_the_position_with_its_last_move_and_arrows(fake_board, capsys):
    state = make_state(["e4"])
    fake_board.route("PUT", "/api/board", 200, state)
    fake_board.route("PATCH", "/api/board/cursor", 200, state)
    main(["show", "start", "--moves", "e4", "--best", "e5", "--caption", "ответ"])
    put = fake_board.requests[0][2]
    assert put["fen"] == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    assert put["moves"] == ["e2e4"] and put["orientation"] == "black"
    assert "plyOffset" not in put
    patch = fake_board.requests[1][2]
    assert patch == {"at": "n2", "arrows": [{"from": "e7", "to": "e5", "color": "green"}], "caption": "ответ"}
    assert "live server" in capsys.readouterr().out


def test_walk_line_matches_castling_and_promotion_by_uci():
    castle = make_state(["O-O"], fen="r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert walk_line(castle, "n1", ["O-O"])[0]["uci"] == "e1g1"
    assert walk_line(castle, "n1", ["e1g1"])[0]["id"] == "n2"
    promo = make_state(["e8=Q"], fen="8/4P3/8/8/8/8/k7/4K3 w - - 0 1")
    assert walk_line(promo, "n1", ["e8=Q+"])[0]["uci"] == "e7e8q"


def test_split_moves_and_variation_rows():
    assert split_moves("43... Kd6 44. Ne2, Ne5 *") == ["Kd6", "Ne2", "Ne5"]
    state = make_state(["e4", "e5", "Nf3"])
    c5 = add_child(state, "n2", "c5", "coach")
    add_child(state, c5, "Nf3", "coach")
    rows = variation_lines(state)
    assert rows == [f"{c5}  1...c5 2.Nf3  [coach]  -> n{state['seq']}"]


def test_split_moves_strips_annotations():
    assert split_moves("1. e4!? e5 2. Nf3! Nc6?!") == ["e4", "e5", "Nf3", "Nc6"]
