import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { AnalysisData, BoardState, NodeId } from '@board/shared';
import { BoardService } from '../board/board.service';
import { AnalysisService } from '../engine/analysis.service';
import { toPanelLine } from './panel-line';
import { panelOf } from './panel-settings';

export const PANEL_DELAY_MS = 300;

/** Анализ позиции под курсором для панели: после паузы в движении курсора, одна заявка за раз. */
@Injectable()
export class PanelService implements OnModuleInit, OnApplicationShutdown {
  readonly analysis = new Subject<AnalysisData>();
  private last: AnalysisData | null = null;
  private wanted: { nodeId: NodeId; fen: string; multipv: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly board: BoardService,
    private readonly engine: AnalysisService,
  ) {}

  onModuleInit(): void {
    this.board.changes.subscribe((s) => this.onState(s));
    this.onState(this.board.current);
  }

  latest(): AnalysisData | null {
    return this.last;
  }

  private onState(s: BoardState): void {
    const p = panelOf(s);
    if (s.mode === 'puzzle' || (!p.eval && p.lines === 0)) {
      clearTimeout(this.timer);
      this.wanted = null;
      this.last = null;
      return;
    }
    const node = s.nodes[s.cursor];
    const multipv = Math.max(1, p.lines);
    const w = this.wanted;
    if (w && w.nodeId === node.id && w.fen === node.fen && w.multipv === multipv) return;
    this.wanted = { nodeId: node.id, fen: node.fen, multipv };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), PANEL_DELAY_MS);
  }

  private async run(): Promise<void> {
    const w = this.wanted;
    if (!w) return;
    this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'pending', lines: [] });
    try {
      const lines = await this.engine.analyse(w.fen, { multipv: w.multipv });
      if (this.wanted !== w) return; // курсор ушёл или панель выключили
      this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'ready', lines: lines.map((l) => toPanelLine(w.fen, l)) });
    } catch (e) {
      if (this.wanted !== w) return;
      console.error(`board: panel analysis failed: ${e instanceof Error ? e.message : String(e)}`);
      this.emit({ nodeId: w.nodeId, fen: w.fen, status: 'unavailable', lines: [] });
      this.wanted = null; // повторная заявка с теми же настройками должна запустить анализ заново
    }
  }

  private emit(a: AnalysisData): void {
    this.last = a;
    this.analysis.next(a);
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
    this.wanted = null;
  }
}
