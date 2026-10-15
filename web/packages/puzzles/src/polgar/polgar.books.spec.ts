import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { rowsToPlacement } from './glyphs.ts';
import { polgarDiagrams, readPolgar } from './import.ts';
import { parseSolutions } from './solutions.ts';

const pdf = join(loadConfig().booksDir, 'polgar.pdf');

describe.skipIf(!existsSync(pdf))('Полгар, PDF ученика', () => {
  it('finds all 5334 diagrams with valid glyphs and an answer for each', () => {
    const input = readPolgar(pdf);
    const diagrams = polgarDiagrams(input);
    expect(diagrams).toHaveLength(5334);
    expect(new Set(diagrams.map((d) => d.number)).size).toBe(5334);
    const bad = diagrams.filter((d) => {
      try {
        rowsToPlacement(d.rows);
        return false;
      } catch {
        return true;
      }
    });
    expect(bad.map((d) => d.number)).toEqual([]);
    expect(parseSolutions(input.solutionsText).size).toBe(5334);
  }, 120_000);
});
