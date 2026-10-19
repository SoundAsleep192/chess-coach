import { useEffect, useState } from 'react';

/** Раскладка страницы занятия по «Правилам раскладки» дизайна (формулы из его layout()). */
export const BOARD_MIN = 280;
/** Минимальная высота панели тренера под доской. */
export const PANEL_MIN = 320;
export const COLUMN_MAX = 560;
/** Колонка шкалы оценки рядом с доской: есть всегда, даже пустая. */
export const BAR_W = 44;
export const INPUT_H = 44;
/** Высота развёрнутой полосы движка (заголовок и три линии) и зазоры колонки тренера. */
export const STRIP_FULL_H = 112;
export const COLUMN_GAPS = 16;
/** Сколько истории должно остаться под развёрнутой полосой. */
export const HISTORY_ROOM = 200;

export interface LessonLayout {
  /** stack - тренер под доской, columns - справа. */
  mode: 'stack' | 'columns';
  board: number;
  /** Ширина колонки тренера (в стопке - вся ширина без полей). */
  column: number;
  /** Высота колонки тренера. */
  panel: number;
  /** Три линии движка или одна строка. */
  fullStrip: boolean;
}

const fit = (n: number) => Math.max(BOARD_MIN, Math.floor(n / 8) * 8);

/**
 * Стопка: min(W - 68, H - 84 - P), 68 = поля 24 + шкала 44, 84 = поля 24 + строка состояния 36 + зазоры 24.
 * Колонки: min(H - 72, W - 420), 72 = поля 24 + строка 36 + зазор 12, 420 = поля 24 + шкала 44 + зазор 12 + колонка 340.
 * Берётся раскладка с доской крупнее.
 */
export function lessonLayout(w: number, h: number): LessonLayout {
  const stack = fit(Math.min(w - 68, h - 84 - PANEL_MIN));
  const columns = fit(Math.min(h - 72, w - 420));
  const result: Omit<LessonLayout, 'fullStrip'> =
    columns > stack
      ? { mode: 'columns', board: columns, column: Math.min(COLUMN_MAX, w - 80 - columns), panel: h - 72 }
      : { mode: 'stack', board: stack, column: w - 24, panel: Math.max(0, h - 84 - stack) };
  return { ...result, fullStrip: result.panel - STRIP_FULL_H - INPUT_H - COLUMN_GAPS >= HISTORY_ROOM };
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

/** Размер окна: ResizeObserver на корне документа, без него - событие resize. */
export function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    const update = () =>
      setSize((prev) => {
        const next = viewport();
        return next.w === prev.w && next.h === prev.h ? prev : next;
      });
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return size;
}
