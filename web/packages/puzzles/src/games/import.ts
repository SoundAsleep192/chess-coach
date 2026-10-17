import type { PuzzleDoc } from '@board/shared';
import type { Engine } from '../engine/solution.ts';
import { mapLimit } from '../limit.ts';
import type { ImportReport } from '../report.ts';
import type { PuzzleStore } from '../store.ts';
import { judgeCandidate } from './judge.ts';
import { candidatesOf, positionKey, puzzleId, type Candidate, type ReviewFile } from './review.ts';

export interface GamesImportOptions {
  /** Импорт одной партии: устаревшие задачи удаляются только у неё. */
  game?: string;
  concurrency: number;
  onProgress?: (n: number) => void;
}

interface Passed {
  c: Candidate;
  fen: string;
  solution: string[];
  themes: string[];
}

/** Раньше - партия с меньшей датой; при равной дате (партии вживую) - с меньшим id, затем меньший полуход. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const earlier = (a: Candidate, b: Candidate): number => cmp(a.gameDate, b.gameDate) || cmp(a.gameId, b.gameId) || a.ply - b.ply;

/**
 * Ошибки из разборов -> задачи source 'games'. Одна позиция - одна задача. Id существующей задачи не меняется
 * никогда (иначе карточка FSRS потеряла бы задачу); у новой - id самой ранней партии. Коллекцию cards не трогает.
 */
export async function importGames(
  reviews: ReviewFile[],
  engine: Engine,
  store: PuzzleStore,
  report: ImportReport,
  opts: GamesImportOptions,
): Promise<{ imported: number }> {
  const candidates: Candidate[] = [];
  for (const review of reviews) {
    try {
      candidates.push(...candidatesOf(review));
    } catch (e) {
      report.reject(review.id, 'bad_review', (e as Error).message);
    }
  }
  report.total = candidates.length;

  let judged = 0;
  const results = await mapLimit(candidates, opts.concurrency, async (c) => {
    const res = await judgeCandidate(engine, c);
    judged += 1;
    opts.onProgress?.(judged);
    return res;
  });

  const passed: Passed[] = [];
  const untouched = new Set<string>();
  const untouchedKeys = new Set<string>();
  results.forEach((res, i) => {
    const c = candidates[i];
    if (res.ok) {
      passed.push({ c, fen: res.fen, solution: res.solution, themes: res.themes });
      return;
    }
    report.reject(`${c.gameId} · ${c.ply}`, res.reason, res.detail);
    if (res.reason === 'engine_error') {
      untouched.add(puzzleId(c.gameId, c.ply));
      untouchedKeys.add(positionKey(c.fen));
    }
  });

  const existing = await store.gamesPuzzles();
  const existingByKey = new Map<string, PuzzleDoc>();
  for (const d of existing) {
    const key = positionKey(d.fen);
    if (!existingByKey.has(key)) existingByKey.set(key, d);
  }

  const groups = new Map<string, Passed[]>();
  for (const p of passed) {
    const key = positionKey(p.fen);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const docs: PuzzleDoc[] = [];
  const keep = new Set<string>(untouched);
  for (const [key, members] of groups) {
    members.sort((a, b) => earlier(a.c, b.c));
    const old = existingByKey.get(key);
    const first = members[0];
    // тело задачи (позиция, решение, темы) - от кандидата, чей id остаётся; нет такого в прогоне - от самой ранней партии
    const body = (old && members.find((m) => puzzleId(m.c.gameId, m.c.ply) === old._id)) || first;
    // полный прогон видит все партии: дата только от кандидатов группы (может и уменьшиться); --game видит одну - держит максимум со старой
    const dates = [...members.map((m) => m.c.gameDate), ...(opts.game !== undefined && old?.gameDate ? [old.gameDate] : [])];
    const gameDate = dates.reduce((a, b) => (a > b ? a : b));
    const doc: PuzzleDoc = old
      ? { _id: old._id, source: 'games', fen: body.fen, solution: body.solution, themes: body.themes, solutionFrom: 'engine', ref: old.ref, gameId: old.gameId, ply: old.ply, played: old.played, gameDate }
      : { _id: puzzleId(first.c.gameId, first.c.ply), source: 'games', fen: body.fen, solution: body.solution, themes: body.themes, solutionFrom: 'engine', ref: first.c.ref, gameId: first.c.gameId, ply: first.c.ply, played: first.c.played, gameDate };
    docs.push(doc);
    keep.add(doc._id);
  }
  // существующая задача, чья позиция встретилась в прогоне (в том числе у кандидата с ошибкой движка), остаётся
  for (const key of untouchedKeys) {
    const old = existingByKey.get(key);
    if (old) keep.add(old._id);
  }

  report.remark(`склеено повторов позиции: ${passed.length - docs.length}`);
  await store.upsert(docs);
  await store.removeGames([...keep], opts.game);
  report.imported = docs.length;
  report.fromEngine = docs.length;
  return { imported: docs.length };
}
