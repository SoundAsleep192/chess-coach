import { execFileSync } from 'node:child_process';
import { Chess } from 'chess.js';
import type { PuzzleDoc } from '@board/shared';
import { parseBookLine, placementToFen, sanLineToUci, uciMove, validatePosition } from '../chess-utils.ts';
import { requireTool } from '../config.ts';
import { DEFAULT_SOLVE, resolveSolution, type Engine, type SolveOptions } from '../engine/solution.ts';
import type { ImportReport } from '../report.ts';
import type { PuzzleStore } from '../store.ts';
import { findDiagrams, parseBBox, type Diagram } from './bbox.ts';
import { POLGAR_TOTAL, polgarChapter, type PolgarChapter } from './chapters.ts';
import { rowsToPlacement } from './glyphs.ts';
import { parseSolutions } from './solutions.ts';

export const POLGAR_PAGES = { diagrams: [16, 971], solutions: [972, 1178] } as const;

export interface PolgarInput {
  bboxHtml: string;
  /** Номер страницы PDF, с которой начинается bboxHtml. */
  firstPage: number;
  solutionsText: string;
}

export function readPolgar(pdf: string): PolgarInput {
  const pdftotext = requireTool('pdftotext');
  const run = (args: string[]) => execFileSync(pdftotext, [...args, pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const [d0, d1] = POLGAR_PAGES.diagrams;
  const [s0, s1] = POLGAR_PAGES.solutions;
  return {
    bboxHtml: run(['-bbox', '-f', String(d0), '-l', String(d1)]),
    firstPage: d0,
    solutionsText: run(['-raw', '-f', String(s0), '-l', String(s1)]),
  };
}

export function polgarDiagrams(input: PolgarInput): Diagram[] {
  return parseBBox(input.bboxHtml).flatMap((words, i) => findDiagrams(words, input.firstPage + i));
}

const idOf = (n: number) => `polgar:${String(n).padStart(4, '0')}`;

/** Темы главы; у глав без тем (6.1) - mate и mateInN, если линия кончается матом. */
export function themesFor(chapter: PolgarChapter, fen: string, solution: string[]): string[] {
  const themes = [...(chapter.themes ?? [])];
  if (themes.length === 0) {
    const chess = new Chess(fen);
    for (const m of solution) chess.move(uciMove(m));
    if (chess.isCheckmate()) themes.push('mate', `mateIn${(solution.length + 1) / 2}`);
  }
  return themes;
}

export interface PolgarImportOptions {
  accepted: Set<string>;
  solve?: SolveOptions;
  /** Импорт части номеров (--from/--to): лишние задачи из базы тогда не удаляются. */
  only?: (n: number) => boolean;
  /** Сколько номеров должно найтись в книге (по умолчанию 5334). */
  total?: number;
  onProgress?: (done: number) => void;
}

export async function importPolgar(
  input: PolgarInput,
  engine: Engine,
  store: PuzzleStore,
  report: ImportReport,
  opts: PolgarImportOptions,
): Promise<void> {
  const solutions = parseSolutions(input.solutionsText);
  const seen = new Set<number>();
  const keep: string[] = [];
  const batch: PuzzleDoc[] = [];
  for (const d of polgarDiagrams(input)) {
    const id = idOf(d.number);
    if (d.number < 1 || d.number > POLGAR_TOTAL || seen.has(d.number)) {
      report.reject(id, 'recognition', `номер ${d.number} вне книги или повторяется (стр. ${d.page})`);
      continue;
    }
    seen.add(d.number);
    if (opts.only && !opts.only(d.number)) continue;
    report.total += 1;
    opts.onProgress?.(report.total);
    const chapter = polgarChapter(d.number);
    if (chapter.skip) {
      report.reject(id, 'skipped_chapter', `${chapter.name}: ${chapter.skip}`, false);
      continue;
    }
    let placement: string;
    try {
      placement = rowsToPlacement(d.rows);
    } catch (e) {
      report.reject(id, 'illegal_position', `${(e as Error).message} (стр. ${d.page})`);
      continue;
    }
    const entry = solutions.get(d.number);
    const book = entry ? parseBookLine(entry) : null;
    const side = book?.side ?? chapter.side ?? null;
    if (!side) {
      report.reject(id, 'no_answer', `нет ответа, сторона хода неизвестна (стр. ${d.page})`);
      continue;
    }
    const fen = placementToFen(placement, side);
    const bad = validatePosition(fen);
    if (bad) {
      report.reject(id, 'illegal_position', `${bad}; FEN ${fen} (стр. ${d.page})`);
      continue;
    }
    let bookUci: string[] | null = null;
    if (book && book.moves.length > 0) {
      try {
        bookUci = sanLineToUci(fen, book.moves);
      } catch (e) {
        report.reject(id, 'answer_illegal', `${(e as Error).message}; ответ: ${entry}`);
        continue;
      }
    }
    const res = await resolveSolution(engine, fen, bookUci, opts.solve ?? DEFAULT_SOLVE);
    if (!res.ok) {
      report.reject(id, 'no_answer', res.detail);
      continue;
    }
    const disputed = res.disputed && !opts.accepted.has(id);
    if (disputed) report.note(id, 'disputed', res.detail ?? '');
    batch.push({
      _id: id,
      source: 'polgar',
      fen,
      solution: res.solution,
      themes: themesFor(chapter, fen, res.solution),
      themesRaw: [chapter.name],
      ref: `Полгар №${d.number}`,
      page: d.page,
      solutionFrom: res.from,
      ...(disputed ? { disputed: true } : {}),
    });
    keep.push(id);
    report.imported += 1;
    if (res.from === 'engine') report.fromEngine += 1;
    if (res.extended) report.extended += 1;
    if (batch.length >= 200) await store.upsert(batch.splice(0));
  }
  await store.upsert(batch);
  if (!opts.only) {
    for (let n = 1; n <= (opts.total ?? POLGAR_TOTAL); n++) {
      if (!seen.has(n)) report.reject(idOf(n), 'recognition', 'диаграмма не найдена в тексте PDF');
    }
    await store.removeStale('polgar', keep);
  }
}
