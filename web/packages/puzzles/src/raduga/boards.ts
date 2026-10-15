import { components, type Bitmap, type Rect } from './pbm.ts';

export const REDUCE = 4;

/** Уменьшение в f раз: клетка чёрная, если в квадрате f x f есть хоть один чёрный пиксель. */
export function reduce(bmp: Bitmap, f: number): Bitmap {
  const width = Math.ceil(bmp.width / f);
  const height = Math.ceil(bmp.height / f);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < bmp.height; y++) {
    const row = y * bmp.width;
    const sy = Math.floor(y / f) * width;
    for (let x = 0; x < bmp.width; x++) if (bmp.data[row + x]) data[sy + Math.floor(x / f)] = 1;
  }
  return { width, height, data };
}

function columnBlack(bmp: Bitmap, x: number, y0: number, y1: number): number {
  let n = 0;
  if (x < 0 || x >= bmp.width) return 0;
  for (let y = Math.max(0, y0); y < Math.min(bmp.height, y1); y++) n += bmp.data[y * bmp.width + x];
  return n;
}

function rowBlack(bmp: Bitmap, y: number, x0: number, x1: number): number {
  let n = 0;
  if (y < 0 || y >= bmp.height) return 0;
  for (let x = Math.max(0, x0); x < Math.min(bmp.width, x1); x++) n += bmp.data[y * bmp.width + x];
  return n;
}

/** Строка (столбец) с наибольшим числом чёрных в окне и крайняя от края окна линия, где не меньше `share` от этого максимума. */
function outerLine(count: (i: number) => number, from: number, to: number, share: number): { index: number; max: number } {
  const dir = to >= from ? 1 : -1;
  let max = 0;
  for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) max = Math.max(max, count(i));
  if (max === 0) return { index: from, max };
  for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) if (count(i) >= share * max) return { index: i, max };
  return { index: from, max };
}

export interface BoardCandidate {
  rect: Rect;
  /** false - рамка не сошлась в квадрат с четырьмя сплошными сторонами: доску читать нельзя. */
  ok: boolean;
}

/**
 * Рамка по компоненте на уменьшенной картинке. Левая и правая стороны - самые плотные столбцы у краёв компоненты,
 * верхняя - первая плотная строка сверху (мусор или буквы, прилипшие к компоненте, рамку не сдвигают), нижняя должна
 * найтись на расстоянии стороны. Если сторона не нашлась или не хватает чёрного - ok=false, а не сдвинутая сетка.
 */
function locateFrame(bmp: Bitmap, c: Rect): BoardCandidate {
  const R = REDUCE;
  const y1 = c.y + c.h;
  const left = outerLine((x) => columnBlack(bmp, x, c.y, y1), c.x - R, c.x + Math.round(0.1 * c.w), 0.5).index;
  const right = outerLine((x) => columnBlack(bmp, x, c.y, y1), c.x + c.w + R, c.x + c.w - Math.round(0.1 * c.w), 0.5).index;
  const size = right - left + 1;
  const reject: BoardCandidate = { rect: { x: left, y: c.y, w: c.w, h: c.w }, ok: false };
  if (size < 0.9 * c.w || size > 1.05 * c.w + 2 * R) return reject;
  const top = outerLine((y) => rowBlack(bmp, y, left, right + 1), c.y - R, c.y + Math.max(0, c.h - size) + 2 * R, 0.6).index;
  const rect = { x: left, y: top, w: size, h: size };
  const bottom = Math.max(...[-2 * R, -R, 0, R, 2 * R].map((d) => rowBlack(bmp, top + size - 1 + d, left, right + 1)));
  const sides = Math.min(columnBlack(bmp, left + 1, top, top + size), columnBlack(bmp, right - 1, top, top + size));
  const topCount = rowBlack(bmp, top + 1, left, right + 1);
  const ok = bottom >= 0.25 * size && sides >= 0.25 * size && topCount >= 0.25 * size;
  return { rect, ok };
}

function sortReading<T extends { rect: Rect }>(items: T[]): T[] {
  return [...items].sort((a, b) => (Math.abs(a.rect.y - b.rect.y) < a.rect.w / 2 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
}

/**
 * Кандидаты в доски в порядке чтения: компоненты на картинке, уменьшенной в 4 раза, шириной от 20% страницы и почти
 * квадратные (снизу к доске может прилипнуть треугольник хода, поэтому высота до 1.25 ширины, а сверху буква вертикали
 * или пятно, поэтому от 0.9). Номер кандидата - номер доски на странице, отвергнутые тоже занимают место.
 */
export function findBoardCandidates(bmp: Bitmap): BoardCandidate[] {
  const found = components(reduce(bmp, REDUCE))
    .map((c) => ({ x: c.x * REDUCE, y: c.y * REDUCE, w: c.w * REDUCE, h: c.h * REDUCE }))
    .filter((r) => r.w >= bmp.width * 0.2 && r.h >= r.w * 0.9 && r.h <= r.w * 1.25)
    .map((r) => locateFrame(bmp, r));
  return sortReading(found);
}

/** Только доски с сошедшейся рамкой. */
export function findBoards(bmp: Bitmap): Rect[] {
  return findBoardCandidates(bmp)
    .filter((c) => c.ok)
    .map((c) => c.rect);
}

/**
 * Квадрат без рамки: толщина рамки - медиана чёрных серий от края по светлым полям (a8, a6, a4, a2 слева и a8, c8, e8, g8
 * сверху) на трёх уровнях внутри клетки. Серия ищется от края с запасом 2 пикселя наружу: рамка чуть наклонного скана
 * не там, где её нашла `findBoards`.
 */
export function innerBoard(bmp: Bitmap, board: Rect): Rect {
  const cell = board.w / 8;
  const cap = Math.max(2, Math.round(board.w * 0.05));
  const run = (x0: number, y0: number, dx: number, dy: number): number => {
    let x = x0 - 2 * dx;
    let y = y0 - 2 * dy;
    let skipped = 0;
    const at = (px: number, py: number) => (px >= 0 && py >= 0 && px < bmp.width && py < bmp.height ? bmp.data[py * bmp.width + px] : 0);
    while (skipped < 5 && !at(x, y)) {
      x += dx;
      y += dy;
      skipped++;
    }
    let n = 0;
    while (n < cap && at(x, y)) {
      n++;
      x += dx;
      y += dy;
    }
    return n;
  };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const offsets = [0.3, 0.5, 0.7];
  const left = median([0, 2, 4, 6].flatMap((r) => offsets.map((o) => run(board.x, Math.round(board.y + (r + o) * cell), 1, 0))));
  const top = median([0, 2, 4, 6].flatMap((f) => offsets.map((o) => run(Math.round(board.x + (f + o) * cell), board.y, 0, 1))));
  const t = Math.max(1, left, top);
  return { x: board.x + t, y: board.y + t, w: board.w - 2 * t, h: board.w - 2 * t };
}

/** Клетка (file 0 = a, row 0 = 8-я горизонталь) с отступом inset от краёв клетки. */
export function cellRect(inner: Rect, file: number, row: number, inset = 0.08): Rect {
  const c = inner.w / 8;
  const side = Math.round(c * (1 - 2 * inset));
  return { x: Math.round(inner.x + (file + inset) * c), y: Math.round(inner.y + (row + inset) * c), w: side, h: side };
}
