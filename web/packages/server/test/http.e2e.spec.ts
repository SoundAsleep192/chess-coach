import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BoardState } from '@board/shared';
import { GAME, setupBoardApp } from './helpers';

const board = setupBoardApp();
const http = () => board.running.http;

describe('HTTP API', () => {
  it('starts with an empty board at the initial position', async () => {
    const s = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(Object.keys(s.nodes)).toHaveLength(1);
    expect(s).toMatchObject({ mode: 'free', orientation: 'white', version: 1 });
  });

  it('loads a game and returns the state', async () => {
    const s = await board.load();
    expect(s.orientation).toBe('black');
    expect(s.nodes[s.cursor].san).toBe('e5');
    expect(Object.keys(s.nodes)).toHaveLength(7);
    const health = await request(http()).get('/api/health').expect(200);
    expect(health.body).toEqual({ ok: true });
  });

  it('adds a coach line from a ply number and moves the cursor with arrows', async () => {
    await board.load();
    const s1 = (await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4', 'Nf6'] }).expect(200))
      .body as BoardState;
    const nf3 = Object.values(s1.nodes).find((n) => n.san === 'Nf3')!;
    const nc6 = s1.nodes[nf3.children[0]];
    const bc4 = s1.nodes[nc6.children[1]];
    expect(bc4).toMatchObject({ san: 'Bc4', author: 'coach' });
    const s2 = (
      await request(http())
        .patch('/api/board/cursor')
        .send({ at: bc4.id, arrows: [{ from: 'c4', to: 'f7', color: 'red' }], caption: 'f7' })
        .expect(200)
    ).body as BoardState;
    expect(s2.cursor).toBe(bc4.id);
    expect(s2.nodes[bc4.id]).toMatchObject({ arrows: [{ from: 'c4', to: 'f7', color: 'red' }], caption: 'f7' });
    expect(s2.version).toBe(s1.version + 1);
  });

  it('answers 422 naming the illegal move', async () => {
    await board.load();
    const res = await request(http()).post('/api/board/lines').send({ at: 3, moves: ['Nf3', 'Ke3'] }).expect(422);
    expect(res.body.code).toBe('illegal');
    expect(res.body.message).toContain('Ke3');
  });

  it('answers 404 for --at past the end of a game cut with upto, and clamps cursorPly', async () => {
    const s = await board.load({ pgn: GAME, cursorPly: 99, upto: 4 });
    expect(s.nodes[s.cursor].san).toBe('Nf3');
    const res = await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Nc6'] }).expect(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body.message).toContain('1..4');
    await request(http()).patch('/api/board/cursor').send({ at: 'n999' }).expect(404);
  });

  it('serves the tree as PGN with cursor and mode headers', async () => {
    await board.load();
    const res = await request(http()).get('/api/board/pgn').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('[CursorAt "3"]');
    expect(res.text).toContain('[Mode "free"]');
    expect(res.text).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
  });

  it('switches the mode and deletes any branch for the coach', async () => {
    await board.load();
    const s1 = (await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4'] }).expect(200)).body as BoardState;
    const bc4 = Object.values(s1.nodes).find((n) => n.san === 'Bc4')!;
    const s2 = (await request(http()).delete(`/api/board/nodes/${bc4.id}`).expect(200)).body as BoardState;
    expect(s2.nodes[bc4.id]).toBeUndefined();
    const s3 = (await request(http()).patch('/api/board/mode').send({ mode: 'frozen' }).expect(200)).body as BoardState;
    expect(s3.mode).toBe('frozen');
    await request(http()).patch('/api/board/mode').send({ mode: 'sleep' }).expect(400);
    await request(http()).delete('/api/board/nodes/n999').expect(404);
  });

  it('keeps version and node ids growing when the tree is replaced', async () => {
    const a = await board.load();
    const b = await board.load({ fen: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1', moves: ['e8=Q'] });
    expect(b.version).toBeGreaterThan(a.version);
    const oldIds = new Set(Object.keys(a.nodes));
    expect(Object.keys(b.nodes).some((id) => oldIds.has(id))).toBe(false);
    expect(b.nodes[b.cursor]).toMatchObject({ san: 'e8=Q', uci: 'e7e8q' });
  });

  it('serves the built client from CLIENT_DIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-client-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>board</title>');
    process.env.CLIENT_DIR = dir;
    try {
      await board.restart();
      const res = await request(http()).get('/').expect(200);
      expect(res.text).toContain('<title>board</title>');
    } finally {
      delete process.env.CLIENT_DIR;
    }
  });
});

describe('persistence', () => {
  it('keeps the tree after the server restarts', async () => {
    const s = await board.load();
    await request(http()).post('/api/board/lines').send({ at: 5, moves: ['Bc4'] }).expect(200);
    await board.restart();
    const after = (await request(http()).get('/api/board').expect(200)).body as BoardState;
    expect(after.version).toBe(s.version + 1);
    expect(Object.values(after.nodes).some((n) => n.san === 'Bc4')).toBe(true);
    expect(after.meta).toEqual({ plyOffset: 0 });
  });

  it('answers 503 storage and keeps the old state when Mongo is gone', async () => {
    const s = await board.load();
    await board.mongo.stop({ doCleanup: false });
    try {
      const res = await request(http()).patch('/api/board/mode').send({ mode: 'frozen' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('storage');
      await request(http()).get('/api/health').expect(503);
      const now = (await request(http()).get('/api/board').expect(200)).body as BoardState;
      expect(now.version).toBe(s.version);
      expect(now.mode).toBe('free');
    } finally {
      await board.mongo.start(true);
    }
  });

  it('rejects malformed bodies with 400 bad_request', async () => {
    const bad: [string, string, object][] = [
      ['put', '/api/board', { pgn: 5 }],
      ['put', '/api/board', { pgn: '1. e4 *', orientation: 'up' }],
      ['post', '/api/board/lines', { at: 1, moves: [] }],
      ['patch', '/api/board/cursor', { at: 1, arrows: [{ from: 'z9', to: 'e4', color: 'green' }] }],
      ['patch', '/api/board/mode', { mode: 'puzzle' }],
      ['post', '/api/puzzles/next', { source: 'chesscom' }],
    ];
    for (const [method, path, body] of bad) {
      const res = await (request(http()) as any)[method](path).send(body);
      expect(res.status, `${method} ${path}`).toBe(400);
      expect(res.body.code).toBe('bad_request');
    }
  });
});
