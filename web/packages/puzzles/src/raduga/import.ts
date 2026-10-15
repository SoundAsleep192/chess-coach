import { EngineRequestError, EngineUnavailable, type PuzzleDoc } from '@board/shared';
import { parseBookLine, placementToFen, sanLineToUci, validatePosition } from '../chess-utils.ts';
import { DEFAULT_SOLVE, NOT_WINNING, resolveSoft, resolveSolution, type Engine, type SolveOptions, type SolveResult } from '../engine/solution.ts';
import { mapLimit } from '../limit.ts';
import type { ImportReport, Reason } from '../report.ts';
import type { PuzzleStore } from '../store.ts';
import { radugaThemes } from '../themes.ts';
import type { Answers } from './answers.ts';
import type { ScannedDiagram } from './scan.ts';

export interface ThemeRanges {
  [volume: string]: { from: number; to: number; title: string }[];
}

export function titleFor(ranges: ThemeRanges, volume: number, page: number): string | undefined {
  return ranges[String(volume)]?.find((r) => page >= r.from && page <= r.to)?.title;
}

/**
 * Часть тома для каждой диаграммы: в большинстве томов нумерация задач начинается заново с каждой главы.
 * Новая часть - там, где номер чистой диаграммы (без проблем распознавания) меньше номера предыдущей чистой
 * диаграммы того же тома. Диаграммы с проблемами (обычно примеры на теоретических страницах со своей нумерацией)
 * берут текущую часть и границ не создают. Повтор того же номера остаётся в части и отбрасывается как дубль.
 */
export function partsOf(diagrams: ScannedDiagram[]): number[] {
  const state = new Map<number, { part: number; last: number | null }>();
  return diagrams.map((d) => {
    const s = state.get(d.volume) ?? { part: 1, last: null };
    state.set(d.volume, s);
    if (d.problems.length === 0 && d.number !== null) {
      if (s.last !== null && d.number < s.last) s.part += 1;
      s.last = d.number;
    }
    return s.part;
  });
}

/** Ключ диаграммы "<том>-<часть>-<номер>": по нему ищется ответ в raduga-answers.json. */
export const diagramKey = (d: ScannedDiagram, part: number): string => `${d.volume}-${part}-${String(d.number)}`;

export interface RadugaImportOptions {
  accepted: Set<string>;
  solve?: SolveOptions;
  /** Сколько позиций считать одновременно: столько, сколько процессов в пуле сервиса движка. */
  concurrency?: number;
  onProgress?: (done: number) => void;
  /** Импортировать только эти диаграммы (части считаются по всему списку); устаревшие задачи тогда не удаляются. */
  only?: (d: ScannedDiagram) => boolean;
}

/** Диаграмма после проверок без движка: либо отказ для отчёта, либо всё, что нужно для решения. */
type Prepared =
  | { kind: 'rejected'; id: string; reason: Reason; detail: string }
  | { kind: 'job'; id: string; d: ScannedDiagram; part: number; fen: string; bookUci: string[] | null; title?: string };

function prepare(d: ScannedDiagram, part: number, answers: Answers, ranges: ThemeRanges, seen: Set<string>): Prepared {
  const id =
    d.number === null
      ? `raduga:${d.volume}-p${d.page}-${d.slot}`
      : `raduga:${d.volume}-${part}-${String(d.number).padStart(3, '0')}`;
  const reject = (reason: Reason, detail: string): Prepared => ({ kind: 'rejected', id, reason, detail });
  if (d.problems.length > 0 || d.number === null || d.side === null) {
    return reject('recognition', `${d.problems.join('; ') || 'нет номера или стороны хода'} (стр. ${d.page})`);
  }
  if (seen.has(id)) return reject('recognition', `номер ${d.number} повторяется (стр. ${d.page})`);
  seen.add(id);
  const answer = answers[diagramKey(d, part)];
  const book = answer ? parseBookLine(answer) : null;
  if (book?.side && book.side !== d.side) {
    return reject(
      'answer_illegal',
      `в ответе ход ${book.side === 'w' ? 'белых' : 'чёрных'}, треугольник - ход ${d.side === 'w' ? 'белых' : 'чёрных'} (стр. ${d.page})`,
    );
  }
  const fen = placementToFen(d.placement, d.side);
  const bad = validatePosition(fen);
  if (bad) return reject('illegal_position', `${bad}; FEN ${fen} (стр. ${d.page})`);
  let bookUci: string[] | null = null;
  if (book && book.moves.length > 0) {
    try {
      bookUci = sanLineToUci(fen, book.moves);
    } catch (e) {
      return reject('answer_illegal', `${(e as Error).message}; ответ: ${answer} (стр. ${d.page})`);
    }
  }
  return { kind: 'job', id, d, part, fen, bookUci, title: titleFor(ranges, d.volume, d.page) };
}

export async function importRaduga(
  diagrams: ScannedDiagram[],
  answers: Answers,
  ranges: ThemeRanges,
  engine: Engine,
  store: PuzzleStore,
  report: ImportReport,
  opts: RadugaImportOptions,
): Promise<void> {
  const keep: string[] = [];
  const seen = new Set<string>();
  const parts = partsOf(diagrams);
  // F16: ответы книги не переписаны - решения только от движка, сверки с книгой нет
  if (Object.keys(answers).length === 0) report.remark('Решения всех задач посчитаны движком, с ответами книги не сверялись.');
  const prepared = diagrams.flatMap((d, i) => (opts.only && !opts.only(d) ? [] : [prepare(d, parts[i], answers, ranges, seen)]));
  let solved = 0;
  let engineErrors = 0;
  // результаты по индексам диаграмм; отказы без движка готовы сразу
  const results: (SolveResult | null | undefined)[] = prepared.map((p) => (p.kind === 'job' ? undefined : null));
  const batch: PuzzleDoc[] = [];
  let next = 0;
  let writes: Promise<void> = Promise.resolve();
  // отчёт и запись идут строго в порядке диаграмм, по мере того как готов непрерывный префикс результатов:
  // порядок и id не зависят от порядка ответов движка, а сбой в конце прогона не теряет сделанное раньше
  const drain = (): Promise<void> => {
    while (next < prepared.length && results[next] !== undefined) {
      const p = prepared[next];
      const res = results[next];
      next += 1;
      report.total += 1;
      if (p.kind === 'rejected') {
        report.reject(p.id, p.reason, p.detail);
        continue;
      }
      const { d, part, id, title } = p;
      if (!res || !res.ok) {
        const detail = res && !res.ok ? res.detail : '';
        report.reject(id, detail === NOT_WINNING ? 'not_winning' : 'no_answer', detail === NOT_WINNING ? `стр. ${d.page}` : `${detail} (стр. ${d.page})`);
        continue;
      }
      const mapped = title ? radugaThemes(title) : { themes: [], known: false };
      if (!mapped.known) {
        report.note(id, 'unknown_theme', title ? `заголовка «${title}» нет в словаре` : `нет заголовка для т.${d.volume} стр.${d.page} в raduga-themes.json`);
      }
      const disputed = res.disputed && !opts.accepted.has(id);
      if (disputed) report.note(id, 'disputed', res.detail ?? '');
      batch.push({
        _id: id,
        source: 'raduga',
        fen: p.fen,
        solution: res.solution,
        themes: mapped.themes,
        ...(title ? { themesRaw: [title] } : {}),
        ref: `Дорофеева, т.${d.volume}, ч.${part} №${d.number}`,
        page: d.page,
        solutionFrom: res.from,
        ...(disputed ? { disputed: true } : {}),
      });
      keep.push(id);
      report.imported += 1;
      if (res.from === 'engine') report.fromEngine += 1;
      if (res.extended) report.extended += 1;
      if (batch.length >= 200) {
        const chunk = batch.splice(0);
        writes = writes.then(() => store.upsert(chunk));
      }
    }
    return writes;
  };
  await drain();
  // движок считает параллельно
  await mapLimit(prepared, opts.concurrency ?? 1, async (p, i): Promise<void> => {
    if (p.kind !== 'job') return;
    const solve = opts.solve ?? DEFAULT_SOLVE;
    let res: SolveResult;
    try {
      res = p.bookUci ? await resolveSolution(engine, p.fen, p.bookUci, solve) : await resolveSoft(engine, p.fen, solve);
    } catch (e) {
      // F10: сбой движка на одной позиции попадает в отчёт, остальные позиции считаются дальше
      if (!(e instanceof EngineUnavailable || e instanceof EngineRequestError)) throw e;
      engineErrors += 1;
      res = { ok: false, detail: `ошибка движка: ${(e as Error).message}` };
    }
    solved += 1;
    opts.onProgress?.(solved);
    results[i] = res;
    await drain();
  });
  await drain();
  await store.upsert(batch);
  if (engineErrors > 0) {
    report.remark(`Внимание: устаревшие задачи не удалены: были ошибки движка (${engineErrors}). Повтори импорт, когда движок будет доступен.`);
  } else if (!opts.only) {
    await store.removeStale('raduga', keep);
  }
}
