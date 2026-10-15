import { blackBBox, countBlack, type Bitmap, type Rect } from './pbm.ts';

export const SIG_W = 48;
export const SIG_H = 12;

/** Подпись заголовка: чёрное над первой доской (выше её номера), в рамке чёрных пикселей, сжатое до 48 x 12 долей. */
export function headerSignature(bmp: Bitmap, firstBoard: Rect): number[] | null {
  const box = blackBBox(bmp, { x: 0, y: 0, w: bmp.width, h: Math.max(0, firstBoard.y - Math.round(0.32 * firstBoard.w)) });
  if (!box) return null;
  const cw = Math.max(1, Math.floor(box.w / SIG_W));
  const ch = Math.max(1, Math.floor(box.h / SIG_H));
  const sig: number[] = [];
  for (let gy = 0; gy < SIG_H; gy++) {
    for (let gx = 0; gx < SIG_W; gx++) {
      const r = { x: box.x + Math.floor((gx * box.w) / SIG_W), y: box.y + Math.floor((gy * box.h) / SIG_H), w: cw, h: ch };
      sig.push(countBlack(bmp, r) / (cw * ch));
    }
  }
  return sig;
}

/** Доля клеток, где подписи расходятся больше чем на 0.25. */
export function signatureDistance(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.25) diff += 1;
  return diff / a.length;
}

/** Серии соседних страниц с одним заголовком. Страница без досок (sig null) серию прерывает. */
export function pageRuns(pages: { page: number; sig: number[] | null }[], threshold = 0.08): { from: number; to: number }[] {
  const runs: { from: number; to: number; sig: number[] }[] = [];
  for (const p of pages) {
    if (!p.sig) continue;
    const last = runs.at(-1);
    if (last && p.page === last.to + 1 && signatureDistance(last.sig, p.sig) < threshold) last.to = p.page;
    else runs.push({ from: p.page, to: p.page, sig: p.sig });
  }
  return runs.map(({ from, to }) => ({ from, to }));
}
