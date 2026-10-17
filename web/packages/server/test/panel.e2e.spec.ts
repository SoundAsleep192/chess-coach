import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { AnalysisData, BoardState, ServerMessage } from '@board/shared';
import { MATE1 } from './puzzle-fixtures';
import { engine, GAME, setupBoardApp, withDb } from './helpers';
import { WsProbe } from './ws-probe';

process.env.PUZZLE_REPLY_MS = '20';

const FALLBACK = [
  { move: 'g1f3', cp: 25, pv: ['g1f3', 'b8c6'] },
  { move: 'b1c3', cp: 10, pv: ['b1c3'] },
];

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

/** Следующее сообщение analysis, состояния пропускаются. */
async function nextAnalysis(ws: WsProbe, timeoutMs = 3000): Promise<AnalysisData> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const m = await ws.next(Math.max(1, deadline - Date.now()));
    if (m.event === 'analysis') return m.data;
  }
}

const analyses = (msgs: ServerMessage[]) => msgs.filter((m) => m.event === 'analysis');

describe('panel', () => {
  const board = setupBoardApp();
  const patch = (path: string, body: object) => request(board.running.http).patch(`/api/board/${path}`).send(body);

  it('turning eval on sends pending then ready for the cursor node, white-side eval', async () => {
    engine.fallback = FALLBACK;
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    const res = await patch('panel', { eval: true, lines: 2 }).expect(200);
    expect(res.body.panel).toEqual({ eval: true, lines: 2 });
    const pending = await nextAnalysis(ws);
    expect(pending).toMatchObject({ nodeId: s.cursor, status: 'pending', lines: [] });
    const ready = await nextAnalysis(ws);
    expect(ready.status).toBe('ready');
    expect(ready.nodeId).toBe(s.cursor);
    expect(ready.fen).toBe(s.nodes[s.cursor].fen);
    expect(ready.lines).toHaveLength(2);
    expect(ready.lines[0].san[0]).toMatch(/^\d+\.[A-Za-z]/);
    expect(ready.lines[0].cp).toBe(s.nodes[s.cursor].fen.split(' ')[1] === 'w' ? 25 : -25);
    expect(engine.calls.at(-1)!.opts.multipv).toBe(2);
    ws.close();
  });

  it('fast cursor moves produce one engine request for the last node', async () => {
    engine.fallback = FALLBACK;
    await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    await patch('panel', { eval: true, lines: 1 }).expect(200);
    await nextAnalysis(ws);
    await nextAnalysis(ws);
    engine.calls.length = 0;
    await patch('cursor', { at: 2 }).expect(200);
    await patch('cursor', { at: 4 }).expect(200);
    const last = (await patch('cursor', { at: 6 }).expect(200)).body as BoardState;
    await collect(ws, 800);
    expect(engine.calls.map((c) => c.fen)).toEqual([last.nodes[last.cursor].fen]);
    ws.close();
  });

  it('engine down -> unavailable; board still works', async () => {
    engine.down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await board.load();
      const ws = await WsProbe.open(board.running.wsUrl);
      await ws.next();
      await patch('panel', { eval: true, lines: 1 }).expect(200);
      expect((await nextAnalysis(ws)).status).toBe('pending');
      const bad = await nextAnalysis(ws);
      expect(bad.status).toBe('unavailable');
      expect(bad.lines).toEqual([]);
      await patch('cursor', { at: 2 }).expect(200);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('panel analysis failed'));
      ws.close();
    } finally {
      log.mockRestore();
    }
  });

  it('after unavailable, a repeated PATCH with the same settings re-runs the analysis', async () => {
    engine.down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await board.load();
      const ws = await WsProbe.open(board.running.wsUrl);
      await ws.next();
      await patch('panel', { eval: true, lines: 1 }).expect(200);
      expect((await nextAnalysis(ws)).status).toBe('pending');
      expect((await nextAnalysis(ws)).status).toBe('unavailable');
      engine.down = false;
      engine.fallback = FALLBACK;
      await patch('panel', { eval: true, lines: 1 }).expect(200);
      expect((await nextAnalysis(ws)).status).toBe('pending');
      expect((await nextAnalysis(ws)).status).toBe('ready');
      ws.close();
    } finally {
      log.mockRestore();
    }
  });

  it('PUT /api/board turns the panel off and no analysis is sent for the new tree', async () => {
    engine.fallback = FALLBACK;
    await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    await patch('panel', { eval: true, lines: 2, note: 'смотри на слона' }).expect(200);
    await nextAnalysis(ws);
    await nextAnalysis(ws);
    engine.calls.length = 0;
    const s = await board.load({ pgn: GAME, upto: 3 });
    expect(s.panel).toEqual({ eval: false, lines: 0 });
    const after = await collect(ws, 700);
    expect(analyses(after)).toEqual([]);
    expect(after.some((m) => m.event === 'state' && m.data.panel?.note === undefined && m.data.version === s.version)).toBe(true);
    expect(engine.calls).toEqual([]);
    ws.close();
  });

  it('no analysis in puzzle mode even with the panel on', async () => {
    engine.fallback = [{ move: 'h5f7', mate: 1, pv: ['h5f7'] }];
    await board.load();
    await patch('panel', { eval: true, lines: 1 }).expect(200);
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    await request(board.running.http).post('/api/puzzles/next').send({ id: (await seedMate()) }).expect(200);
    const st = await ws.until((x) => x.mode === 'puzzle');
    expect(st.panel).toEqual({ eval: false, lines: 0 });
    await collect(ws, 100);
    engine.calls.length = 0;
    await patch('panel', { eval: true }).expect(200);
    const after = await collect(ws, 700);
    expect(analyses(after)).toEqual([]);
    expect(engine.calls).toEqual([]);
    ws.close();
  });

  it('a new tab gets the latest analysis on connect', async () => {
    engine.fallback = FALLBACK;
    const s = await board.load();
    const first = await WsProbe.open(board.running.wsUrl);
    await first.next();
    await patch('panel', { eval: true, lines: 1 }).expect(200);
    await nextAnalysis(first);
    const ready = await nextAnalysis(first);
    const tab = await WsProbe.open(board.running.wsUrl);
    expect((await tab.next()).event).toBe('state');
    const got = await tab.next();
    expect(got).toEqual({ event: 'analysis', data: ready });
    expect(ready.nodeId).toBe(s.cursor);
    first.close();
    tab.close();
  });

  it('an old board document without panel and treeEpoch loads with the panel off', async () => {
    const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    await withDb((db) => db.collection('boards').updateOne({ _id: 'main' } as never, { $unset: { panel: '', treeEpoch: '' } }));
    await board.restart();
    const res = await request(board.running.http).get('/api/board').expect(200);
    expect(res.body.panel ?? { eval: false, lines: 0 }).toEqual({ eval: false, lines: 0 });
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: res.body.cursor, uci: 'g1f3' });
    await ws.until((x) => x.version > res.body.version);
    const inbox = await request(board.running.http).get('/api/inbox').expect(200);
    expect(inbox.body.events).toHaveLength(1);
    expect(inbox.body.events[0].kind).toBe('line');
    expect(engine.calls).toEqual([]);
    expect(s.panel).toEqual({ eval: false, lines: 0 });
    ws.close();
  });

  it('merges partial patches and removes the note with null', async () => {
    const a = await patch('panel', { note: 'план' }).expect(200);
    expect(a.body.panel).toEqual({ eval: false, lines: 0, note: 'план' });
    const b = await patch('panel', { lines: 3 }).expect(200);
    expect(b.body.panel).toEqual({ eval: false, lines: 3, note: 'план' });
    const c = await patch('panel', { note: null }).expect(200);
    expect(c.body.panel).toEqual({ eval: false, lines: 3 });
  });

  it('rejects bad panel bodies', async () => {
    const a = await patch('panel', { lines: 5 }).expect(400);
    expect(a.body.code).toBe('bad_request');
    await patch('panel', {}).expect(400);
  });
});

async function seedMate(): Promise<string> {
  await withDb((db) => db.collection('puzzles').replaceOne({ _id: MATE1._id } as never, MATE1 as never, { upsert: true }));
  return MATE1._id;
}
