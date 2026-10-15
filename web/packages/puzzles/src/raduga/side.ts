import type { Side } from '../chess-utils.ts';
import { components, crop, type Bitmap, type Component, type Rect } from './pbm.ts';

/** Треугольник справа снизу от доски: залитый - ход чёрных, контурный - ход белых. Нет треугольника - null. */
export function sideToMove(bmp: Bitmap, board: Rect): { side: Side | null; fill: number } {
  const right = board.x + board.w;
  const bottom = board.y + board.w;
  const region = crop(bmp, {
    x: right + Math.round(0.03 * board.w),
    y: bottom - Math.round(0.25 * board.w),
    w: Math.round(0.27 * board.w),
    h: Math.round(0.37 * board.w),
  });
  const biggest = components(region).reduce<Component | null>(
    (best, c) => (!best || c.w * c.h > best.w * best.h ? c : best),
    null,
  );
  if (!biggest || biggest.w < 0.05 * board.w || biggest.h < 0.05 * board.w) return { side: null, fill: 0 };
  const fill = biggest.pixels / (biggest.w * biggest.h);
  return { side: fill > 0.35 ? 'b' : 'w', fill };
}
