import { blank, type Bitmap } from '../raduga/pbm.ts';
import { isDark, labelsFromPlacement } from '../raduga/classify.ts';

export interface DrawnBoard {
  x: number;
  y: number;
  size: number;
  placement: string;
  side?: 'w' | 'b' | null;
  /** Толщина рамки, по умолчанию 6. */
  frame?: number;
  /** Не рисовать нижнюю сторону рамки. */
  openBottom?: boolean;
}

const FRAME = 6;
/** Фигуры - прямоугольники разных пропорций: белые контуром с белой серединой, чёрные залитые. */
const SHAPE: Record<string, [number, number]> = {
  k: [0.8, 0.8],
  q: [0.8, 0.5],
  r: [0.5, 0.8],
  b: [0.3, 0.8],
  n: [0.8, 0.3],
  p: [0.4, 0.4],
};

function fill(bmp: Bitmap, x0: number, y0: number, w: number, h: number, v: 0 | 1): void {
  for (let y = Math.max(0, y0); y < Math.min(bmp.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(bmp.width, x0 + w); x++) bmp.data[y * bmp.width + x] = v;
  }
}

function drawTriangle(bmp: Bitmap, x: number, y: number, size: number, filled: boolean): void {
  const cx = x + Math.round(size / 2);
  for (let t = 0; t < size; t++) {
    const half = Math.round(t / 2);
    for (let dx = -half; dx <= half; dx++) {
      const edge = Math.abs(dx) >= half - 2 || t >= size - 3;
      if (filled || edge) bmp.data[(y + t) * bmp.width + cx + dx] = 1;
    }
  }
}

function drawBoard(bmp: Bitmap, b: DrawnBoard): void {
  const F = b.frame ?? FRAME;
  fill(bmp, b.x, b.y, b.size, F, 1);
  if (!b.openBottom) fill(bmp, b.x, b.y + b.size - F, b.size, F, 1);
  fill(bmp, b.x, b.y, F, b.size, 1);
  fill(bmp, b.x + b.size - F, b.y, F, b.size, 1);
  const c = (b.size - 2 * F) / 8;
  const labels = labelsFromPlacement(b.placement);
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const x0 = Math.round(b.x + F + file * c);
      const y0 = Math.round(b.y + F + row * c);
      const s = Math.round(c);
      if (isDark(file, row)) {
        for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if ((x + y) % 6 === 0) bmp.data[y * bmp.width + x] = 1;
      }
      const label = labels[row * 8 + file];
      if (label === '.') continue;
      const [fw, fh] = SHAPE[label.toLowerCase()];
      const w = Math.round(s * fw);
      const h = Math.round(s * fh);
      const px = x0 + Math.round((s - w) / 2);
      const py = y0 + Math.round((s - h) / 2);
      fill(bmp, px, py, w, h, 1);
      if (label !== label.toLowerCase()) fill(bmp, px + 4, py + 4, w - 8, h - 8, 0);
    }
  }
  if (b.side) {
    drawTriangle(bmp, b.x + b.size + Math.round(0.08 * b.size), b.y + b.size - Math.round(0.14 * b.size), Math.round(0.11 * b.size), b.side === 'b');
  }
}

/**
 * Страница: заголовок - «текст» заданной ширины и под ним постоянная линия-украшение во всю ширину, как в книге
 * (линия задаёт рамку заголовка, а доля «текста» в ней зависит от ширины), и доски с треугольниками хода.
 */
export function drawPage(width: number, height: number, boards: DrawnBoard[], headerWidth?: number): Bitmap {
  const bmp = blank(width, height);
  if (headerWidth) {
    fill(bmp, 100, 40, headerWidth, 60, 1);
    fill(bmp, 100, 130, width - 200, 8, 1);
  }
  for (const b of boards) drawBoard(bmp, b);
  return bmp;
}
