import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineClient, EngineRequestError, EngineUnavailable, winPct } from './engine.ts';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

/** HTTP-заглушка сервиса движка на свободном порту. */
async function stub(handler: Handler): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});

const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

describe('winPct', () => {
  it('follows the Lichess model and treats mate as 100 or 0', () => {
    expect(winPct({ cp: 0 })).toBeCloseTo(50, 5);
    expect(winPct({ cp: 300 })).toBeCloseTo(75.11, 1);
    expect(winPct({ cp: 5000 })).toBe(winPct({ cp: 1000 }));
    expect(winPct({ mate: 3 })).toBe(100);
    expect(winPct({ mate: -2 })).toBe(0);
  });
});

describe('EngineClient', () => {
  it('posts the request with the default priority and returns the lines', async () => {
    const seen: { method?: string; url?: string; body: unknown }[] = [];
    const s = await stub((req, body, res) => {
      seen.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      json(res, 200, { fen: 'f', nodes: 1000, lines: [{ move: 'a1a8', mate: 1, pv: ['a1a8'], depth: 3 }] });
    });
    servers.push(s.server);
    const client = new EngineClient(`${s.url}/`, { priority: 'batch' });
    expect(await client.analyse('f', { multipv: 2, searchmoves: ['a1a8'] })).toEqual([
      { move: 'a1a8', mate: 1, pv: ['a1a8'], depth: 3 },
    ]);
    expect(await new EngineClient(s.url).analyse('g')).toHaveLength(1);
    expect(seen).toEqual([
      { method: 'POST', url: '/analyse', body: { fen: 'f', multipv: 2, searchmoves: ['a1a8'], priority: 'batch' } },
      { method: 'POST', url: '/analyse', body: { fen: 'g', priority: 'interactive' } },
    ]);
  });

  it('reads health', async () => {
    const s = await stub((_req, _body, res) => json(res, 200, { ok: true, version: 'Stockfish 19', workers: 4, busy: 0, queued: 0 }));
    servers.push(s.server);
    expect(await new EngineClient(s.url).health()).toEqual({ ok: true, version: 'Stockfish 19', workers: 4, busy: 0, queued: 0 });
  });

  it('turns an error answer into EngineRequestError with the status and the server message', async () => {
    const s = await stub((_req, _body, res) => json(res, 400, { statusCode: 400, message: 'bad FEN: Invalid FEN', error: 'Bad Request' }));
    servers.push(s.server);
    const err = await new EngineClient(s.url).analyse('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineRequestError);
    expect(err).toMatchObject({ status: 400, message: 'bad FEN: Invalid FEN' });
  });

  it('reports EngineUnavailable with the url when nothing listens or the answer is late', async () => {
    const closed = await stub(() => undefined);
    const url = closed.url;
    await new Promise((resolve) => closed.server.close(resolve));
    await expect(new EngineClient(url).health()).rejects.toThrow(EngineUnavailable);
    await expect(new EngineClient(url).health()).rejects.toThrow(`engine unavailable at ${url}`);
    const silent = await stub(() => undefined);
    servers.push(silent.server);
    await expect(new EngineClient(silent.url, { timeoutMs: 200 }).analyse('x')).rejects.toThrow(EngineUnavailable);
  });
});
