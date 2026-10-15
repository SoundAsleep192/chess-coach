import { Injectable } from '@nestjs/common';
import type { EngineLine } from '@board/shared';
import { AnalysisService } from '../engine/analysis.service';
import { compareMove, DRAW_SCORE } from './judge';
import type { CheckRequest, RootInfo, Verdict } from './puzzle-flow';

const MULTIPV = 3;

/** Всё, что задаче нужно от движка: вердикт по ходу, анализ корня, заранее посчитанные узлы. */
@Injectable()
export class PuzzleSolver {
  private readonly rootBudgetMs = Number(process.env.PUZZLE_ROOT_MS ?? 3000);

  constructor(private readonly analysis: AnalysisService) {}

  /** Лучшая линия узла из кэша, без запроса к движку. */
  cachedBest(fen: string): EngineLine | undefined {
    return this.cachedLines(fen)?.[0];
  }

  /** Все готовые линии узла из кэша. */
  cachedLines(fen: string): EngineLine[] | undefined {
    return this.analysis.cached(fen, { multipv: MULTIPV });
  }

  /** Посчитать узел заранее, пока ученик думает. Ошибка не важна: проверка хода спросит ещё раз. */
  prefetch(fen: string): void {
    this.analysis.analyse(fen, { multipv: MULTIPV }).catch(() => undefined);
  }

  async best(fen: string): Promise<EngineLine | undefined> {
    return (await this.analysis.analyse(fen, { multipv: MULTIPV }))[0];
  }

  /** Оценка хода ученика против ожидаемого: из тройки лучших линий узла или отдельным запросом с searchmoves. */
  async verdict(req: CheckRequest): Promise<Verdict> {
    const lines = await this.analysis.analyse(req.fen, { multipv: MULTIPV });
    const expected = req.expected ? await this.lineFor(req.fen, lines, req.expected) : lines[0];
    const played =
      req.terminal === 'draw' ? { move: req.uci, ...DRAW_SCORE, pv: [req.uci] } : await this.lineFor(req.fen, lines, req.uci);
    if (!expected || !played) throw new Error(`no engine line for ${req.uci} in ${req.fen}`);
    return { verdict: compareMove(expected, played), expected, played };
  }

  /** Равноценные первые ходы и классификация; не дольше PUZZLE_ROOT_MS, при ошибке - пусто. */
  async rootInfo(fen: string, first: string): Promise<RootInfo> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RootInfo>((resolve) => {
      timer = setTimeout(() => resolve({ rootAlternatives: [] }), this.rootBudgetMs);
    });
    try {
      return await Promise.race([this.classify(fen, first).catch(() => ({ rootAlternatives: [] })), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async classify(fen: string, first: string): Promise<RootInfo> {
    const lines = await this.analysis.analyse(fen, { multipv: MULTIPV });
    const expected = await this.lineFor(fen, lines, first);
    if (!expected) return { rootAlternatives: [] };
    const others = lines.filter((l) => l.move !== first).map((l) => ({ move: l.move, verdict: compareMove(expected, l) }));
    const rootAlternatives = others.filter((o) => o.verdict === 'equal' || o.verdict === 'better').map((o) => o.move);
    const classification = rootAlternatives.length > 0 ? 'multiple' : others.some((o) => o.verdict === 'weaker') ? 'main+weaker' : 'single';
    return { rootAlternatives, classification };
  }

  private async lineFor(fen: string, lines: EngineLine[], move: string): Promise<EngineLine | undefined> {
    return lines.find((l) => l.move === move) ?? (await this.analysis.analyse(fen, { searchmoves: [move] }))[0];
  }
}
