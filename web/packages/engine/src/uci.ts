import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { EngineLine } from '@board/shared';

export interface UciStartOptions {
  /** Аргументы процесса (для поддельного движка в тестах). */
  args?: string[];
  hashMb: number;
  /** Предел ожидания на один анализ, мс. По умолчанию defaultTimeout(nodes). */
  timeoutMs?: number;
  /** Предел ожидания запуска процесса (uci, isready), мс. По умолчанию 30 с. */
  startTimeoutMs?: number;
}

export interface UciSearch {
  multipv?: number;
  searchmoves?: string[];
  nodes: number;
}

/** Запас с большим коэффициентом: 1M узлов на одном потоке - около секунды, предел нужен против зависшего процесса. */
export function defaultTimeout(nodes: number): number {
  return Math.max(30_000, Math.round(nodes / 10));
}

export function parseInfo(line: string): (EngineLine & { multipv: number }) | null {
  if (!line.startsWith('info ') || / (lowerbound|upperbound)( |$)/.test(line)) return null;
  const t = line.trim().split(/\s+/);
  let multipv = 1;
  let depth: number | undefined;
  let cp: number | undefined;
  let mate: number | undefined;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] === 'multipv') {
      multipv = Number(t[++i]);
    } else if (t[i] === 'depth') {
      depth = Number(t[++i]);
    } else if (t[i] === 'score') {
      const kind = t[++i];
      const value = Number(t[++i]);
      if (kind === 'cp') cp = value;
      else if (kind === 'mate') mate = value;
    } else if (t[i] === 'pv') {
      pv = t.slice(i + 1);
      break;
    }
  }
  if (pv.length === 0 || (cp === undefined && mate === undefined)) return null;
  const out: EngineLine & { multipv: number } = { multipv, move: pv[0], pv };
  if (cp !== undefined) out.cp = cp;
  if (mate !== undefined) out.mate = mate;
  if (depth !== undefined) out.depth = depth;
  return out;
}

/** Один процесс Stockfish: Threads=1, перед каждым анализом ucinewgame, поиск по числу узлов - ответ детерминирован. */
export class UciEngine {
  version = '';
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>;
  private readonly timeoutMs: number | undefined;
  private readonly buffer: string[] = [];
  private waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;
  private exited: Error | null = null;
  private exitListener: (() => void) | null = null;
  private readonly closed: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(path: string, args: string[], timeoutMs: number | undefined) {
    this.timeoutMs = timeoutMs;
    this.proc = spawn(path, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.closed = new Promise((resolve) => this.proc.once('close', () => resolve()));
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const waiter = this.waiter;
      this.waiter = null;
      if (waiter) waiter.resolve(line);
      else this.buffer.push(line);
    });
    this.proc.on('error', (err) => this.fail(new Error(`engine failed to start or run (${path}): ${err.message}`)));
    this.proc.stdin.on('error', (err) => this.fail(new Error(`engine pipe broken: ${err.message}`)));
    this.proc.on('close', (code) => this.fail(new Error(`engine exited with code ${code}`)));
  }

  static async start(path: string, opts: UciStartOptions): Promise<UciEngine> {
    const engine = new UciEngine(path, opts.args ?? [], opts.timeoutMs);
    const timeout = opts.startTimeoutMs ?? 30_000;
    try {
      engine.send('uci');
      await engine.until(
        (l) => l === 'uciok',
        (l) => {
          if (l.startsWith('id name ')) engine.version = l.slice('id name '.length).trim();
        },
        timeout,
      );
      engine.send('setoption name Threads value 1');
      engine.send(`setoption name Hash value ${opts.hashMb}`);
      await engine.ready(timeout);
    } catch (err) {
      engine.kill();
      throw err;
    }
    return engine;
  }

  /** Вызовы к одному процессу идут строго по очереди: у него один поток вывода. */
  analyse(fen: string, search: UciSearch): Promise<EngineLine[]> {
    const run = this.queue.then(() => this.analyseNow(fen, search));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Процесс завершился (упал, убит, завис). */
  get dead(): boolean {
    return this.exited !== null;
  }

  /** Вызывается один раз, когда процесс умер; если он уже мёртв - сразу. */
  onExit(listener: () => void): void {
    this.exitListener = listener;
    if (this.exited) listener();
  }

  kill(): void {
    this.proc.kill('SIGKILL');
  }

  async close(): Promise<void> {
    if (!this.exited) {
      try {
        this.send('quit');
      } catch {
        // процесс уже умер
      }
      const killer = setTimeout(() => this.kill(), 2000);
      try {
        await this.closed;
      } finally {
        clearTimeout(killer);
      }
    } else {
      this.kill();
      await this.closed;
    }
  }

  private async analyseNow(fen: string, search: UciSearch): Promise<EngineLine[]> {
    if (this.exited) throw this.exited;
    const timeout = this.timeoutMs ?? defaultTimeout(search.nodes);
    this.send(`setoption name MultiPV value ${search.multipv ?? 1}`);
    this.send('ucinewgame');
    await this.ready(timeout);
    this.send(`position fen ${fen}`);
    const moves = search.searchmoves?.length ? ` searchmoves ${search.searchmoves.join(' ')}` : '';
    this.send(`go nodes ${search.nodes}${moves}`);
    const lines = new Map<number, EngineLine>();
    await this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        const info = parseInfo(l);
        if (info) {
          const { multipv, ...line } = info;
          lines.set(multipv, line);
        }
      },
      timeout,
    );
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
  }

  private fail(err: Error): void {
    const first = !this.exited;
    if (first) this.exited = err;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(this.exited!);
    if (first) this.exitListener?.();
  }

  private send(cmd: string): void {
    if (this.exited) throw this.exited;
    this.proc.stdin.write(`${cmd}\n`);
  }

  private next(deadline: number, timeout: number): Promise<string> {
    if (this.exited) return Promise.reject(this.exited);
    const line = this.buffer.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`engine timed out after ${timeout} ms`));
        this.kill();
      }, Math.max(0, deadline - Date.now()));
      this.waiter = {
        resolve: (l) => (clearTimeout(timer), resolve(l)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });
  }

  private async until(stop: (line: string) => boolean, each: ((line: string) => void) | undefined, timeout: number): Promise<string> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const line = await this.next(deadline, timeout);
      each?.(line);
      if (stop(line)) return line;
    }
  }

  private async ready(timeout: number): Promise<void> {
    this.send('isready');
    await this.until((l) => l === 'readyok', undefined, timeout);
  }
}
