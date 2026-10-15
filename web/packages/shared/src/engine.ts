/** API сервиса движка (web/packages/engine) и клиент к нему. Оценки - со стороны того, кто ходит в fen. */

export const DEFAULT_ENGINE_URL = 'http://127.0.0.1:8766';

export interface EngineLine {
  /** Первый ход линии, UCI. */
  move: string;
  cp?: number;
  mate?: number;
  pv: string[];
  depth?: number;
}

export type EnginePriority = 'interactive' | 'batch';

export interface AnalyseRequest {
  fen: string;
  multipv?: number;
  searchmoves?: string[];
  nodes?: number;
  priority?: EnginePriority;
}

export type AnalyseOptions = Omit<AnalyseRequest, 'fen'>;

export interface AnalyseResponse {
  fen: string;
  nodes: number;
  lines: EngineLine[];
}

export interface EngineHealth {
  ok: boolean;
  version: string;
  workers: number;
  busy: number;
  queued: number;
}

/** Модель win% Lichess (как coach/engine.py win_pct), со стороны того, чья оценка. */
export function winPct(line: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, line.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Сервис не ответил: не запущен, сеть, таймаут. */
export class EngineUnavailable extends Error {
  override name = 'EngineUnavailable';
}

/** Сервис ответил ошибкой: 400 - неверный запрос, 503 - очередь полна, 500 - сбой движка. */
export class EngineRequestError extends Error {
  override name = 'EngineRequestError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface EngineClientOptions {
  timeoutMs?: number;
  priority?: EnginePriority;
}

export class EngineClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly priority: EnginePriority;

  constructor(baseUrl: string, opts: EngineClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.priority = opts.priority ?? 'interactive';
  }

  async analyse(fen: string, opts: AnalyseOptions = {}): Promise<EngineLine[]> {
    const body: AnalyseRequest = { fen, ...opts, priority: opts.priority ?? this.priority };
    const res = await this.request('/analyse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await res.json()) as AnalyseResponse).lines;
  }

  async health(): Promise<EngineHealth> {
    const res = await this.request('/health', { method: 'GET' });
    return (await res.json()) as EngineHealth;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new EngineUnavailable(`engine unavailable at ${this.baseUrl}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        // не JSON: оставляем текст как есть
      }
      throw new EngineRequestError(res.status, message || `HTTP ${res.status}`);
    }
    return res;
  }
}
