import { describe, expect, it } from 'vitest';
import {
  LESSON_TRANSCRIPT_MAX,
  PANEL_OFF,
  type BoardState,
  type LessonPositionSetup,
  type LessonReplyBody,
  type LessonStartBody,
} from '@board/shared';
import { BoardError } from '../board/board-error';
import { TreeError } from '../tree/tree-error';
import { mainLine } from '../tree/tree';
import { treeOf } from '../puzzles/puzzle-flow';
import {
  applyLessonReply,
  applyLessonVerdict,
  isLessonRunning,
  lessonMove,
  lessonNext,
  lessonRetry,
  lessonSay,
  setAssistantOnline,
  startLesson,
  stopLesson,
} from './lesson-flow';

const NOW = new Date('2026-10-18T10:00:00.000Z');
/** Ход 25, белые: Nd3 законен, чёрные отвечают Qd6. */
const FEN = 'r2q1rk1/ppp2ppp/2n5/3pN3/8/8/PPP2PPP/R2Q1RK1 w - - 0 25';
const FEN2 = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 3 31';
const BLANK = { version: 1, seq: 0, orientation: 'white', meta: { plyOffset: 0 }, updatedAt: '' } as unknown as BoardState;

const POSITION: LessonPositionSetup = {
  fen: FEN,
  orientation: 'white',
  label: 'Ферзь против коня',
  context: 'Белые на ходу.',
  task: 'Найди ход.',
  gameId: 'abc',
  game: { white: 'Nabi', black: 'Rival', moves: ['e4', 'e5'] },
};
const START: LessonStartBody = { lessonId: 'L1', title: 'Тактика', total: 3, index: 1, intro: 'Начнём.', position: POSITION };

const start = (b: LessonStartBody = START, s: BoardState = BLANK, online = true) => startLesson(s, b, NOW, online);
const reply = (inputId: number, body: Partial<LessonReplyBody> & Pick<LessonReplyBody, 'action'>): LessonReplyBody => ({ inputId, ...body });
/** Ученик сыграл Nd3, тренер ждёт. */
const moved = (s: BoardState = start()) => lessonMove(s, s.lesson!.node, 'e5d3', NOW);

describe('startLesson', () => {
  it('start: mode lesson, tree from fen, panel off, intro+context+task in transcript, phase student', () => {
    const dirty = {
      ...BLANK,
      seq: 7,
      treeEpoch: 2,
      panel: { eval: true, lines: 3 },
      puzzle: { puzzleId: 'x' },
    } as unknown as BoardState;
    const s = startLesson(dirty, START, NOW, true);
    expect(s.mode).toBe('lesson');
    expect(s.rootFen).toBe(FEN);
    expect(s.nodes[s.rootId].id).toBe('n8');
    expect(s.cursor).toBe(s.rootId);
    expect(s.orientation).toBe('white');
    expect(s.panel).toEqual(PANEL_OFF);
    expect(s.puzzle).toBeUndefined();
    expect(s.treeEpoch).toBe(3);
    expect(s.meta).toEqual({ title: 'Тактика', plyOffset: 48, gameId: 'abc' });
    expect(s.lesson).toMatchObject({
      lessonId: 'L1',
      title: 'Тактика',
      status: 'running',
      phase: 'student',
      node: s.rootId,
      index: 1,
      total: 3,
      seq: 0,
      online: true,
      label: 'Ферзь против коня',
    });
    expect(s.lesson!.transcript.map((e) => [e.who, e.kind, e.text])).toEqual([
      ['coach', 'say', 'Начнём.'],
      ['coach', 'say', 'Белые на ходу.'],
      ['coach', 'say', 'Найди ход.'],
    ]);
    expect(s.lesson!.transcript[0].at).toBe(NOW.toISOString());
    expect(isLessonRunning(s)).toBe(true);
  });

  it('start without intro and without a game: no intro entry, game and gameId absent', () => {
    const { game: _game, gameId: _gameId, ...bare } = POSITION;
    const s = start({ ...START, intro: undefined, position: bare });
    expect(s.lesson!.transcript.map((e) => e.text)).toEqual(['Белые на ходу.', 'Найди ход.']);
    expect(s.lesson!.game).toBeUndefined();
    expect(s.meta.gameId).toBeUndefined();
  });

  it('start again with the same lessonId keeps seq (resume), new id starts from 0', () => {
    const asked = moved();
    expect(asked.lesson!.seq).toBe(1);
    const resumed = startLesson(asked, START, NOW, true);
    expect(resumed.lesson!.seq).toBe(1);
    expect(resumed.lesson!.pending).toBeUndefined();
    expect(resumed.lesson!.phase).toBe('student');
    const fresh = startLesson(asked, { ...START, lessonId: 'L2' }, NOW, true);
    expect(fresh.lesson!.seq).toBe(0);
  });

  it('start sets online from the argument, not from the old lesson', () => {
    const online = start(START, BLANK, true);
    expect(startLesson(online, START, NOW, false).lesson!.online).toBe(false);
    expect(startLesson(setAssistantOnline(online, false), START, NOW, true).lesson!.online).toBe(true);
  });

  it('start copies label and game, clears pending, verdict, replay and summary of a resumed lesson', () => {
    const dirty = moved();
    const old = {
      ...dirty,
      lesson: { ...dirty.lesson!, verdict: { kind: 'correct' }, replay: { from: 'n1', to: 'n2', id: 1 }, summary: 'x' },
    } as BoardState;
    const s = startLesson(old, { ...START, position: { ...POSITION, label: 'Другая', game: undefined } }, NOW, true);
    expect(s.lesson!.label).toBe('Другая');
    for (const key of ['pending', 'verdict', 'replay', 'summary'] as const) expect(s.lesson![key]).toBeUndefined();
    expect(s.lesson!.game).toBeUndefined();
  });
});

describe('lessonMove', () => {
  it('move: only in phase student and only from lesson.node; second move while coach thinks is frozen', () => {
    const s = start();
    expect(() => lessonMove(s, 'n99', 'e5d3', NOW)).toThrow(BoardError);
    const asked = lessonMove(s, s.lesson!.node, 'e5d3', NOW);
    expect(asked.lesson!.phase).toBe('coach');
    const again = () => lessonMove(asked, asked.lesson!.node, 'a2a3', NOW);
    expect(again).toThrow(BoardError);
    expect(again).toThrow(/coach is answering/);
    try {
      again();
    } catch (e) {
      expect((e as BoardError).code).toBe('frozen');
    }
    const feedback = { ...asked, lesson: { ...asked.lesson!, phase: 'feedback' } } as BoardState;
    expect(() => lessonMove(feedback, feedback.lesson!.node, 'a2a3', NOW)).toThrow(/phase feedback/);
    const elsewhere = { ...s, cursor: s.nodes[s.rootId].children[0] ?? 'zz' } as BoardState;
    expect(() => lessonMove(elsewhere, elsewhere.lesson!.node, 'e5d3', NOW)).toThrow(BoardError);
    expect(() => lessonMove(stopLesson(s, NOW), s.lesson!.node, 'e5d3', NOW)).toThrow(BoardError);
    expect(() => lessonMove(BLANK, 'n1', 'e5d3', NOW)).toThrow(BoardError);
  });

  it('move: pending has id seq+1, san, resume student; transcript has "25.Nd3"', () => {
    const s = start();
    const m = lessonMove(s, s.lesson!.node, 'e5d3', NOW);
    const node = m.nodes[m.cursor];
    expect(node).toMatchObject({ san: 'Nd3', author: 'student', parent: s.rootId });
    expect(m.lesson!.node).toBe(s.rootId);
    expect(m.lesson!.pending).toEqual({ id: 1, kind: 'move', node: node.id, uci: 'e5d3', san: 'Nd3', resume: 'student' });
    expect(m.lesson!.seq).toBe(1);
    expect(m.lesson!.phase).toBe('coach');
    const last = m.lesson!.transcript.at(-1)!;
    expect([last.who, last.kind, last.text]).toEqual(['student', 'move', '25.Nd3']);
  });

  it('move: black move in the transcript carries the dots', () => {
    const s = start({ ...START, position: { ...POSITION, fen: FEN2 } });
    const m = lessonMove(s, s.lesson!.node, 'g8f8', NOW);
    expect(m.lesson!.transcript.at(-1)!.text).toBe('31...Kf8');
  });

  it('move: an illegal move is a TreeError and leaves the state untouched', () => {
    const s = start();
    expect(() => lessonMove(s, s.lesson!.node, 'e5e7', NOW)).toThrow(TreeError);
    expect(s.lesson!.phase).toBe('student');
  });

  it('move: clears the previous verdict', () => {
    const asked = moved();
    const kept = applyLessonReply(
      applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'wrong', score: { cp: 100 } } }, NOW),
      reply(1, { accept: true, action: { type: 'ask' } }),
      NOW,
    );
    expect(kept.lesson!.verdict).toEqual({ kind: 'wrong', score: { cp: 100 } });
    const again = lessonMove(kept, kept.lesson!.node, 'a7a6', NOW);
    expect(again.lesson!.verdict).toBeUndefined();
  });
});

describe('lessonSay, lessonNext, lessonRetry', () => {
  it('say: allowed in student, feedback, pause; resume remembers the phase; empty and 501 chars -> bad_request', () => {
    const s = start();
    for (const phase of ['student', 'feedback', 'pause'] as const) {
      const at = { ...s, lesson: { ...s.lesson!, phase } } as BoardState;
      const said = lessonSay(at, '  почему не ферзь?  ', NOW);
      expect(said.lesson!.phase).toBe('coach');
      expect(said.lesson!.pending).toEqual({ id: 1, kind: 'say', text: 'почему не ферзь?', resume: phase });
      expect(said.lesson!.seq).toBe(1);
      expect(said.lesson!.transcript.at(-1)).toMatchObject({ who: 'student', kind: 'say', text: 'почему не ферзь?' });
    }
    for (const bad of ['', '   ', 'x'.repeat(501)]) {
      expect(() => lessonSay(s, bad, NOW)).toThrow(BoardError);
      try {
        lessonSay(s, bad, NOW);
      } catch (e) {
        expect((e as BoardError).code).toBe('bad_request');
      }
    }
    expect(lessonSay(s, 'x'.repeat(500), NOW).lesson!.pending).toMatchObject({ kind: 'say' });
    const thinking = lessonSay(s, 'привет', NOW);
    expect(() => lessonSay(thinking, 'ещё', NOW)).toThrow(/coach is answering/);
    const done = { ...s, lesson: { ...s.lesson!, phase: 'done' } } as BoardState;
    expect(() => lessonSay(done, 'ещё', NOW)).toThrow(BoardError);
  });

  it('next: only in pause, pending next with the next id', () => {
    const s = start();
    expect(() => lessonNext(s, NOW)).toThrow(BoardError);
    const paused = { ...s, lesson: { ...s.lesson!, phase: 'pause', seq: 4 } } as BoardState;
    const n = lessonNext(paused, NOW);
    expect(n.lesson).toMatchObject({ phase: 'coach', seq: 5, pending: { id: 5, kind: 'next', resume: 'pause' } });
  });

  it('retry: only in feedback; cursor back to node, phase student, verdict and nothing else cleared', () => {
    const s = start();
    expect(() => lessonRetry(s)).toThrow(BoardError);
    const fb = applyLessonReply(
      applyLessonVerdict(moved(), { inputId: 1, verdict: { kind: 'wrong' } }, NOW),
      reply(1, { action: { type: 'feedback' } }),
      NOW,
    );
    const r = lessonRetry(fb);
    expect(r.cursor).toBe(fb.lesson!.node);
    expect(r.lesson).toMatchObject({ phase: 'student', verdict: undefined });
  });
});

describe('verdict and stale inputs', () => {
  it('verdict and reply with a stale inputId -> stale, state unchanged', () => {
    const asked = moved();
    const stale = (f: () => unknown) => {
      expect(f).toThrow(BoardError);
      try {
        f();
      } catch (e) {
        expect((e as BoardError).code).toBe('stale');
      }
    };
    stale(() => applyLessonVerdict(asked, { inputId: 7, verdict: { kind: 'correct' } }, NOW));
    stale(() => applyLessonReply(asked, reply(7, { action: { type: 'back' } }), NOW));
    const idle = start();
    stale(() => applyLessonVerdict(idle, { inputId: 1, verdict: { kind: 'correct' } }, NOW));
    stale(() => applyLessonReply(idle, reply(1, { action: { type: 'back' } }), NOW));
    stale(() => applyLessonReply(BLANK, reply(1, { action: { type: 'back' } }), NOW));
    expect(asked.lesson!.pending!.id).toBe(1);
    const answered = applyLessonReply(asked, reply(1, { action: { type: 'back' } }), NOW);
    stale(() => applyLessonReply(answered, reply(1, { action: { type: 'back' } }), NOW));
  });

  it('verdict: stored and written to the transcript with the badge word; info has no entry', () => {
    const asked = moved();
    const v = applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'weaker', score: { cp: 120 } } }, NOW);
    expect(v.lesson!.verdict).toEqual({ kind: 'weaker', score: { cp: 120 } });
    expect(v.lesson!.phase).toBe('coach');
    expect(v.lesson!.pending).toBeDefined();
    expect(v.lesson!.transcript.at(-1)).toMatchObject({ who: 'coach', kind: 'verdict', text: 'Неплохо, но есть сильнее' });
    const info = applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'info' } }, NOW);
    expect(info.lesson!.transcript).toHaveLength(asked.lesson!.transcript.length);
    expect(info.lesson!.verdict).toEqual({ kind: 'info' });
  });

  it('reply verdict is taken only when no verdict came before, and is not written twice', () => {
    const asked = moved();
    const first = applyLessonReply(asked, reply(1, { verdict: { kind: 'wrong' }, say: 'Так нет.', action: { type: 'feedback' } }), NOW);
    expect(first.lesson!.verdict).toEqual({ kind: 'wrong' });
    expect(first.lesson!.transcript.slice(-2).map((e) => [e.kind, e.text])).toEqual([
      ['verdict', 'Ошибка'],
      ['say', 'Так нет.'],
    ]);
    const early = applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'correct' } }, NOW);
    const both = applyLessonReply(early, reply(1, { verdict: { kind: 'wrong' }, say: 'Верно.', accept: true, action: { type: 'ask' } }), NOW);
    expect(both.lesson!.verdict).toEqual({ kind: 'correct' });
    expect(both.lesson!.transcript.filter((e) => e.kind === 'verdict')).toHaveLength(1);
  });
});

describe('applyLessonReply', () => {
  it('reply accept + play: node moves to the student move, then to the coach move', () => {
    const s = start();
    const asked = moved(s);
    const studentNode = asked.lesson!.pending!.kind === 'move' ? asked.lesson!.pending!.node : '';
    const r = applyLessonReply(asked, reply(1, { accept: true, say: 'Верно, дальше.', action: { type: 'play', uci: 'd8d6' } }), NOW);
    const line = mainLine(treeOf(r)).map((n) => n.san);
    expect(line).toEqual([null, 'Nd3', 'Qd6']);
    expect(r.lesson!.node).toBe(r.cursor);
    expect(r.nodes[r.cursor]).toMatchObject({ san: 'Qd6', author: 'coach', parent: studentNode });
    expect(r.lesson).toMatchObject({ phase: 'student', pending: undefined });
    expect(r.lesson!.transcript.at(-1)).toMatchObject({ who: 'coach', kind: 'say', text: 'Верно, дальше.' });
    expect(r.lesson!.replay).toEqual({ from: studentNode, to: r.cursor, id: 1 });
  });

  it('reply without accept + feedback: cursor on the student move, retry returns to node', () => {
    const asked = moved();
    const studentNode = asked.cursor;
    const r = applyLessonReply(
      asked,
      reply(1, { say: 'Так нельзя.', action: { type: 'feedback', arrows: [{ from: 'd3', to: 'e5', color: 'red' }] } }),
      NOW,
    );
    expect(r.cursor).toBe(studentNode);
    expect(r.lesson).toMatchObject({ phase: 'feedback', node: asked.lesson!.node, pending: undefined });
    expect(r.nodes[studentNode].arrows).toEqual([{ from: 'd3', to: 'e5', color: 'red' }]);
    const back = lessonRetry(r);
    expect(back.cursor).toBe(asked.lesson!.node);
    expect(back.lesson!.phase).toBe('student');
    expect(mainLine(treeOf(back)).map((n) => n.san)).toEqual([null, 'Nd3']);
  });

  it('reply line then feedback: coach line added from the student move, cursor at its end with arrows', () => {
    const asked = moved();
    const studentNode = asked.cursor;
    const arrows = [{ from: 'd6', to: 'd3', color: 'red' as const }];
    const r = applyLessonReply(
      asked,
      reply(1, { action: { type: 'line', from: studentNode, moves: ['d8d6', 'd1d2'], arrows, then: 'feedback' } }),
      NOW,
    );
    const end = r.nodes[r.cursor];
    expect(end).toMatchObject({ san: 'Qd2', author: 'coach' });
    expect(r.nodes[end.parent!]).toMatchObject({ san: 'Qd6', author: 'coach', parent: studentNode });
    expect(end.arrows).toEqual(arrows);
    expect(r.lesson).toMatchObject({ phase: 'feedback', node: asked.lesson!.node });
    expect(r.lesson!.replay).toEqual({ from: studentNode, to: end.id, id: 1 });
    const pause = applyLessonReply(asked, reply(1, { action: { type: 'line', from: studentNode, moves: ['d8d6'], then: 'pause' } }), NOW);
    expect(pause.lesson!.phase).toBe('pause');
    expect(pause.nodes[pause.cursor].arrows).toEqual([]);
    expect(() => applyLessonReply(asked, reply(1, { action: { type: 'line', from: studentNode, moves: [], then: 'pause' } }), NOW)).toThrow(
      /at least one move/,
    );
    expect(() => applyLessonReply(asked, reply(1, { action: { type: 'line', from: studentNode, moves: ['d8d1'], then: 'pause' } }), NOW)).toThrow(
      TreeError,
    );
  });

  it('reply none to a move -> bad_request', () => {
    for (const accept of [false, true]) {
      const asked = moved();
      const call = () => applyLessonReply(asked, reply(1, { accept, action: { type: 'none' } }), NOW);
      expect(call).toThrow(BoardError);
      try {
        call();
      } catch (e) {
        expect((e as BoardError).code).toBe('bad_request');
      }
    }
  });

  it('actions that do not fit the event are bad_request', () => {
    const asked = moved();
    const said = lessonSay(start(), 'почему?', NOW);
    const bad = (s: BoardState, accept: boolean, type: 'ask' | 'arrows' | 'back' | 'feedback') => {
      const action = type === 'arrows' ? { type, arrows: [] } : { type };
      expect(() => applyLessonReply(s, reply(s.lesson!.pending!.id, { accept, action }), NOW)).toThrow(/does not fit/);
    };
    bad(asked, false, 'ask');
    bad(asked, false, 'arrows');
    bad(asked, true, 'back');
    bad(asked, true, 'feedback');
    bad(said, false, 'feedback');
    const paused = { ...start(), lesson: { ...start().lesson!, phase: 'pause' } } as BoardState;
    const next = lessonNext(paused, NOW);
    bad(next, false, 'back');
    bad(next, false, 'ask');
  });

  it('demo move after ask (no accept) + play: coach move from node, the demo stays a side branch', () => {
    const asked = moved();
    const demo = asked.cursor;
    const r = applyLessonReply(asked, reply(1, { verdict: { kind: 'info' }, action: { type: 'play', uci: 'a2a3' } }), NOW);
    const node = r.nodes[r.cursor];
    expect(node).toMatchObject({ san: 'a3', author: 'coach', parent: asked.lesson!.node });
    expect(r.nodes[demo]).toMatchObject({ san: 'Nd3', author: 'student' });
    expect(r.nodes[asked.lesson!.node].children).toEqual([node.id, demo]);
    expect(mainLine(treeOf(r)).map((n) => n.san)).toEqual([null, 'a3']);
    expect(r.lesson).toMatchObject({ phase: 'student', node: node.id });
    expect(r.lesson!.replay).toEqual({ from: asked.lesson!.node, to: node.id, id: 1 });
  });

  it('after play the verdict is cleared; after ask it stays', () => {
    const asked = moved();
    const withVerdict = applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'correct', score: { cp: 90 } } }, NOW);
    const played = applyLessonReply(withVerdict, reply(1, { accept: true, action: { type: 'play', uci: 'd8d6' } }), NOW);
    expect(played.lesson!.verdict).toBeUndefined();
    const ask = applyLessonReply(withVerdict, reply(1, { accept: true, action: { type: 'ask' } }), NOW);
    expect(ask.lesson!.verdict).toEqual({ kind: 'correct', score: { cp: 90 } });
    expect(ask.lesson).toMatchObject({ phase: 'student', node: asked.cursor });
    expect(ask.cursor).toBe(asked.cursor);
    const back = applyLessonReply(applyLessonVerdict(asked, { inputId: 1, verdict: { kind: 'wrong' } }, NOW), reply(1, { action: { type: 'back' } }), NOW);
    expect(back.lesson!.verdict).toBeUndefined();
    expect(back).toMatchObject({ cursor: asked.lesson!.node });
    expect(back.lesson).toMatchObject({ phase: 'student', node: asked.lesson!.node });
  });

  it('say events: none and arrows go back to the remembered phase; ask and back return to the student', () => {
    const s = start();
    const fb = { ...s, lesson: { ...s.lesson!, phase: 'feedback' } } as BoardState;
    const none = applyLessonReply(lessonSay(fb, 'а если так?', NOW), reply(1, { say: 'Посмотри ещё раз.', action: { type: 'none' } }), NOW);
    expect(none.lesson).toMatchObject({ phase: 'feedback', pending: undefined });
    const arrows = [{ from: 'e5', to: 'd3', color: 'blue' as const }];
    const shown = applyLessonReply(lessonSay(fb, 'а если так?', NOW), reply(1, { action: { type: 'arrows', arrows } }), NOW);
    expect(shown.lesson!.phase).toBe('feedback');
    expect(shown.nodes[shown.cursor].arrows).toEqual(arrows);
    const ask = applyLessonReply(lessonSay(fb, 'а если так?', NOW), reply(1, { action: { type: 'ask' } }), NOW);
    expect(ask).toMatchObject({ cursor: s.lesson!.node });
    expect(ask.lesson!.phase).toBe('student');
    const paused = { ...s, lesson: { ...s.lesson!, phase: 'pause' } } as BoardState;
    const next = applyLessonReply(lessonNext(paused, NOW), reply(1, { action: { type: 'none' } }), NOW);
    expect(next.lesson!.phase).toBe('pause');
  });

  it('pause: phase pause', () => {
    const r = applyLessonReply(moved(), reply(1, { accept: true, say: 'Отдохни.', action: { type: 'pause' } }), NOW);
    expect(r.lesson).toMatchObject({ phase: 'pause', pending: undefined });
    expect(r.lesson!.node).toBe(r.cursor);
  });

  it('retry keeps the replay of the last coach line', () => {
    const asked = moved();
    const r = applyLessonReply(asked, reply(1, { action: { type: 'line', from: asked.cursor, moves: ['d8d6'], then: 'feedback' } }), NOW);
    expect(lessonRetry(r).lesson!.replay).toEqual(r.lesson!.replay);
  });

  it('position: new tree, transcript reset, index set, seq kept', () => {
    const asked = moved();
    const withLine = applyLessonReply(asked, reply(1, { accept: true, action: { type: 'play', uci: 'd8d6' } }), NOW);
    const next: LessonPositionSetup = { ...POSITION, fen: FEN2, orientation: 'black', label: 'Эндшпиль', gameId: undefined, game: undefined };
    const r = applyLessonReply(
      lessonSay(withLine, 'дальше', NOW),
      reply(2, { say: 'Хорошо.', verdict: { kind: 'correct' }, action: { type: 'position', index: 2, position: next } }),
      NOW,
    );
    expect(r.rootFen).toBe(FEN2);
    expect(r.orientation).toBe('black');
    expect(r.cursor).toBe(r.rootId);
    expect(Object.keys(r.nodes)).toEqual([r.rootId]);
    expect(Number(r.rootId.slice(1))).toBeGreaterThan(withLine.seq);
    expect(r.treeEpoch).toBe((withLine.treeEpoch ?? 0) + 1);
    expect(r.panel).toEqual(PANEL_OFF);
    expect(r.meta.title).toBe('Тактика');
    expect(r.lesson).toMatchObject({
      index: 2,
      label: 'Эндшпиль',
      phase: 'student',
      node: r.rootId,
      seq: 2,
      pending: undefined,
      verdict: undefined,
      replay: undefined,
      status: 'running',
      online: true,
    });
    expect(r.lesson!.game).toBeUndefined();
    expect(r.lesson!.transcript.map((e) => e.text)).toEqual(['Белые на ходу.', 'Найди ход.']);
  });

  it('end: status done, phase done, mode stays lesson, summary set; stop: status stopped, mode free', () => {
    const asked = moved();
    const ended = applyLessonReply(
      asked,
      reply(1, { accept: true, say: 'Всё.', action: { type: 'end', summary: 'Три из трёх.', stats: { modelCalls: 4, fallbacks: 0 } } }),
      NOW,
    );
    expect(ended.mode).toBe('lesson');
    expect(ended.lesson).toMatchObject({ status: 'done', phase: 'done', summary: 'Три из трёх.', pending: undefined });
    expect(isLessonRunning(ended)).toBe(false);
    expect(() => lessonSay(ended, 'ещё', NOW)).toThrow(BoardError);
    expect(() => stopLesson(ended, NOW)).toThrow(BoardError);

    const stopped = stopLesson(asked, NOW);
    expect(stopped.mode).toBe('free');
    expect(stopped.lesson).toMatchObject({ status: 'stopped', pending: undefined });
    expect(isLessonRunning(stopped)).toBe(false);
    expect(() => applyLessonReply(stopped, reply(1, { action: { type: 'back' } }), NOW)).toThrow(/not the one/);
  });

  it('transcript keeps the last 40 entries', () => {
    let s = start();
    for (let i = 0; i < 30; i += 1) {
      s = lessonSay(s, `вопрос ${i}`, NOW);
      s = applyLessonReply(s, reply(s.lesson!.seq, { say: `ответ ${i}`, action: { type: 'none' } }), NOW);
    }
    const t = s.lesson!.transcript;
    expect(t).toHaveLength(LESSON_TRANSCRIPT_MAX);
    expect(t.at(-1)!.text).toBe('ответ 29');
    expect(t[0].text).toBe('вопрос 10');
  });
});

describe('student input while the assistant is offline', () => {
  const offline = (s: BoardState = start()) => setAssistantOnline(s, false);
  const reject = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BoardError);
      expect((e as BoardError).code).toBe('frozen');
      expect((e as BoardError).message).toContain('assistant is not connected');
      return;
    }
    throw new Error('expected frozen');
  };

  it('move, phrase and Next are frozen when online is false, state untouched', () => {
    const s = offline();
    reject(() => lessonMove(s, s.lesson!.node, 'e5d3', NOW));
    reject(() => lessonSay(s, 'почему?', NOW));
    const paused = offline({ ...start(), lesson: { ...start().lesson!, phase: 'pause' } } as BoardState);
    reject(() => lessonNext(paused, NOW));
    expect(s.lesson).toMatchObject({ phase: 'student', online: false });
  });

  it('the same input passes again once the assistant is back', () => {
    const s = setAssistantOnline(offline(), true);
    expect(lessonMove(s, s.lesson!.node, 'e5d3', NOW).lesson!.phase).toBe('coach');
  });
});

describe('setAssistantOnline', () => {
  it('sets online on the lesson and leaves a board without a lesson alone', () => {
    const s = start();
    expect(setAssistantOnline(s, false).lesson!.online).toBe(false);
    expect(setAssistantOnline(BLANK, true)).toBe(BLANK);
  });
});
