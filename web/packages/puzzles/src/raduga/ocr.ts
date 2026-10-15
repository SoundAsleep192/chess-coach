import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blackBBox, crop, writePbm, type Bitmap, type Rect } from './pbm.ts';

/** Где над доской стоит номер задачи (выше букв вертикалей). */
export function numberRegion(board: Rect): Rect {
  return {
    x: board.x + Math.round(0.3 * board.w),
    y: board.y - Math.round(0.3 * board.w),
    w: Math.round(0.4 * board.w),
    h: Math.round(0.2 * board.w),
  };
}

/** Номер над доской: tesseract (eng, одна строка, только цифры) по обрезке с полями 20 пикселей. Сбой tesseract - null. */
export function readNumber(bmp: Bitmap, board: Rect, tesseract: string, tmp: string): number | null {
  const box = blackBBox(bmp, numberRegion(board));
  if (!box) return null;
  const file = join(tmp, 'number.pbm');
  writeFileSync(file, writePbm(crop(bmp, { x: box.x - 20, y: box.y - 20, w: box.w + 40, h: box.h + 40 })));
  let out: string;
  try {
    out = execFileSync(tesseract, [file, 'stdout', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // сбой OCR на одной доске не должен ронять разбор тома: номер просто не прочитан
    return null;
  }
  const digits = out.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/**
 * Номера досок страницы идут подряд. База номера (номер - индекс) берётся по большинству прочитанных;
 * если согласия нет, по ожидаемому продолжению с прошлой страницы. ok - номер подтверждён OCR.
 */
export function fixNumbers(read: (number | null)[], expected: number | null): { numbers: number[]; ok: boolean; note?: string } {
  const votes = new Map<number, number>();
  read.forEach((n, i) => {
    if (n !== null) votes.set(n - i, (votes.get(n - i) ?? 0) + 1);
  });
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  let base: number | null = null;
  if (ranked.length > 0 && ranked[0][1] >= 2 && (ranked.length === 1 || ranked[1][1] < ranked[0][1])) base = ranked[0][0];
  else if (expected !== null && (ranked.length === 0 || votes.has(expected))) base = expected;
  else if (ranked.length === 1) base = ranked[0][0];
  if (base === null) return { numbers: [], ok: false, note: `номера не согласуются: ${read.join(', ')}` };
  const numbers = read.map((_, i) => base! + i);
  const confirmed = votes.get(base) ?? 0;
  const ok = confirmed >= 2 || (confirmed >= 1 && (base === expected || read.length === 1));
  const fixed = read.flatMap((n, i) => (n !== null && n !== numbers[i] ? [`${n}->${numbers[i]}`] : []));
  const note = fixed.length ? `исправлены номера ${fixed.join(', ')}` : confirmed === 0 ? 'номера не прочитаны, взяты по порядку' : undefined;
  return note ? { numbers, ok, note } : { numbers, ok };
}
