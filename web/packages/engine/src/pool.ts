import type { EngineLine, EnginePriority } from '@board/shared';
import { UciEngine } from './uci';

export const MAX_QUEUE = 1000;
export const MAX_NODES = 5_000_000;

export interface PoolOptions {
  /** Путь к Stockfish или к node для поддельного движка. */
  command: string;
  args?: string[];
  workers: number;
  hashMb: number;
  /** Узлов на анализ, если запрос не задал свои. */
  nodes: number;
  maxQueue?: number;
  timeoutMs?: number;
  /** Предел запуска процесса, мс; по умолчанию 30 с, не зависит от timeoutMs. */
  startTimeoutMs?: number;
  restartDelayMs?: number;
}

export interface PoolRequest {
  fen: string;
  multipv?: number;
  searchmoves?: string[];
  nodes?: number;
  priority?: EnginePriority;
}

export class QueueFull extends Error {
  constructor(limit: number) {
    super(`engine queue is full (${limit} requests waiting)`);
    this.name = 'QueueFull';
  }
}

interface Job {
  req: PoolRequest;
  resolve: (lines: EngineLine[]) => void;
  reject: (err: Error) => void;
}

interface Worker {
  engine: UciEngine | null;
  busy: boolean;
  /** Последняя попытка перезапуска не удалась: процесса нет и пока не будет. */
  restartFailed: boolean;
}

/** Пул процессов Stockfish с общей очередью: interactive обгоняет batch, внутри приоритета - по порядку. */
export class EnginePool {
  version = '';
  private workers: Worker[] = [];
  private readonly queues: Record<EnginePriority, Job[]> = { interactive: [], batch: [] };
  private closed = false;
  private readonly opts: PoolOptions;

  private constructor(opts: PoolOptions) {
    this.opts = opts;
  }

  static async start(opts: PoolOptions): Promise<EnginePool> {
    const pool = new EnginePool(opts);
    const started = await Promise.allSettled(Array.from({ length: opts.workers }, () => pool.spawn()));
    const engines = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = started.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      engines.forEach((e) => e.kill());
      throw failed.reason;
    }
    pool.workers = engines.map((engine) => ({ engine, busy: false, restartFailed: false }));
    pool.workers.forEach((w) => pool.watch(w, w.engine!));
    pool.version = engines[0]?.version ?? '';
    return pool;
  }

  get defaultNodes(): number {
    return this.opts.nodes;
  }

  analyse(req: PoolRequest): Promise<EngineLine[]> {
    if (this.closed) return Promise.reject(new Error('engine pool is closed'));
    // ни одного живого процесса и перезапуски не удаются: очередь никто не разберёт
    if (!this.alive() && this.workers.every((w) => w.restartFailed)) {
      return Promise.reject(new Error('engine is not running: no worker could be restarted'));
    }
    const limit = this.opts.maxQueue ?? MAX_QUEUE;
    const idle = this.workers.some((w) => w.engine && !w.engine.dead && !w.busy);
    if (!idle && this.queued() >= limit) return Promise.reject(new QueueFull(limit));
    return new Promise((resolve, reject) => {
      this.queues[req.priority ?? 'interactive'].push({ req, resolve, reject });
      this.pump();
    });
  }

  alive(): boolean {
    return this.workers.some((w) => w.engine !== null && !w.engine.dead);
  }

  stats(): { workers: number; busy: number; queued: number } {
    return { workers: this.workers.length, busy: this.workers.filter((w) => w.busy).length, queued: this.queued() };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of [...this.queues.interactive.splice(0), ...this.queues.batch.splice(0)]) {
      job.reject(new Error('engine pool is closed'));
    }
    await Promise.all(this.workers.map((w) => w.engine?.close()));
  }

  private queued(): number {
    return this.queues.interactive.length + this.queues.batch.length;
  }

  private spawn(): Promise<UciEngine> {
    return UciEngine.start(this.opts.command, { args: this.opts.args, hashMb: this.opts.hashMb, timeoutMs: this.opts.timeoutMs,
      startTimeoutMs: this.opts.startTimeoutMs,
    });
  }

  /** Простаивающий процесс умер: заменить его, не дожидаясь следующего запроса. */
  private watch(w: Worker, engine: UciEngine): void {
    engine.onExit(() => {
      if (w.engine !== engine || w.busy) return; // занятого обработает run
      w.engine = null;
      this.restart(w);
    });
  }

  private pump(): void {
    for (const w of this.workers) {
      if (w.busy || !w.engine || w.engine.dead) continue;
      const job = this.queues.interactive.shift() ?? this.queues.batch.shift();
      if (!job) return;
      this.run(w, w.engine, job);
    }
  }

  private run(w: Worker, engine: UciEngine, job: Job): void {
    w.busy = true;
    const { fen, multipv, searchmoves, nodes } = job.req;
    engine.analyse(fen, { multipv, searchmoves, nodes: nodes ?? this.opts.nodes }).then(
      (lines) => {
        w.busy = false;
        job.resolve(lines);
        this.pump();
      },
      (err: Error) => {
        // процесс упал или завис: запрос получает ошибку, процесс заменяется новым
        job.reject(err);
        engine.kill();
        w.engine = null;
        w.busy = false;
        this.restart(w);
      },
    );
  }

  private restart(w: Worker): void {
    if (this.closed) return;
    this.spawn().then(
      (engine) => {
        if (this.closed) {
          engine.kill();
          return;
        }
        w.engine = engine;
        w.restartFailed = false;
        this.watch(w, engine);
        this.pump();
      },
      (err: Error) => {
        w.restartFailed = true;
        console.error(`engine: cannot restart a worker: ${err.message}`);
        setTimeout(() => this.restart(w), this.opts.restartDelayMs ?? 1000).unref();
      },
    );
  }
}
