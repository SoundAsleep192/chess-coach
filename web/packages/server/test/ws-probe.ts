import WebSocket from 'ws';
import type { BoardState, ServerMessage } from '@board/shared';

/** WebSocket-клиент для тестов: складывает сообщения в очередь и отдаёт по одному. */
export class WsProbe {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((m: ServerMessage) => void)[] = [];
  readonly ws: WebSocket;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  static async open(url: string): Promise<WsProbe> {
    const probe = new WsProbe(url);
    await new Promise<void>((resolve, reject) => {
      probe.ws.once('open', () => resolve());
      probe.ws.once('error', reject);
    });
    return probe;
  }

  next(timeoutMs = 3000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no ws message')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  /** Пропускать сообщения, пока не придёт состояние, для которого pred верно. */
  async until(pred: (s: BoardState) => boolean, timeoutMs = 3000): Promise<BoardState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const msg = await this.next(Math.max(1, deadline - Date.now()));
      if (msg.event === 'state' && pred(msg.data)) return msg.data;
    }
  }

  send(event: string, data: unknown): void {
    this.ws.send(JSON.stringify({ event, data }));
  }

  close(): void {
    this.ws.close();
  }
}
