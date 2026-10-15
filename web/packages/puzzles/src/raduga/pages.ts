import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireTool } from '../config.ts';
import { readPbm, type Bitmap, type Rect } from './pbm.ts';

export function volumePdf(booksDir: string, volume: number): string {
  return join(booksDir, `shahmatn_raduga_takticheskih_priemov_${volume}.pdf`);
}

export function pageCount(pdf: string): number {
  const out = execFileSync(requireTool('pdfinfo'), [pdf], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const m = out.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error(`pdfinfo: no page count for ${pdf}`);
  return Number(m[1]);
}

/** Скан страницы 600 dpi: pdfimages пишет 1-битные картинки в PBM. Страница без такой картинки (обложка) - null. */
export function extractPage(pdf: string, page: number, tmp: string): Bitmap | null {
  const dir = mkdtempSync(join(tmp, 'page-'));
  try {
    try {
      execFileSync(requireTool('pdfimages'), ['-f', String(page), '-l', String(page), pdf, join(dir, 'img')], { stdio: 'ignore' });
    } catch {
      // pdfimages ругается на JPX-обложки, но PBM всё равно пишет
    }
    const pbms = readdirSync(dir).filter((f) => f.endsWith('.pbm')).map((f) => join(dir, f));
    if (pbms.length === 0) return null;
    const biggest = pbms.reduce((a, b) => (statSync(b).size > statSync(a).size ? b : a));
    return readPbm(readFileSync(biggest));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** PNG страницы или её части для разметки глазами. crop - прямоугольник в пикселях скана 600 dpi. */
export function renderPng(pdf: string, page: number, dpi: number, out: string, crop?: Rect): string {
  const args = ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile'];
  if (crop) {
    const k = dpi / 600;
    args.push('-x', String(Math.round(crop.x * k)), '-y', String(Math.round(crop.y * k)));
    args.push('-W', String(Math.round(crop.w * k)), '-H', String(Math.round(crop.h * k)));
  }
  execFileSync(requireTool('pdftoppm'), [...args, pdf, out.replace(/\.png$/, '')], { stdio: 'ignore' });
  return out;
}
