import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReviewMove {
  ply: number;
  color: 'white' | 'black';
  san: string;
  uci: string;
  fen_before: string;
  class: 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
  missed_chance?: boolean;
}

export interface ReviewFile {
  id: string;
  meta: { color?: 'white' | 'black'; date?: string; opponent?: string };
  moves: ReviewMove[];
}

export interface Candidate {
  gameId: string;
  ply: number;
  fen: string;
  played: string;
  gameDate: string;
  ref: string;
}

const NO_DATE = '1970-01-01T00:00:00';

export function puzzleId(gameId: string, ply: number): string {
  return `games:${gameId}-${String(ply).padStart(3, '0')}`;
}

/** 'Партия с X, 21.09.2026, 18...'; без соперника и/или даты части опускаются. */
export function gameRef(opponent: string | undefined, date: string | undefined, ply: number): string {
  const parts = [opponent ? `Партия с ${opponent}` : 'Партия'];
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) parts.push(`${m[3]}.${m[2]}.${m[1]}`);
  parts.push(`${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'}`);
  return parts.join(', ');
}

export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function candidatesOf(review: ReviewFile): Candidate[] {
  const color = review.meta.color;
  if (!color) throw new Error(`review ${review.id}: no meta.color`);
  const realDate = review.meta.date;
  return review.moves
    .filter((m) => m.color === color && (m.class === 'mistake' || m.class === 'blunder' || m.missed_chance === true))
    .map((m) => ({
      gameId: review.id,
      ply: m.ply,
      fen: m.fen_before,
      played: m.uci,
      gameDate: realDate ?? NO_DATE,
      ref: gameRef(review.meta.opponent, realDate, m.ply),
    }));
}

export function readReviews(
  dir: string,
  only?: string,
): { reviews: ReviewFile[]; bad: { file: string; detail: string }[] } {
  const files = only
    ? [`${only}.json`]
    : readdirSync(dir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.notes.json'))
        .sort();
  const reviews: ReviewFile[] = [];
  const bad: { file: string; detail: string }[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ReviewFile;
      if (typeof data?.id !== 'string' || !Array.isArray(data.moves) || typeof data.meta !== 'object' || !data.meta) {
        throw new Error('not a review file');
      }
      reviews.push(data);
    } catch (e) {
      bad.push({ file, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return { reviews, bad };
}
