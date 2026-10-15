import { Chess } from 'chess.js';
import type { PuzzleDoc } from '@board/shared';
import { uciMove } from './chess-utils.ts';
import { readLines } from './lines.ts';
import type { ImportReport } from './report.ts';
import type { PuzzleStore } from './store.ts';

export interface LichessRow {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
}

export const LICHESS_FILTER = { minPopularity: 90, minPlays: 1000, minRating: 800, maxRating: 2400 };

/** PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags. Заголовок и мусор - null. */
export function parseLichessLine(line: string): LichessRow | null {
  const cols = line.trim().split(',');
  if (cols.length < 8 || cols[0] === 'PuzzleId') return null;
  const [id, fen, moves, rating, , popularity, nbPlays, themes] = cols;
  const row: LichessRow = {
    id,
    fen,
    moves: moves.split(' ').filter(Boolean),
    rating: Number(rating),
    popularity: Number(popularity),
    nbPlays: Number(nbPlays),
    themes: themes.split(' ').filter(Boolean),
  };
  if (!id || !fen || row.moves.length < 2 || [row.rating, row.popularity, row.nbPlays].some(Number.isNaN)) return null;
  return row;
}

export function lichessFilter(row: LichessRow, f = LICHESS_FILTER): string | null {
  if (row.popularity < f.minPopularity) return `Popularity ${row.popularity} < ${f.minPopularity}`;
  if (row.nbPlays < f.minPlays) return `NbPlays ${row.nbPlays} < ${f.minPlays}`;
  if (row.rating < f.minRating || row.rating > f.maxRating) return `Rating ${row.rating} вне ${f.minRating}-${f.maxRating}`;
  return null;
}

/** Первый ход в Moves делает соперник: он применяется к FEN, в базе позиция с ходом решающего. */
export function lichessToDoc(row: LichessRow): PuzzleDoc {
  const chess = new Chess(row.fen);
  let fen = '';
  row.moves.forEach((m, i) => {
    try {
      chess.move(uciMove(m));
    } catch {
      throw new Error(`move ${i + 1} (${m}) is illegal in ${chess.fen()}`);
    }
    if (i === 0) fen = chess.fen();
  });
  return {
    _id: `lichess:${row.id}`,
    source: 'lichess',
    fen,
    solution: row.moves.slice(1),
    themes: row.themes,
    rating: row.rating,
    solutionFrom: 'lichess',
  };
}

export interface LichessImportOptions {
  limit?: number;
  batchSize?: number;
  onProgress?: (rows: number) => void;
}

export async function importLichess(
  path: string,
  store: PuzzleStore,
  report: ImportReport,
  opts: LichessImportOptions = {},
): Promise<void> {
  const batch: PuzzleDoc[] = [];
  for await (const line of readLines(path)) {
    if (line.trim() === '' || line.startsWith('PuzzleId,')) continue;
    if (opts.limit !== undefined && report.total >= opts.limit) break;
    report.total += 1;
    if (report.total % 100_000 === 0) opts.onProgress?.(report.total);
    const row = parseLichessLine(line);
    if (!row) {
      report.reject(`line ${report.total}`, 'filtered', 'строка CSV не разобрана');
      continue;
    }
    const why = lichessFilter(row);
    if (why) {
      report.reject(`lichess:${row.id}`, 'filtered', why, false);
      continue;
    }
    try {
      batch.push(lichessToDoc(row));
    } catch (e) {
      report.reject(`lichess:${row.id}`, 'illegal_position', (e as Error).message);
      continue;
    }
    report.imported += 1;
    if (batch.length >= (opts.batchSize ?? 1000)) await store.upsert(batch.splice(0));
  }
  await store.upsert(batch);
}
