import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PANEL_OFF, type AnalysisData, type BoardState, type LessonReplyBody, type LessonStartBody, type ServerMessage } from '@board/shared';
import { MATE1 } from './puzzle-fixtures';
import { engine, seed, setupBoardApp } from './helpers';
import { WsProbe } from './ws-probe';

/** Ход 25, белые: Nd3 законен, чёрные отвечают Qd6. */
const FEN = 'r2q1rk1/ppp2ppp/2n5/3pN3/8/8/PPP2PPP/R2Q1RK1 w - - 0 25';
const START: LessonStartBody = {
  lessonId: 'L1',
  title: 'Тактика',
  total: 3,
  index: 1,
  intro: 'Начнём.',
  position: { fen: FEN, orientation: 'white', label: 'Ферзь против коня', context: 'Белые на ходу.', task: 'Найди ход.' },
};
const LINES = [
  { move: 'd8d6', cp: -30, pv: ['d8d6'], depth: 18 },
  { move: 'c6e5', cp: -45, pv: ['c6e5'], depth: 18 },
  { move: 'a7a6', cp: -60, pv: ['a7a6'], depth: 18 },
];

const reply = (inputId: number, body: Partial<LessonReplyBody> = {}): LessonReplyBody => ({ inputId, action: { type: 'ask' }, ...body });
const analyses = (msgs: ServerMessage[]): AnalysisData[] => msgs.flatMap((m) => (m.event === 'analysis' ? [m.data] : []));

/** Ждать ошибку с кодом; следом за ошибкой сервер шлёт состояние - оно тоже снимается. */
async function expectError(ws: WsProbe, code: string): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const m = await ws.next(Math.max(1, deadline - Date.now()));
    if (m.event === 'error') {
      expect(m.data.code).toBe(code);
      await ws.next();
      return;
    }
  }
}

/** Все сообщения, пришедшие за ms. */
async function collect(ws: WsProbe, ms: number): Promise<ServerMessage[]> {
  const out: ServerMessage[] = [];
  const end = Date.now() + ms;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0) return out;
    try {
      out.push(await ws.next(left));
    } catch {
      return out;
    }
  }
}

describe('lesson', () => {
  const board = setupBoardApp();
  const http = () => request(board.running.http);
  const post = (path: string, body?: object) => http().post(`/api/lesson/${path}`).send(body ?? {});
  const current = async () => (await http().get('/api/board').expect(200)).body as BoardState;
  const inbox = async () => (await http().get('/api/inbox').expect(200)).body as { events: { kind: string; text: string }[] };
  /** Сокет помощника: онлайн становится true после его подключения. */
  const assistant = async () => {
    const ws = await WsProbe.open(`${board.running.wsUrl}?role=assistant`);
    await ws.next();
    return ws;
  };
  const browser = async () => {
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    return ws;
  };
  const waitFor = async (pred: (s: BoardState) => boolean): Promise<BoardState> => {
    for (let i = 0; i < 100; i++) {
      const s = await current();
      if (pred(s)) return s;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('the board did not reach the expected state');
  };
  /** Занятие, помощник подключён, ученик сыграл Nd3 (событие 1 ждёт тренера). */
  async function moved() {
    const a = await assistant();
    const started = (await post('start', START).expect(200)).body as BoardState;
    const ws = await browser();
    ws.send('move', { parentId: started.lesson!.node, uci: 'e5d3' });
    const s = await ws.until((x) => x.lesson?.phase === 'coach');
    return { a, ws, s };
  }

  it('start -> state with lesson, mode lesson, panel off', async () => {
    const res = await post('start', START).expect(200);
    const s = res.body as BoardState;
    expect(s.mode).toBe('lesson');
    expect(s.panel).toEqual(PANEL_OFF);
    expect(s.rootFen).toBe(FEN);
    expect(s.lesson).toMatchObject({ lessonId: 'L1', status: 'running', phase: 'student', index: 1, total: 3, online: false, seq: 0 });
    expect(s.lesson!.transcript.map((e) => e.text)).toEqual(['Начнём.', 'Белые на ходу.', 'Найди ход.']);
    expect(await current()).toMatchObject({ version: s.version, mode: 'lesson' });
  });

  it('a bad start body is 400', async () => {
    await post('start', { ...START, total: 0 }).expect(400);
    await post('verdict', { inputId: 1 }).expect(400);
    await post('reply', { inputId: 1, action: { type: 'dance' } }).expect(400);
  });

  it('student move over ws -> phase coach with pending; verdict -> badge; reply play -> coach move, phase student', async () => {
    const { a, ws, s } = await moved();
    expect(s.lesson!.pending).toMatchObject({ id: 1, kind: 'move', uci: 'e5d3', san: 'Nd3', resume: 'student' });
    expect(s.nodes[s.cursor].author).toBe('student');
    const judged = (await post('verdict', { inputId: 1, verdict: { kind: 'correct', score: { cp: 30 } } }).expect(200)).body as BoardState;
    expect(judged.lesson!.verdict).toEqual({ kind: 'correct', score: { cp: 30 } });
    expect(judged.lesson!.transcript.at(-1)).toMatchObject({ who: 'coach', kind: 'verdict', text: 'Верно' });
    const done = (await post('reply', reply(1, { say: 'Верно.', accept: true, action: { type: 'play', uci: 'd8d6' } })).expect(200)).body as BoardState;
    expect(done.lesson).toMatchObject({ phase: 'student', online: true });
    expect(done.lesson!.pending).toBeUndefined();
    expect(done.lesson!.verdict).toBeUndefined();
    expect(done.nodes[done.lesson!.node]).toMatchObject({ san: 'Qd6', author: 'coach' });
    expect(done.nodes[done.nodes[done.lesson!.node].parent!]).toMatchObject({ san: 'Nd3' });
    expect(done.lesson!.replay).toMatchObject({ id: 1, to: done.lesson!.node });
    expect((await ws.until((x) => x.version === done.version)).lesson!.phase).toBe('student');
    ws.close();
    a.close();
  });

  it('lessonSay over ws in phase student -> pending say; in phase coach -> error frozen', async () => {
    const a = await assistant();
    await post('start', START).expect(200);
    const ws = await browser();
    ws.send('lessonSay', { text: '  почему? ' });
    const s = await ws.until((x) => x.lesson?.phase === 'coach');
    expect(s.lesson!.pending).toMatchObject({ id: 1, kind: 'say', text: 'почему?', resume: 'student' });
    ws.send('lessonSay', { text: 'ещё' });
    await expectError(ws, 'frozen');
    expect((await current()).lesson!.pending).toMatchObject({ id: 1, text: 'почему?' });
    ws.send('lessonSay', { text: 3 });
    await expectError(ws, 'bad_request');
    ws.close();
    a.close();
  });

  it('lessonRetry and lessonNext over ws follow the phases', async () => {
    const { a, ws } = await moved();
    ws.send('lessonRetry', {});
    await expectError(ws, 'frozen');
    await post('reply', reply(1, { action: { type: 'feedback' }, verdict: { kind: 'wrong' } })).expect(200);
    const fb = await ws.until((x) => x.lesson?.phase === 'feedback');
    ws.send('lessonRetry', {});
    const back = await ws.until((x) => x.lesson?.phase === 'student');
    expect(back.cursor).toBe(fb.lesson!.node);
    ws.send('move', { parentId: back.lesson!.node, uci: 'e5d3' });
    await ws.until((x) => x.lesson?.phase === 'coach');
    await post('reply', reply(2, { accept: true, action: { type: 'pause' } })).expect(200);
    await ws.until((x) => x.lesson?.phase === 'pause');
    ws.send('lessonNext', {});
    const next = await ws.until((x) => x.lesson?.phase === 'coach');
    expect(next.lesson!.pending).toMatchObject({ id: 3, kind: 'next' });
    ws.close();
    a.close();
  });

  it('a student move before the lesson answered, off the lesson node, and free navigation are rejected', async () => {
    const { a, ws, s } = await moved();
    ws.send('move', { parentId: s.cursor, uci: 'd8d6' });
    await expectError(ws, 'frozen');
    ws.send('move', { parentId: s.rootId, uci: 'e5f3' });
    await expectError(ws, 'frozen');
    ws.send('navigate', { nodeId: s.rootId });
    await expectError(ws, 'frozen');
    ws.send('deleteBranch', { nodeId: s.cursor });
    await expectError(ws, 'frozen');
    expect(await current()).toMatchObject({ version: s.version, cursor: s.cursor });
    ws.close();
    a.close();
  });

  it('reply with an old inputId -> 409 stale', async () => {
    const { a, ws } = await moved();
    await post('reply', reply(1, { say: 'Так.', action: { type: 'back' } })).expect(200);
    const res = await post('reply', reply(1, { say: 'Ещё раз.', action: { type: 'back' } })).expect(409);
    expect(res.body.code).toBe('stale');
    await post('verdict', { inputId: 1, verdict: { kind: 'correct' } }).expect(409);
    await post('reply', reply(99)).expect(409);
    ws.close();
    a.close();
  });

  it('PUT /api/board, puzzles next, PATCH mode and cursor during a running lesson -> 403 forbidden with "coach lesson stop"; lesson untouched', async () => {
    await seed(MATE1);
    const { a, ws, s } = await moved();
    const before = await current();
    const refuse = async (res: request.Test) => {
      const r = await res.expect(403);
      expect(r.body.code).toBe('forbidden');
      expect(r.body.message).toContain('coach lesson stop');
    };
    await refuse(http().put('/api/board').send({ pgn: '1. e4 e5 *' }));
    await refuse(http().post('/api/puzzles/next').send({ id: MATE1._id }));
    await refuse(http().patch('/api/board/mode').send({ mode: 'free' }));
    await refuse(http().patch('/api/board/cursor').send({ at: s.rootId }));
    await refuse(http().delete(`/api/board/nodes/${s.cursor}`));
    await refuse(http().delete(`/api/board/nodes/${s.rootId}`));
    expect(await current()).toEqual(before);
    expect(engine.calls).toHaveLength(0);
    ws.close();
    a.close();
  });

  it('coach lines and panel settings are still allowed in a running lesson', async () => {
    const { a, ws, s } = await moved();
    await http().post('/api/board/lines').send({ at: s.rootId, moves: ['Nc4'] }).expect(200);
    await http().patch('/api/board/panel').send({ note: 'заметка' }).expect(200);
    ws.close();
    a.close();
  });

  it('after stop or end the board can be replaced again', async () => {
    await post('start', START).expect(200);
    const stopped = (await post('stop').expect(200)).body as BoardState;
    expect(stopped).toMatchObject({ mode: 'free', lesson: { status: 'stopped' } });
    const replaced = (await http().put('/api/board').send({ pgn: '1. e4 e5 *' }).expect(200)).body as BoardState;
    expect(replaced.mode).toBe('free');
    expect(replaced.lesson).toBeUndefined();

    const { a, ws } = await moved();
    const ended = (
      await post('reply', reply(1, { say: 'Всё.', action: { type: 'end', summary: 'Итог.', stats: { modelCalls: 2, fallbacks: 0 } } })).expect(200)
    ).body as BoardState;
    expect(ended).toMatchObject({ mode: 'lesson', lesson: { status: 'done', phase: 'done', summary: 'Итог.' } });
    // конец держит режим занятия, но не защищает доску
    await http().patch('/api/board/cursor').send({ at: ended.rootId }).expect(200);
    const again = (await http().put('/api/board').send({ pgn: '1. e4 e5 *' }).expect(200)).body as BoardState;
    expect(again).toMatchObject({ mode: 'free' });
    expect(again.lesson).toBeUndefined();
    ws.close();
    a.close();
  });

  it('after the end a puzzle and the mode switch also take the board', async () => {
    const { a, ws } = await moved();
    await post('reply', reply(1, { action: { type: 'end', summary: 'Итог.', stats: { modelCalls: 0, fallbacks: 0 } } })).expect(200);
    const frozen = (await http().patch('/api/board/mode').send({ mode: 'frozen' }).expect(200)).body as BoardState;
    expect(frozen).toMatchObject({ mode: 'frozen' });
    expect(frozen.lesson).toBeUndefined();
    ws.close();
    a.close();
  });

  it('stop with no running lesson returns the state unchanged, no inbox event, no error', async () => {
    const none = await current();
    const res = (await post('stop').expect(200)).body as BoardState;
    expect(res).toEqual(none);

    await post('start', START).expect(200);
    await post('stop').expect(200);
    const stopped = await current();
    const again = (await post('stop').expect(200)).body as BoardState;
    expect(again).toEqual(stopped);
    const kinds = (await inbox()).events.map((e) => e.text);
    expect(kinds).toEqual(['Занятие «Тактика» остановлено на позиции 2/3. Продолжить: uv run coach lesson start L1 --resume']);
  });

  it('assistant socket ?role=assistant sets online true, closing it sets online false; browser socket does not', async () => {
    await post('start', START).expect(200);
    const b = await browser();
    expect((await current()).lesson!.online).toBe(false);
    const a = await assistant();
    expect((await waitFor((s) => s.lesson!.online)).lesson!.online).toBe(true);
    const second = await assistant();
    a.close();
    await new Promise((r) => setTimeout(r, 150));
    expect((await current()).lesson!.online).toBe(true);
    second.close();
    expect((await waitFor((s) => !s.lesson!.online)).lesson!.online).toBe(false);
    b.close();
  });

  it('student move, phrase and Next over ws are frozen while no assistant is connected; accepted once it connects', async () => {
    const s = (await post('start', START).expect(200)).body as BoardState;
    const ws = await browser();
    ws.send('move', { parentId: s.lesson!.node, uci: 'e5d3' });
    await expectError(ws, 'frozen');
    ws.send('lessonSay', { text: 'почему?' });
    await expectError(ws, 'frozen');
    ws.send('lessonNext', {});
    await expectError(ws, 'frozen');
    expect(await current()).toMatchObject({ version: s.version, lesson: { phase: 'student', online: false } });
    const a = await assistant();
    await waitFor((x) => x.lesson!.online);
    ws.send('move', { parentId: s.lesson!.node, uci: 'e5d3' });
    expect((await ws.until((x) => x.lesson?.phase === 'coach')).lesson!.pending).toMatchObject({ kind: 'move' });
    ws.close();
    a.close();
  });

  it('the assistant closing while the coach is answering leaves an offline lesson that takes no new input', async () => {
    const { a, ws } = await moved();
    a.close();
    const off = await waitFor((x) => !x.lesson!.online);
    expect(off.lesson).toMatchObject({ phase: 'coach', pending: { id: 1 } });
    ws.send('lessonSay', { text: 'эй' });
    await expectError(ws, 'frozen');
    ws.close();
  });

  it('start after the assistant connected -> online true at once', async () => {
    const a = await assistant();
    const s = (await post('start', START).expect(200)).body as BoardState;
    expect(s.lesson!.online).toBe(true);
    a.close();
  });

  it('no analysis in student and coach even with a verdict; multipv 3 after the reply (feedback, pause, done) and when offline', async () => {
    engine.fallback = LINES;
    const a = await assistant();
    const started = (await post('start', START).expect(200)).body as BoardState;
    const ws = await browser();
    ws.send('move', { parentId: started.lesson!.node, uci: 'e5d3' });
    await ws.until((x) => x.lesson?.phase === 'coach');
    await post('verdict', { inputId: 1, verdict: { kind: 'wrong', score: { cp: -110 } } }).expect(200);
    expect(analyses(await collect(ws, 700))).toEqual([]);
    expect(engine.calls).toHaveLength(0);
    // новый сокет в фазе coach тоже ничего не получает
    const late = await WsProbe.open(board.running.wsUrl);
    await late.next();
    expect(analyses(await collect(late, 400))).toEqual([]);
    late.close();

    await post('reply', reply(1, { say: 'Смотри.', action: { type: 'feedback' } })).expect(200);
    const ready = await waitForAnalysis(ws, 'ready');
    expect(ready).toMatchObject({ status: 'ready', depth: 18 });
    expect(ready.lines).toHaveLength(3);
    expect(engine.calls.at(-1)!.opts.multipv).toBe(3);

    // следующий вопрос ученика закрывает анализ: фаза coach
    ws.send('lessonSay', { text: 'почему?' });
    await ws.until((x) => x.lesson?.phase === 'coach');
    engine.calls.length = 0;
    expect(analyses(await collect(ws, 700))).toEqual([]);
    expect(engine.calls).toHaveLength(0);
    await post('reply', reply(2, { say: 'Потому.', action: { type: 'none' } })).expect(200);
    expect((await waitForAnalysis(ws, 'ready')).status).toBe('ready');

    // пауза и конец серии открывают анализ так же
    ws.send('lessonSay', { text: 'ещё' });
    await ws.until((x) => x.lesson?.phase === 'coach');
    await post('reply', reply(3, { action: { type: 'end', summary: 'Итог.', stats: { modelCalls: 1, fallbacks: 0 } } })).expect(200);
    const end = await waitForAnalysis(ws, 'ready');
    expect(end.lines).toHaveLength(3);
    ws.close();
    a.close();
  });

  it('the pause phase opens the analysis too', async () => {
    engine.fallback = LINES;
    const { a, ws } = await moved();
    await post('reply', reply(1, { accept: true, action: { type: 'pause' } })).expect(200);
    await ws.until((x) => x.lesson?.phase === 'pause');
    expect((await waitForAnalysis(ws, 'ready')).lines).toHaveLength(3);
    ws.close();
    a.close();
  });

  it('offline: multipv 3 analysis even in phase student, closed when the assistant connects', async () => {
    engine.fallback = LINES;
    await post('start', START).expect(200);
    const ws = await browser();
    const ready = await waitForAnalysis(ws, 'ready');
    expect(ready.lines).toHaveLength(3);
    expect(engine.calls.at(-1)!.opts.multipv).toBe(3);
    // новый сокет получает готовый анализ сразу
    const late = await WsProbe.open(board.running.wsUrl);
    await late.next();
    expect(analyses(await collect(late, 300)).at(-1)).toMatchObject({ status: 'ready' });
    late.close();
    const a = await assistant();
    await waitFor((s) => s.lesson!.online);
    const fresh = await WsProbe.open(board.running.wsUrl);
    await fresh.next();
    expect(analyses(await collect(fresh, 400))).toEqual([]);
    fresh.close();
    ws.close();
    a.close();
  });

  it('server restart with a saved lesson -> online false', async () => {
    const a = await assistant();
    await post('start', START).expect(200);
    expect((await current()).lesson!.online).toBe(true);
    // помощник остаётся подключённым, пока сервер останавливается: в базе лежит online true
    await board.restart();
    const s = await current();
    expect(s.lesson).toMatchObject({ lessonId: 'L1', status: 'running', online: false });
    expect(s.mode).toBe('lesson');
    a.close();
  });

  describe('inbox', () => {
    it('reply to a move and to a phrase, end and stop give lesson events with the texts', async () => {
      const { a, ws } = await moved();
      await post('verdict', { inputId: 1, verdict: { kind: 'wrong', score: { cp: -110 } } }).expect(200);
      await post('reply', reply(1, { say: 'Конь висит.', action: { type: 'back' } })).expect(200);
      ws.send('lessonSay', { text: 'почему?' });
      await ws.until((x) => x.lesson?.phase === 'coach');
      await post('reply', reply(2, { say: 'Потому что.' })).expect(200);
      ws.send('lessonSay', { text: 'всё понял' });
      await ws.until((x) => x.lesson?.pending?.id === 3);
      await post('reply', reply(3, { action: { type: 'end', summary: 'Итог.', stats: { modelCalls: 4, fallbacks: 1 } } })).expect(200);
      const events = (await inbox()).events;
      expect(events.map((e) => e.kind)).toEqual(['lesson', 'lesson', 'lesson', 'lesson']);
      expect(events.map((e) => e.text)).toEqual([
        'Занятие «Тактика», позиция 2/3: 25.Nd3 - ошибка (-1.1). Тренер: «Конь висит.»',
        'Занятие «Тактика», позиция 2/3: ученик: «почему?». Тренер: «Потому что.»',
        'Занятие «Тактика», позиция 2/3: ученик: «всё понял»',
        'Занятие «Тактика» закончено: 3 из 3 позиций, вызовов модели 4, заготовленных реплик 1. Журнал: uv run coach lesson journal L1',
      ]);
      ws.close();
      a.close();
    });

    it('a stop is recorded after a student move that was never answered', async () => {
      const { a, ws } = await moved();
      await post('stop').expect(200);
      expect((await inbox()).events.map((e) => e.text)).toEqual([
        'Занятие «Тактика» остановлено на позиции 2/3. Продолжить: uv run coach lesson start L1 --resume',
      ]);
      ws.close();
      a.close();
    });

    it('note is appended in brackets', async () => {
      const a = await assistant();
      await post('start', START).expect(200);
      const ws = await browser();
      ws.send('lessonSay', { text: 'почему?' });
      await ws.until((x) => x.lesson?.phase === 'coach');
      await post('reply', reply(1, { say: 'Потому что.', note: 'вопрос по теме' })).expect(200);
      expect((await inbox()).events.map((e) => e.text)).toEqual([
        'Занятие «Тактика», позиция 2/3: ученик: «почему?». Тренер: «Потому что.» [заметка: вопрос по теме]',
      ]);
      ws.close();
      a.close();
    });

    it('«Дальше» without a phrase is not recorded', async () => {
      const { a, ws } = await moved();
      await post('reply', reply(1, { accept: true, action: { type: 'pause' } })).expect(200);
      await ws.until((x) => x.lesson?.phase === 'pause');
      ws.send('lessonNext', {});
      await ws.until((x) => x.lesson?.phase === 'coach');
      await post('reply', reply(2, { action: { type: 'none' } })).expect(200);
      const texts = (await inbox()).events.map((e) => e.text);
      expect(texts).toEqual(['Занятие «Тактика», позиция 2/3: 25.Nd3']);
      ws.close();
      a.close();
    });

    it('a failing inbox write does not break the reply', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { a, ws } = await moved();
        const res = await post('reply', reply(1, { say: 'Так.', action: { type: 'back' } })).expect(200);
        expect(res.body.lesson.phase).toBe('student');
        ws.close();
        a.close();
      } finally {
        log.mockRestore();
      }
    });
  });

  /** Следующее сообщение analysis с нужным статусом. */
  async function waitForAnalysis(ws: WsProbe, status: AnalysisData['status']): Promise<AnalysisData> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const m = await ws.next(Math.max(1, deadline - Date.now()));
      if (m.event === 'analysis' && m.data.status === status) return m.data;
    }
  }
});
