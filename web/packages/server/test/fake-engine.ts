import { EngineUnavailable, type AnalyseOptions, type EngineLine } from '@board/shared';
import type { EngineLike } from '../src/engine/analysis.service';

type Line = Omit<EngineLine, 'pv'> & { pv?: string[] };

/** Сервис движка для тестов сервера: ответы записаны по FEN и searchmoves; незаписанная позиция - движок недоступен. */
export class FakeEngineClient implements EngineLike {
  readonly calls: { fen: string; opts: AnalyseOptions }[] = [];
  /** Пауза перед ответом, мс. */
  delayMs = 0;
  /** Сервис лежит: любой запрос - EngineUnavailable. */
  down = false;
  /** Ответ для позиций без записи; без него незаписанная позиция - движок недоступен. */
  fallback?: Line[];
  private entries = new Map<string, EngineLine[]>();

  on(fen: string, lines: Line[], searchmoves?: string[]): this {
    this.entries.set(
      `${fen}|${(searchmoves ?? []).join(' ')}`,
      lines.map((l) => ({ ...l, pv: l.pv ?? [l.move] })),
    );
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.entries = new Map();
    this.delayMs = 0;
    this.down = false;
    this.fallback = undefined;
  }

  async analyse(fen: string, opts: AnalyseOptions = {}): Promise<EngineLine[]> {
    this.calls.push({ fen, opts });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.down) throw new EngineUnavailable('engine unavailable at fake: down');
    const key = `${fen}|${(opts.searchmoves ?? []).join(' ')}`;
    const lines = this.entries.get(key) ?? this.fallback?.map((l) => ({ ...l, pv: l.pv ?? [l.move] }));
    if (!lines) throw new EngineUnavailable(`engine unavailable at fake: no entry for ${key}`);
    return lines.slice(0, opts.multipv ?? 1);
  }
}
