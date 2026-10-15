import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { booksDataDir, loadConfig, requireTool } from '../config.ts';
import { diffPlacement, loadTemplates, type ReferenceDiagram } from './classify.ts';
import { readNumber, fixNumbers } from './ocr.ts';
import { extractPage, volumePdf } from './pages.ts';
import { scanPage } from './scan.ts';

const cfg = loadConfig();
const dir = booksDataDir(cfg);
const refPath = join(dir, 'raduga-reference.json');
const tplPath = join(dir, 'raduga-templates.json');
const ready = existsSync(cfg.booksDir) && existsSync(refPath) && existsSync(tplPath);

describe.skipIf(!ready)('«Радуга»: эталон из 12 диаграмм', () => {
  it('recognizes position, side to move and number of every reference diagram', () => {
    const refs = JSON.parse(readFileSync(refPath, 'utf8')) as ReferenceDiagram[];
    expect(refs).toHaveLength(12);
    const set = loadTemplates(tplPath);
    const tesseract = requireTool('tesseract');
    const tmp = mkdtempSync(join(tmpdir(), 'raduga-ref-'));
    const mismatches: string[] = [];
    for (const ref of refs) {
      const where = `т.${ref.volume} стр.${ref.page} доска ${ref.slot} (№${ref.number})`;
      const bmp = extractPage(volumePdf(cfg.booksDir, ref.volume), ref.page, tmp);
      if (!bmp) {
        mismatches.push(`${where}: нет картинки страницы`);
        continue;
      }
      const scan = scanPage(bmp, set, (b) => readNumber(bmp, b, tesseract, tmp));
      if (!scan.boards[ref.slot]) {
        mismatches.push(`${where}: доска не найдена (на странице ${scan.boards.length})`);
        continue;
      }
      const diff = diffPlacement(ref.placement, scan.placements[ref.slot]);
      if (diff.length) mismatches.push(`${where}: ${diff.join(', ')}`);
      if (scan.sides[ref.slot].side !== ref.side) {
        mismatches.push(`${where}: ход ${String(scan.sides[ref.slot].side)}, в эталоне ${ref.side} (заливка ${scan.sides[ref.slot].fill.toFixed(2)})`);
      }
      const number = fixNumbers(scan.read, null).numbers[ref.slot];
      if (number !== ref.number) mismatches.push(`${where}: номер ${String(number)} (прочитано ${scan.read.join(', ')})`);
    }
    rmSync(tmp, { recursive: true, force: true });
    expect(mismatches).toEqual([]);
  }, 600_000);
});
