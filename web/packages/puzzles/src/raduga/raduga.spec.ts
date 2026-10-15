import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawPage } from '../testing/draw.ts';
import { findBoardCandidates, findBoards } from './boards.ts';
import { GRID, boardFeatures, buildTemplates, classifyBoard, classifyCell, labelsFromPlacement, missingClasses } from './classify.ts';
import { headerSignature, pageRuns, signatureDistance } from './header.ts';
import { fixNumbers, readNumber } from './ocr.ts';
import { blank, readPbm, writePbm, type Bitmap } from './pbm.ts';
import { sideToMove } from './side.ts';

// Все 12 фигур парами на соседних полях: каждая встречается на светлом и на тёмном поле.
const ALL = 'KKQQRRBB/NNPPkkqq/rrbbnnpp/8/8/8/8/8';
const GAME = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR';
const SPOTS = [
  { x: 120, y: 300 },
  { x: 900, y: 300 },
  { x: 120, y: 1300 },
  { x: 900, y: 1300 },
];

function samplesOf(bmp: Bitmap, board: { x: number; y: number; w: number; h: number }, placement: string) {
  const labels = labelsFromPlacement(placement);
  return boardFeatures(bmp, board).map((c, i) => ({ label: labels[i], dark: c.dark, feature: c.feature }));
}

describe('PBM', () => {
  it('round-trips a bitmap whose width is not a multiple of 8', () => {
    const bmp = { width: 13, height: 3, data: new Uint8Array(39) };
    bmp.data[0] = 1;
    bmp.data[12] = 1;
    bmp.data[20] = 1;
    expect(readPbm(writePbm(bmp))).toEqual(bmp);
  });

  it('rejects a truncated file instead of looping', () => {
    expect(() => readPbm(Buffer.from('P4\n13'))).toThrow();
    expect(() => readPbm(Buffer.from('P4\n# comment'))).toThrow();
    expect(() => readPbm(writePbm(blank(40, 40)).subarray(0, 30))).toThrow('truncated PBM');
  });
});

describe('readNumber', () => {
  it('returns null when tesseract fails', () => {
    const page = drawPage(1600, 2400, [{ ...SPOTS[0], size: 560, placement: GAME }]);
    for (let y = 300 - 120; y < 300 - 90; y++) for (let x = 120 + 250; x < 120 + 300; x++) page.data[y * page.width + x] = 1;
    const [board] = findBoards(page);
    const tmp = mkdtempSync(join(tmpdir(), 'raduga-spec-'));
    try {
      expect(readNumber(page, board, '/nonexistent/tesseract', tmp)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('findBoards', () => {
  it('finds four square frames in reading order', () => {
    const page = drawPage(1600, 2400, SPOTS.map((s) => ({ ...s, size: 560, placement: GAME, side: 'w' as const })));
    expect(findBoards(page)).toEqual(SPOTS.map((s) => ({ ...s, w: 560, h: 560 })));
  });
});

describe('classifyBoard', () => {
  it('recognizes a position with templates taken from another labelled board', () => {
    const page = drawPage(1600, 2400, [
      { ...SPOTS[0], size: 560, placement: ALL },
      { ...SPOTS[1], size: 560, placement: GAME },
    ]);
    const [a, b] = findBoards(page);
    const set = buildTemplates(samplesOf(page, a, ALL));
    expect(missingClasses(set)).toEqual([]);
    expect(classifyBoard(page, b, set).placement).toBe(GAME);
  });

  it('names the classes that the labelled pages do not cover', () => {
    const page = drawPage(1600, 2400, [{ ...SPOTS[0], size: 560, placement: GAME }]);
    const [a] = findBoards(page);
    expect(missingClasses(buildTemplates(samplesOf(page, a, GAME)))).toContain('Q на тёмном');
  });

  it('recognizes a piece printed in either of two styles even when their average is close to another class', () => {
    // Тома напечатаны с разной плотностью краски: среднее двух начертаний одной фигуры может оказаться ближе к чужому классу.
    const at = (cells: number[], v: number) => Array.from({ length: GRID * GRID }, (_, i) => (cells.includes(i) ? v : 0));
    const thin = at([0, 1, 2, 3], 1);
    const bold = at([4, 5, 6, 7], 1);
    const between = at([0, 1, 2, 3, 4, 5, 6, 7], 0.5).map((v, i) => (i < 4 ? v + 0.1 : v));
    const set = buildTemplates([
      { label: 'B', dark: true, feature: thin },
      { label: 'B', dark: true, feature: bold },
      { label: '.', dark: true, feature: between },
    ]);
    expect(classifyCell(thin, true, set).label).toBe('B');
    expect(classifyCell(bold, true, set).label).toBe('B');
    expect(classifyCell(between, true, set)).toMatchObject({ label: '.', distance: 0 });
  });

  it('gives an empty dark square the same feature wherever the hatching falls inside the cell', () => {
    // В книге фаза штриховки у каждой доски своя: без перекрытия окон пустое тёмное поле уходило к тонкой белой фигуре.
    const EMPTY = '8/8/8/8/8/8/8/8';
    for (const shift of [1, 2, 3, 4, 5]) {
      const page = drawPage(1600, 2400, [
        { ...SPOTS[0], size: 560, placement: EMPTY },
        { x: SPOTS[1].x + shift, y: SPOTS[1].y, size: 560, placement: EMPTY },
      ]);
      const [a, b] = findBoards(page).map((board) => boardFeatures(page, board).filter((c) => c.dark));
      const worst = Math.max(...a.map((c, i) => c.feature.reduce((sum, v, k) => sum + (v - b[i].feature[k]) ** 2, 0)));
      expect(worst, `shift ${shift}`).toBeLessThan(0.5);
    }
  });
});

describe('sideToMove', () => {
  it('reads a filled triangle as Black to move and an outline as White', () => {
    const page = drawPage(1600, 2400, [
      { ...SPOTS[0], size: 560, placement: GAME, side: 'w' },
      { ...SPOTS[1], size: 560, placement: GAME, side: 'b' },
      { ...SPOTS[2], size: 560, placement: GAME, side: null },
    ]);
    const boards = findBoards(page);
    expect(boards.map((b) => sideToMove(page, b).side)).toEqual(['w', 'b', null]);
  });
});

describe('fixNumbers', () => {
  it('trusts numbers confirmed twice and fills gaps from the sequence', () => {
    expect(fixNumbers([21, 22, 23, 24], 21)).toEqual({ numbers: [21, 22, 23, 24], ok: true });
    expect(fixNumbers([21, null, 28, 24], 21)).toEqual({
      numbers: [21, 22, 23, 24],
      ok: true,
      note: 'исправлены номера 28->23',
    });
    expect(fixNumbers([1, 2, 3, 4], 193)).toMatchObject({ numbers: [1, 2, 3, 4], ok: true });
    expect(fixNumbers([97], 97)).toMatchObject({ numbers: [97], ok: true });
  });

  it('does not trust a page where nothing agrees', () => {
    expect(fixNumbers([null, null, null, null], 5)).toMatchObject({ numbers: [5, 6, 7, 8], ok: false });
    expect(fixNumbers([40, 7, 13, 2], null)).toMatchObject({ numbers: [], ok: false });
  });
});

describe('header runs', () => {
  it('groups consecutive pages with the same header and breaks on pages without boards', () => {
    const board = { x: 120, y: 600, w: 560, h: 560 };
    const sig = (headerWidth: number) => headerSignature(drawPage(1600, 2400, [], headerWidth), board)!;
    const a = sig(600);
    const b = sig(1200);
    expect(signatureDistance(a, sig(600))).toBe(0);
    expect(signatureDistance(a, b)).toBeGreaterThan(0.08);
    expect(
      pageRuns([
        { page: 1, sig: a },
        { page: 2, sig: a },
        { page: 3, sig: a },
        { page: 4, sig: b },
        { page: 5, sig: b },
        { page: 6, sig: null },
        { page: 7, sig: b },
      ]),
    ).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 5 },
      { from: 7, to: 7 },
    ]);
  });
});

describe('board detection on imperfect scans', () => {
  const at = { x: 400, y: 600, size: 560 };
  const blob = (bmp: Bitmap, x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) bmp.data[j * bmp.width + i] = 1;
  };
  /** Сдвиг строк на целое число пикселей: наклон около 0.2 градуса, рамка идёт ступеньками по 1 пикселю. */
  const skew = (bmp: Bitmap, slope: number): Bitmap => {
    const out = blank(bmp.width, bmp.height);
    for (let y = 0; y < bmp.height; y++) {
      const dx = Math.round((y - at.y) * slope);
      for (let x = 0; x < bmp.width; x++) if (bmp.data[y * bmp.width + x] && x + dx >= 0 && x + dx < bmp.width) out.data[y * bmp.width + x + dx] = 1;
    }
    return out;
  };
  /** Шаблоны с чистой доски, расстановка - с испорченной. Результат: прочитано верно или отвергнуто, иное - провал. */
  const outcome = (bad: Bitmap): 'ok' | 'rejected' | string => {
    const clean = drawPage(1600, 2400, [{ x: 120, y: 300, size: 560, placement: ALL }]);
    const [a] = findBoards(clean);
    const set = buildTemplates(samplesOf(clean, a, ALL));
    const candidates = findBoardCandidates(bad);
    if (candidates.length !== 1) return `candidates: ${candidates.length}`;
    if (!candidates[0].ok) return 'rejected';
    const placement = classifyBoard(bad, candidates[0].rect, set).placement;
    return placement === GAME ? 'ok' : placement;
  };
  const page = (extra: Partial<{ frame: number; openBottom: boolean }> = {}) => drawPage(1600, 2400, [{ ...at, placement: GAME, side: 'w', ...extra }]);

  it('reads a clean page', () => {
    expect(outcome(page())).toBe('ok');
  });

  it('reads a thin frame of 2 pixels', () => {
    expect(outcome(page({ frame: 2 }))).toBe('ok');
  });

  it('is not moved by a speck next to the frame', () => {
    const bmp = page();
    blob(bmp, at.x + at.size + 2, at.y + 200, 24, 24);
    blob(bmp, at.x - 8, at.y + 100, 5, 5);
    expect(outcome(bmp)).toBe('ok');
  });

  it('is not moved by a file letter close to the frame', () => {
    const bmp = page();
    blob(bmp, at.x + 200, at.y - 38, 18, 36);
    blob(bmp, at.x + 330, at.y - 38, 18, 36);
    expect(outcome(bmp)).toBe('ok');
  });

  it('reads or rejects a board skewed by about 0.2 degrees, never shifts the grid', () => {
    for (const slope of [0.0035, -0.0035]) expect(['ok', 'rejected']).toContain(outcome(skew(page(), slope)));
    expect(outcome(skew(page({ frame: 2 }), 0.0035))).toMatch(/^(ok|rejected)$/);
  });

  it('rejects a frame with a missing side', () => {
    expect(outcome(page({ openBottom: true }))).toBe('rejected');
  });

  it('keeps the slot of a rejected board and marks it', () => {
    const bmp = drawPage(1600, 2400, [
      { x: 120, y: 300, size: 560, placement: GAME, side: 'w', openBottom: true },
      { x: 900, y: 300, size: 560, placement: GAME, side: 'w' },
    ]);
    expect(findBoardCandidates(bmp).map((c) => c.ok)).toEqual([false, true]);
    expect(findBoards(bmp)).toHaveLength(1);
  });
});
