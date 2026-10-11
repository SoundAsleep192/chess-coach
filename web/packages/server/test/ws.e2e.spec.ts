import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BoardState, ServerMessage } from '@board/shared';
import { GAME, setupBoardApp } from './helpers';
import { WsProbe } from './ws-probe';

const board = setupBoardApp();
const stateOf = (m: ServerMessage): BoardState => {
  expect(m.event).toBe('state');
  return (m as { event: 'state'; data: BoardState }).data;
};

describe('WebSocket', () => {
  it('sends state on connect, applies a student move and shows it in the PGN', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await ws.next()).version).toBe(s.version);
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    const st = stateOf(await ws.next());
    expect(st.nodes[st.cursor]).toMatchObject({ san: 'Bc4', author: 'student' });
    const pgn = await request(board.running.http).get('/api/board/pgn').expect(200);
    expect(pgn.text).toContain('(2. Bc4 {ученик})');
    ws.close();
  });

  it('broadcasts coach changes to every open tab', async () => {
    await board.load();
    const a = await WsProbe.open(board.running.wsUrl);
    const b = await WsProbe.open(board.running.wsUrl);
    await a.next();
    await b.next();
    await request(board.running.http).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200);
    expect(stateOf(await a.next()).mode).toBe('frozen');
    expect(stateOf(await b.next()).mode).toBe('frozen');
    a.close();
    b.close();
  });

  it('treats a student move that already exists as navigation and navigates by id', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'g1f3' });
    const moved = stateOf(await ws.next());
    expect(Object.keys(moved.nodes)).toHaveLength(7);
    expect(moved.nodes[moved.cursor]).toMatchObject({ san: 'Nf3', author: 'game' });
    ws.send('navigate', { nodeId: s.rootId });
    expect(stateOf(await ws.next()).cursor).toBe(s.rootId);
    ws.close();
  });

  it('rejects an illegal move with an error and resends the state', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'e1e3' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'illegal', version: s.version } });
    expect(stateOf(await ws.next()).version).toBe(s.version);
    ws.close();
  });

  it('rejects moves, navigation and deletion while frozen', async () => {
    const s = await board.load();
    await request(board.running.http).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200);
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    await ws.next();
    ws.send('navigate', { nodeId: s.rootId });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    await ws.next();
    ws.send('deleteBranch', { nodeId: s.cursor });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'frozen' } });
    ws.close();
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(now.nodes)).toHaveLength(7);
    expect(now.cursor).toBe(s.cursor);
  });

  it('lets the student delete only branches that are entirely theirs', async () => {
    const s = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    ws.send('deleteBranch', { nodeId: s.nodes[s.rootId].children[0] });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'forbidden' } });
    await ws.next();
    ws.send('move', { parentId: s.cursor, uci: 'f1c4' });
    const withMove = stateOf(await ws.next());
    ws.send('deleteBranch', { nodeId: withMove.cursor });
    const after = stateOf(await ws.next());
    expect(after.nodes[withMove.cursor]).toBeUndefined();
    expect(after.cursor).toBe(s.cursor);
    ws.close();
  });

  it('rejects a move from a stale parent id after the coach replaced the tree', async () => {
    const old = await board.load();
    const ws = await WsProbe.open(board.running.wsUrl);
    await ws.next();
    const fresh = await board.load({ pgn: GAME, cursorPly: 3 });
    await ws.next();
    ws.send('move', { parentId: old.cursor, uci: 'f1c4' });
    expect(await ws.next()).toMatchObject({ event: 'error', data: { code: 'not_found' } });
    expect(stateOf(await ws.next()).version).toBe(fresh.version);
    const now = (await request(board.running.http).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(now.nodes)).toHaveLength(7);
    ws.close();
  });

  it('gives a reconnecting tab the same state, also after a server restart', async () => {
    const s = await board.load();
    const a = await WsProbe.open(board.running.wsUrl);
    await a.next();
    a.close();
    const b = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await b.next())).toMatchObject({ version: s.version, cursor: s.cursor });
    b.close();
    await board.restart();
    const c = await WsProbe.open(board.running.wsUrl);
    expect(stateOf(await c.next())).toMatchObject({ version: s.version, cursor: s.cursor });
    c.close();
  });
});
