import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { connectEngine } from './connect.ts';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('connectEngine', () => {
  it('checks health first and then sends batch requests', async () => {
    const bodies: unknown[] = [];
    const url = await listen((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/health') return res.end(JSON.stringify({ ok: true, version: 'Stockfish 19', workers: 4, busy: 0, queued: 0 }));
        bodies.push(JSON.parse(body));
        res.end(JSON.stringify({ fen: 'f', nodes: 1, lines: [] }));
      });
    });
    const engine = await connectEngine(url);
    expect(await engine.analyse('f', { multipv: 2 })).toEqual([]);
    expect(bodies).toEqual([{ fen: 'f', multipv: 2, priority: 'batch' }]);
  });

  it('fails before any work with a hint when the service is down', async () => {
    const url = await listen(() => undefined);
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    await expect(connectEngine(url)).rejects.toThrow(`engine service is not running at ${url}: docker compose up -d engine`);
  });

  it('treats a 503 and an ok:false answer of /health as a service that is not running', async () => {
    const down = JSON.stringify({ ok: false, version: '', workers: 0, busy: 0, queued: 0 });
    let status = 503;
    const url = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(down);
    });
    await expect(connectEngine(url)).rejects.toThrow(`engine service is not running at ${url}: docker compose up -d engine`);
    status = 200;
    await expect(connectEngine(url)).rejects.toThrow(`engine service is not running at ${url}: docker compose up -d engine`);
  });
});
