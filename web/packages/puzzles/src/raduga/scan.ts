import type { Side } from '../chess-utils.ts';
import { findBoardCandidates, findBoards } from './boards.ts';
import { boardFeatures, buildTemplates, classifyBoard, labelsFromPlacement, type Label, type TemplateSet } from './classify.ts';
import { headerSignature, pageRuns } from './header.ts';
import { fixNumbers, readNumber } from './ocr.ts';
import { extractPage, pageCount, volumePdf } from './pages.ts';
import type { Bitmap, Rect } from './pbm.ts';
import { sideToMove } from './side.ts';

export interface ScannedDiagram {
  volume: number;
  page: number;
  slot: number;
  number: number | null;
  placement: string;
  side: Side | null;
  fill: number;
  weak: string[];
  /** Непустой список - диаграмма не идёт в базу, а попадает в отчёт как ошибка распознавания. */
  problems: string[];
}

export interface PageScan {
  boards: Rect[];
  /** Доски, чья рамка не сошлась (место в `boards` занято, расстановка пустая). */
  rejected: boolean[];
  placements: string[];
  weak: string[][];
  sides: { side: Side | null; fill: number }[];
  read: (number | null)[];
  sig: number[] | null;
}

const EMPTY = '8/8/8/8/8/8/8/8';

export function scanPage(bmp: Bitmap, set: TemplateSet, readNum: (board: Rect) => number | null): PageScan {
  const candidates = findBoardCandidates(bmp);
  const boards = candidates.map((c) => c.rect);
  const classified = candidates.map((c) => (c.ok ? classifyBoard(bmp, c.rect, set) : { placement: EMPTY, weak: [] }));
  return {
    boards,
    rejected: candidates.map((c) => !c.ok),
    placements: classified.map((c) => c.placement),
    weak: classified.map((c) => c.weak),
    sides: candidates.map((c) => (c.ok ? sideToMove(bmp, c.rect) : { side: null, fill: 0 })),
    read: candidates.map((c) => readNum(c.rect)),
    sig: boards.length > 0 ? headerSignature(bmp, boards[0]) : null,
  };
}

export interface VolumeScan {
  volume: number;
  diagrams: ScannedDiagram[];
  pages: { page: number; boards: number; sig: number[] | null }[];
}

export function scanVolume(
  pdf: string,
  volume: number,
  set: TemplateSet,
  tesseract: string,
  tmp: string,
  onPage?: (page: number) => void,
): VolumeScan {
  const diagrams: ScannedDiagram[] = [];
  const pages: VolumeScan['pages'] = [];
  let expected: number | null = 1;
  const total = pageCount(pdf);
  for (let page = 1; page <= total; page++) {
    onPage?.(page);
    const bmp = extractPage(pdf, page, tmp);
    if (!bmp) {
      pages.push({ page, boards: 0, sig: null });
      continue;
    }
    const scan = scanPage(bmp, set, (b) => readNumber(bmp, b, tesseract, tmp));
    pages.push({ page, boards: scan.boards.length, sig: scan.sig });
    if (scan.boards.length === 0) continue;
    const nums = fixNumbers(scan.read, expected);
    scan.boards.forEach((_, slot) => {
      const problems: string[] = [];
      if (!nums.ok) problems.push(`номер не подтверждён (${nums.note ?? scan.read.join(', ')})`);
      if (scan.rejected[slot]) problems.push('рамка доски не сошлась (сдвиг, наклон или помеха), доска не прочитана');
      else if (scan.sides[slot].side === null) problems.push('сторона хода не распознана');
      diagrams.push({
        volume,
        page,
        slot,
        number: nums.numbers[slot] ?? null,
        placement: scan.placements[slot],
        side: scan.sides[slot].side,
        fill: scan.sides[slot].fill,
        weak: scan.weak[slot],
        problems,
      });
    });
    if (nums.numbers.length > 0) expected = nums.numbers[nums.numbers.length - 1] + 1;
  }
  return { volume, diagrams, pages };
}

/** Образцы по размеченным страницам: { "<том>-<страница>": [расстановки досок в порядке чтения] }. */
export function templatesFromLabels(labels: Record<string, string[]>, booksDir: string, tmp: string): TemplateSet {
  const samples: { label: Label; dark: boolean; feature: number[] }[] = [];
  for (const [key, placements] of Object.entries(labels)) {
    const [volume, page] = key.split('-').map(Number);
    const bmp = extractPage(volumePdf(booksDir, volume), page, tmp);
    if (!bmp) throw new Error(`${key}: no page image`);
    const boards = findBoards(bmp);
    if (boards.length !== placements.length) {
      throw new Error(`${key}: ${boards.length} boards on the page, ${placements.length} labelled`);
    }
    boards.forEach((board, i) => {
      const labelsOfBoard = labelsFromPlacement(placements[i]);
      boardFeatures(bmp, board).forEach((c, j) => samples.push({ label: labelsOfBoard[j], dark: c.dark, feature: c.feature }));
    });
  }
  return buildTemplates(samples);
}

function ranges(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? String(nums[i]) : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return out.join(', ') || 'нет';
}

/** data/books/raduga-scan.md: по томам - диаграммы, серии заголовков, страницы без досок, проблемы, слабые клетки. */
export function scanSummary(scans: VolumeScan[]): string {
  const lines = ['# Распознавание «Радуги»', ''];
  for (const s of scans) {
    const numbers = s.diagrams.map((d) => d.number).filter((n): n is number => n !== null);
    const bad = s.diagrams.filter((d) => d.problems.length > 0);
    lines.push(`## Том ${s.volume}`, '');
    lines.push(
      `Страниц: ${s.pages.length}, с досками: ${s.pages.filter((p) => p.boards > 0).length}, диаграмм: ${s.diagrams.length}, ` +
        `с проблемами: ${bad.length}, номера: ${numbers.length ? `${Math.min(...numbers)}-${Math.max(...numbers)}` : 'нет'}.`,
    );
    lines.push(`Серии страниц с одним заголовком: ${pageRuns(s.pages).map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(', ')}.`);
    lines.push(`Страницы без досок: ${ranges(s.pages.filter((p) => p.boards === 0).map((p) => p.page))}.`, '');
    for (const d of bad) lines.push(`- стр. ${d.page} доска ${d.slot} (№${String(d.number)}): ${d.problems.join('; ')}`);
    const weak = s.diagrams.filter((d) => d.weak.length > 0);
    if (weak.length) {
      lines.push('', 'Слабые клетки (второй образец почти так же близок):', '');
      for (const d of weak) lines.push(`- №${String(d.number)} (стр. ${d.page}): ${d.weak.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
