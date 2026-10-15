import type { AnalyseOptions, EngineLine } from '@board/shared';
import type { Engine } from '../engine/solution.ts';

/** Движок для тестов: ответы записаны по FEN (и по searchmoves). Незаписанная позиция - ошибка. */
export class FakeEngine implements Engine {
  readonly calls: { fen: string; opts: AnalyseOptions }[] = [];
  /** Пауза перед ответом, мс: чтобы проверить параллельные запросы. */
  delayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  private readonly entries = new Map<string, EngineLine[]>();

  on(fen: string, lines: { move: string; cp?: number; mate?: number }[], searchmoves?: string[]): this {
    this.entries.set(
      `${fen}|${(searchmoves ?? []).join(' ')}`,
      lines.map((l) => ({ ...l, pv: [l.move] })),
    );
    return this;
  }

  async analyse(fen: string, opts: AnalyseOptions = {}): Promise<EngineLine[]> {
    this.calls.push({ fen, opts });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      const lines = this.entries.get(`${fen}|${(opts.searchmoves ?? []).join(' ')}`);
      if (!lines) throw new Error(`FakeEngine: no entry for ${fen}${opts.searchmoves ? ` searchmoves ${opts.searchmoves.join(' ')}` : ''}`);
      return lines.slice(0, opts.multipv ?? 1);
    } finally {
      this.inFlight -= 1;
    }
  }
}
