import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { AnalysisData, BoardState, NodeId } from '@board/shared';
import { BoardService } from '../board/board.service';
import { AnalysisService } from '../engine/analysis.service';
import { toPanelLine } from './panel-line';
import { panelOf } from './panel-settings';

export const PANEL_DELAY_MS = 300;
const LESSON_MULTIPV = 3;

/**
 * Анализ в занятии открыт после ответа тренера (разбор, пауза, конец) и когда помощник не подключён.
 * Пока ученик думает и пока тренер отвечает, анализа нет: линии выдали бы лучший ход.
 */
function lessonAnalysisOpen(s: BoardState): boolean {
  const l = s.lesson;
  return !!l && (l.phase === 'feedback' || l.phase === 'pause' || l.phase === 'done' || !l.online);
}

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
    // в занятии панель доски не смотрится вовсе: анализ открывает фаза занятия
    const lesson = s.mode === 'lesson';
    const open = lesson ? lessonAnalysisOpen(s) : p.eval || p.lines > 0;
    if (s.mode === 'puzzle' || !open) {
      clearTimeout(this.timer);
      this.wanted = null;
      this.last = null;
      return;
    }
    const node = s.nodes[s.cursor];
    const multipv = lesson ? LESSON_MULTIPV : Math.max(1, p.lines);
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
      const depth = lines[0]?.depth;
      this.emit({
        nodeId: w.nodeId,
        fen: w.fen,
        status: 'ready',
        lines: lines.map((l) => toPanelLine(w.fen, l)),
        ...(depth !== undefined ? { depth } : {}),
      });
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
