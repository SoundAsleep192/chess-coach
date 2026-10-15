import { Injectable, OnModuleInit } from '@nestjs/common';
import { createEmptyCard, fsrs, type Card } from 'ts-fsrs';
import type { PuzzleDoc, PuzzleInfo, PuzzleNextBody, PuzzleNextResponse, PuzzleSource, PuzzleStats, StatsRow } from '@board/shared';
import { BoardError } from '../board/board-error';
import { BoardService } from '../board/board.service';
import type { PuzzleResult } from './puzzle-flow';
import { NoPuzzleError } from './no-puzzle.error';
import { fromCard, toCard } from './fsrs-card';
import { gradeFor, gradeName, puzzleLabel, sideOf, sourceOrder, SOURCES } from './puzzle-logic';
import { PuzzleRepository } from './puzzle-repository';

interface NextQuery {
  id?: string;
  themes: string[];
  source?: PuzzleSource;
  rating?: number;
}

@Injectable()
export class PuzzlesService implements OnModuleInit {
  private readonly scheduler = fsrs();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: PuzzleRepository,
    private readonly board: BoardService,
  ) {}

  onModuleInit(): void {
    this.board.puzzleFinished.subscribe((r) => {
      this.pending = this.pending
        .then(() => this.record(r))
        .catch((e: unknown) => console.error(`puzzles: cannot record ${r.puzzleId}: ${String(e)}`));
    });
  }

  /** Попытка в историю и пересчёт карточки FSRS. Неизвестная задача (удалена импортом) пропускается. */
  async record(r: PuzzleResult): Promise<void> {
    const puzzle = await this.repo.getPuzzle(r.puzzleId);
    if (!puzzle) return;
    const existing = await this.repo.getCard(r.puzzleId);
    const card: Card = existing ? toCard(existing) : createEmptyCard(r.at);
    const grade = gradeFor(r.correct, r.ms, r.weaker);
    const next = this.scheduler.next(card, r.at, grade).card;
    await this.repo.saveCard({
      _id: puzzle._id,
      source: puzzle.source,
      themes: puzzle.themes,
      ...(puzzle.ref ? { ref: puzzle.ref } : {}),
      ...fromCard(next),
      history: [
        ...(existing?.history ?? []),
        { at: r.at, correct: r.correct, ms: r.ms, grade: gradeName(grade), weaker: r.weaker, altBetter: r.altBetter },
      ],
    });
  }

  async next(body: PuzzleNextBody = {}, now: Date = new Date()): Promise<PuzzleNextResponse> {
    const q = this.parseNext(body);
    let kind: PuzzleInfo['kind'];
    let puzzle: PuzzleDoc | null;
    if (q.id) {
      kind = 'id';
      puzzle = await this.repo.getPuzzle(q.id);
      if (!puzzle) throw new NoPuzzleError(`puzzle ${q.id} not found`, []);
    } else {
      kind = 'due';
      puzzle = await this.repo.firstDue(now, q.themes, q.source);
      if (!puzzle) {
        kind = 'new';
        puzzle = await this.pickNew(q);
      }
      if (!puzzle) {
        const what = `${q.themes.length ? `themes ${q.themes.join(', ')}` : 'any theme'}${q.source ? ` in ${q.source}` : ''}`;
        throw new NoPuzzleError(`no puzzles for ${what}`, await this.repo.availableThemes(q.source));
      }
    }
    const label = puzzleLabel(puzzle, q.themes);
    const state = await this.board.startPuzzle({ puzzleId: puzzle._id, fen: puzzle.fen, solution: puzzle.solution, label });
    return {
      puzzle: {
        id: puzzle._id,
        source: puzzle.source,
        ref: puzzle.ref,
        page: puzzle.page,
        themes: puzzle.themes,
        rating: puzzle.rating,
        side: sideOf(puzzle.fen),
        kind,
        label,
      },
      state,
    };
  }

  async stats(since?: string): Promise<PuzzleStats> {
    if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new BoardError('bad_request', 'since must be YYYY-MM-DD');
    await this.pending;
    const from = since ? new Date(`${since}T00:00:00.000Z`) : null;
    const cards = await this.repo.allCards();
    const total = { attempts: 0, solved: 0 };
    const byTheme = new Map<string, StatsRow>();
    const bySource = new Map<string, StatsRow>();
    const bump = (rows: Map<string, StatsRow>, key: string, correct: boolean) => {
      const row = rows.get(key) ?? { key, attempts: 0, solved: 0 };
      row.attempts += 1;
      if (correct) row.solved += 1;
      rows.set(key, row);
    };
    const recent: PuzzleStats['recent'] = [];
    for (const c of cards) {
      for (const h of c.history) {
        if (from && h.at < from) continue;
        total.attempts += 1;
        if (h.correct) total.solved += 1;
        bump(bySource, c.source, h.correct);
        for (const t of c.themes) bump(byTheme, t, h.correct);
        recent.push({
          id: c._id,
          ref: c.ref,
          source: c.source,
          at: h.at.toISOString(),
          correct: h.correct,
          ms: h.ms,
          ...(h.weaker ? { weaker: h.weaker } : {}),
          ...(h.altBetter ? { altBetter: true } : {}),
        });
      }
    }
    const sorted = (rows: Map<string, StatsRow>) =>
      [...rows.values()].sort((a, b) => b.attempts - a.attempts || a.key.localeCompare(b.key));
    recent.sort((a, b) => b.at.localeCompare(a.at));
    const queue = [...cards]
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .slice(0, 10)
      .map((c) => ({ id: c._id, ref: c.ref, due: c.due.toISOString(), lastCorrect: c.history.at(-1)?.correct ?? false }));
    return {
      since: since ?? null,
      total,
      byTheme: sorted(byTheme),
      bySource: sorted(bySource),
      recent: recent.slice(0, 10),
      queue,
      counts: await this.repo.countsBySource(),
    };
  }

  private parseNext(body: PuzzleNextBody): NextQuery {
    const b = body ?? {};
    if (b.id !== undefined && typeof b.id !== 'string') throw new BoardError('bad_request', 'id must be a string');
    if (b.theme !== undefined && typeof b.theme !== 'string') throw new BoardError('bad_request', 'theme must be a string');
    if (b.themes !== undefined && (!Array.isArray(b.themes) || b.themes.some((t) => typeof t !== 'string'))) {
      throw new BoardError('bad_request', 'themes must be an array of strings');
    }
    if (b.source !== undefined && !SOURCES.includes(b.source)) {
      throw new BoardError('bad_request', `source must be one of ${SOURCES.join(', ')}`);
    }
    if (b.rating !== undefined && (typeof b.rating !== 'number' || !Number.isFinite(b.rating))) {
      throw new BoardError('bad_request', 'rating must be a number');
    }
    return { id: b.id, themes: b.theme ? [b.theme] : (b.themes ?? []), source: b.source, rating: b.rating };
  }

  private async pickNew(q: NextQuery): Promise<PuzzleDoc | null> {
    const exclude = await this.repo.attemptedIds();
    const order = q.source ? [q.source] : sourceOrder(await this.repo.attemptsBySource());
    for (const source of order) {
      const p =
        source === 'lichess'
          ? await this.repo.sampleNewLichess(q.themes, exclude, q.rating)
          : await this.repo.firstNewBook(source, q.themes, exclude);
      if (p) return p;
    }
    return null;
  }
}
