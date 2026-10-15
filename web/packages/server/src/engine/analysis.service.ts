import { Inject, Injectable } from '@nestjs/common';
import type { AnalyseOptions, EngineLine } from '@board/shared';

/** Токен клиента сервиса движка: в приложении EngineClient, в тестах - поддельный. */
export const ENGINE_CLIENT = 'ENGINE_CLIENT';
export const CACHE_SIZE = 500;

export interface EngineLike {
  analyse(fen: string, opts?: AnalyseOptions): Promise<EngineLine[]>;
}

export interface AnalysisQuery {
  multipv?: number;
  searchmoves?: string[];
}

const keyOf = (fen: string, q: AnalysisQuery) => `${fen}|${q.multipv ?? 1}|${(q.searchmoves ?? []).join(',')}|`;

/** Анализы для задач: приоритет interactive, кэш последних 500 ответов, одинаковые запросы в полёте склеиваются. */
@Injectable()
export class AnalysisService {
  private readonly cache = new Map<string, EngineLine[]>();
  private readonly inflight = new Map<string, Promise<EngineLine[]>>();

  constructor(@Inject(ENGINE_CLIENT) private readonly engine: EngineLike) {}

  analyse(fen: string, q: AnalysisQuery = {}): Promise<EngineLine[]> {
    const key = keyOf(fen, q);
    const hit = this.touch(key);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running;
    const request = this.engine.analyse(fen, { ...q, priority: 'interactive' }).then(
      (lines) => {
        this.inflight.delete(key);
        this.remember(key, lines);
        return lines;
      },
      (e: unknown) => {
        this.inflight.delete(key);
        throw e;
      },
    );
    this.inflight.set(key, request);
    return request;
  }

  /** Готовый анализ из кэша без запроса к движку. */
  cached(fen: string, q: AnalysisQuery = {}): EngineLine[] | undefined {
    return this.touch(keyOf(fen, q));
  }

  private touch(key: string): EngineLine[] | undefined {
    const lines = this.cache.get(key);
    if (lines) {
      this.cache.delete(key);
      this.cache.set(key, lines);
    }
    return lines;
  }

  private remember(key: string, lines: EngineLine[]): void {
    this.cache.set(key, lines);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
  }
}
