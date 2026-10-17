import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FORK, FORK_NF6, FORK_ROOT } from './puzzle-fixtures';
import { engine, setupBoardApp, startPuzzle, withDb } from './helpers';
import { WsProbe } from './ws-probe';
import { InboxRepository } from '../src/inbox/inbox-repository';
import { InboxService } from '../src/inbox/inbox.service';

process.env.PUZZLE_REPLY_MS = '20';

describe('inbox', () => {
  const board = setupBoardApp();
  const inbox = async () => (await request(board.running.http).get('/api/inbox').expect(200)).body;

  it('glues consecutive student moves, ack clears them, coach actions are not recorded', async () => {
    const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    const s1 = await ws.until((x) => x.version > s.version);
    ws.send('move', { parentId: s1.cursor, uci: 'b8c6' });
    await ws.until((x) => x.version > s1.version);
    const body = await inbox();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].text).toMatch(/^ветка ученика от 1\.\.\.e5: 2\.Nf3 Nc6 \(узлы n\d+-n\d+\)$/);
    expect(body.cursor).toBe('курсор после 2...Nc6 (ветка ученика), режим free');
    await request(board.running.http).post('/api/inbox/ack').send({ upto: body.events[0].id }).expect(200);
    expect((await inbox()).events).toEqual([]);
    await request(board.running.http).post('/api/board/lines').send({ at: 2, moves: ['c5'] }).expect(200);
    expect((await inbox()).events).toEqual([]);
    ws.close();
  });

  it('rejects a bad ack body with 400', async () => {
    await request(board.running.http).post('/api/inbox/ack').send({ upto: 'x' }).expect(400);
    await request(board.running.http).post('/api/inbox/ack').send({}).expect(400);
  });

  it('a new tree starts a new event and a student delete is recorded', async () => {
    const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    const s1 = await ws.until((x) => x.version > s.version);
    const t = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    expect(t.treeEpoch).toBe((s.treeEpoch ?? 0) + 1);
    await ws.until((x) => x.version > s1.version);
    ws.send('move', { parentId: t.cursor, uci: 'g1f3' });
    const s2 = await ws.until((x) => x.version > t.version);
    ws.send('deleteBranch', { nodeId: s2.cursor });
    await ws.until((x) => x.version > s2.version);
    const body = await inbox();
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(['line', 'line', 'delete']);
    expect(body.events[0].text).toMatch(/^ветка ученика от 1\.\.\.e5: 2\.Nf3 \(узел n\d+\)$/);
    expect(body.events[2].text).toBe('ученик удалил ветку 2.Nf3 (1 полуход)');
    ws.close();
  });

  it('records puzzle outcomes and moves after «Показать решение» without duplicates', async () => {
    engine.on(FORK.fen, FORK_ROOT).on(FORK.fen, FORK_NF6, ['d5f6']);
    const { ws, state } = await startPuzzle(board, FORK);
    ws.send('move', { parentId: state.cursor, uci: 'd5f6' });
    await ws.until((s) => s.puzzle?.phase === 'feedback');
    ws.send('puzzleGiveUp', {});
    const shown = await ws.until((s) => s.puzzle?.status === 'failed');
    expect(shown.mode).toBe('free');
    ws.send('move', { parentId: shown.cursor, uci: 'g1g2' });
    await ws.until((s) => s.version > shown.version);
    const body = await inbox();
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(['puzzle', 'puzzle', 'line']);
    expect(body.events[0].text).toMatch(/^задача raduga:1-1-001: ошибка, ход 1\.Nf6\+, «.+»$/);
    expect(body.events[1].text).toBe('задача raduga:1-1-001: показано решение 1.Nc7+ Kd7 2.Nxa8');
    expect(body.events[2].text).toMatch(/^ветка ученика от начальной позиции: 1\.Kg2 \(узел n\d+\)$/);
    expect(body.more).toBe(0);
    ws.close();
  });

  it('a failing inbox write does not break the move', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
      const insert = vi.spyOn(board.running.app.get(InboxRepository), 'insert').mockRejectedValue(new Error('down'));
      const ws = await WsProbe.open(board.running.wsUrl);
      const other = await WsProbe.open(board.running.wsUrl);
      await ws.next();
      await other.next();
      ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
      const moved = await ws.until((x) => x.version > s.version);
      const seen = await other.until((x) => x.version > s.version);
      expect(seen.nodes[seen.cursor].san).toBe('Nf3');
      expect(moved.nodes[moved.cursor].author).toBe('student');
      await board.running.app.get(InboxService).flush();
      expect(insert).toHaveBeenCalled();
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('inbox write failed') && l.includes('down'))).toBe(true);
      ws.close();
      other.close();
    } finally {
      log.mockRestore();
    }
  });

  it('keeps at most 500 events and returns 50 with a count of the rest', async () => {
    const s = await board.load({ pgn: '1. e4 e5 *', orientation: 'white' });
    await withDb((db) =>
      db.collection('inbox').insertMany(
        Array.from({ length: 520 }, (_, i) => ({
          _id: i + 1 as never, at: new Date(), kind: 'puzzle', treeEpoch: 0, read: false, text: `seed ${i + 1}`,
        })),
      ),
    );
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    await ws.until((x) => x.version > s.version);
    const body = await inbox();
    expect(await withDb((db) => db.collection('inbox').countDocuments())).toBe(500);
    expect(body.events).toHaveLength(50);
    expect(body.more).toBe(450);
    expect(body.events[0].id).toBe(22);
    ws.close();
  });
});
