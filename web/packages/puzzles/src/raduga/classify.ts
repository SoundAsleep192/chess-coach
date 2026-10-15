import { readFileSync } from 'node:fs';
import type { Side } from '../chess-utils.ts';
import { cellRect, innerBoard } from './boards.ts';
import type { Bitmap, Rect } from './pbm.ts';

export const GRID = 16;
export type Label = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | '.';
export const LABELS: Label[] = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p', '.'];

export interface Template {
  label: Label;
  dark: boolean;
  grid: number[];
  samples: number;
}

export interface TemplateSet {
  grid: number;
  templates: Template[];
}

/** Диаграмма эталона, размеченная по картинке. slot - номер доски на странице в порядке чтения (0-3). */
export interface ReferenceDiagram {
  volume: number;
  page: number;
  slot: number;
  number: number;
  placement: string;
  side: Side;
}

export const isDark = (file: number, row: number) => (file + row) % 2 === 1;
export const squareName = (file: number, row: number) => `${'abcdefgh'[file]}${8 - row}`;

/**
 * Признак клетки: доли чёрного в сетке GRID x GRID. Окно каждой ячейки сетки шире её на половину ячейки с каждой
 * стороны (в пределах клетки): ячейка сетки уже периода штриховки тёмного поля, и без перекрытия признак пустого
 * тёмного поля зависит от того, где легла штриховка, - тогда пустое поле оказывается ближе к тонкой белой фигуре.
 */
export function cellFeature(bmp: Bitmap, r: Rect): number[] {
  const out = new Array<number>(GRID * GRID).fill(0);
  const padX = Math.round(r.w / GRID / 2);
  const padY = Math.round(r.h / GRID / 2);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.max(r.x, Math.floor(r.x + (gx * r.w) / GRID) - padX);
      const x1 = Math.min(r.x + r.w, Math.floor(r.x + ((gx + 1) * r.w) / GRID) + padX);
      const y0 = Math.max(r.y, Math.floor(r.y + (gy * r.h) / GRID) - padY);
      const y1 = Math.min(r.y + r.h, Math.floor(r.y + ((gy + 1) * r.h) / GRID) + padY);
      let black = 0;
      let all = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          all += 1;
          black += bmp.data[y * bmp.width + x];
        }
      }
      out[gy * GRID + gx] = all ? black / all : 0;
    }
  }
  return out;
}

export function boardFeatures(bmp: Bitmap, board: Rect): { file: number; row: number; dark: boolean; feature: number[] }[] {
  const inner = innerBoard(bmp, board);
  const out = [];
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      out.push({ file, row, dark: isDark(file, row), feature: cellFeature(bmp, cellRect(inner, file, row)) });
    }
  }
  return out;
}

export function labelsFromPlacement(placement: string): Label[] {
  const out: Label[] = [];
  for (const rank of placement.split('/')) {
    for (const ch of rank) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push('.');
      else out.push(ch as Label);
    }
  }
  if (out.length !== 64) throw new Error(`bad placement ${placement}`);
  return out;
}

export function placementFromLabels(labels: Label[]): string {
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const l = labels[r * 8 + f];
      if (l === '.') {
        empty += 1;
      } else {
        if (empty) s += String(empty);
        empty = 0;
        s += l;
      }
    }
    ranks.push(s + (empty ? String(empty) : ''));
  }
  return ranks.join('/');
}

/**
 * Образцы - каждая размеченная клетка отдельно (samples = 1), клетка относится к классу ближайшего образца.
 * Не среднее по классу: тома напечатаны с разной плотностью краски, и среднее двух начертаний одной фигуры
 * оказывалось ближе к чужому классу (белый слон на тёмном поле читался как пустое поле, чёрная ладья - как пешка).
 */
export function buildTemplates(samples: { label: Label; dark: boolean; feature: number[] }[]): TemplateSet {
  return {
    grid: GRID,
    templates: samples.map((s) => ({ label: s.label, dark: s.dark, grid: s.feature.map((v) => Math.round(v * 1e4) / 1e4), samples: 1 })),
  };
}

/** Каких из 26 классов (12 фигур и пустое поле на светлом и тёмном) нет в образцах. */
export function missingClasses(set: TemplateSet): string[] {
  const have = new Set(set.templates.map((t) => `${t.label}|${t.dark}`));
  return LABELS.flatMap((l) =>
    [false, true].filter((d) => !have.has(`${l}|${d}`)).map((d) => `${l} на ${d ? 'тёмном' : 'светлом'}`),
  );
}

export function classifyCell(feature: number[], dark: boolean, set: TemplateSet): { label: Label; distance: number; margin: number } {
  const scored = set.templates
    .filter((t) => t.dark === dark)
    .map((t) => ({ label: t.label, distance: t.grid.reduce((sum, v, i) => sum + (v - feature[i]) ** 2, 0) }))
    .sort((a, b) => a.distance - b.distance);
  if (scored.length === 0) throw new Error(`no templates for ${dark ? 'dark' : 'light'} squares`);
  const [best] = scored;
  // запас - до ближайшего образца другого класса: образцов одного класса много
  const other = scored.find((t) => t.label !== best.label);
  return { label: best.label, distance: best.distance, margin: (other?.distance ?? Infinity) - best.distance };
}

/** Расстановка доски и «слабые» клетки, где второй образец почти так же близок (для отчёта скана). */
export function classifyBoard(bmp: Bitmap, board: Rect, set: TemplateSet): { placement: string; weak: string[] } {
  const labels: Label[] = [];
  const weak: string[] = [];
  for (const c of boardFeatures(bmp, board)) {
    const r = classifyCell(c.feature, c.dark, set);
    labels.push(r.label);
    if (r.margin < 0.25 * r.distance + 0.5) weak.push(squareName(c.file, c.row));
  }
  return { placement: placementFromLabels(labels), weak };
}

/** Поля, где расстановки расходятся: «e4: P вместо .». */
export function diffPlacement(expected: string, actual: string): string[] {
  const a = labelsFromPlacement(expected);
  const b = labelsFromPlacement(actual);
  const out: string[] = [];
  a.forEach((l, i) => {
    if (l !== b[i]) out.push(`${squareName(i % 8, Math.floor(i / 8))}: ${b[i]} вместо ${l}`);
  });
  return out;
}

export function loadTemplates(path: string): TemplateSet {
  return JSON.parse(readFileSync(path, 'utf8')) as TemplateSet;
}
