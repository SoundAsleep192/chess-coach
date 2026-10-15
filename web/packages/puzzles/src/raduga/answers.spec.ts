import { describe, expect, it } from 'vitest';
import { checkAnswers, checkReport } from './answers.ts';
import type { ScannedDiagram } from './scan.ts';

const FORK = 'q3k3/8/8/3N4/8/8/8/6K1';

const diagram = (number: number, side: 'w' | 'b' | null = 'w', placement = FORK): ScannedDiagram => ({
  volume: 1,
  page: 7,
  slot: number - 1,
  number,
  placement,
  side,
  fill: side === 'b' ? 0.56 : 0.18,
  weak: [],
  problems: [],
});

describe('checkAnswers', () => {
  it('accepts legal answers in Latin and Russian notation and lists every kind of mismatch', () => {
    const result = checkAnswers([diagram(1), diagram(2), diagram(3), diagram(4)], {
      '1-1-1': '1.Nc7+ Kd7 2.Nxa8',
      '1-1-2': '1.Кс7+ Крd7 2.К:а8',
      '1-1-3': '1...Kd7',
      '1-1-4': '1.Nf6+ Kf8 2.Nxa8',
      '1-1-9': '1.e4',
    });
    expect(result.ok).toBe(2);
    expect(result.issues.map((i) => [i.key, i.kind])).toEqual([
      ['1-1-3', 'side'],
      ['1-1-4', 'illegal'],
      ['1-1-9', 'no_diagram'],
    ]);
    const report = checkReport(result);
    expect(report).toContain('1-1-4');
    expect(report).toContain('move 3 (Nxa8)');
  });

  it('lists diagrams without an answer separately', () => {
    const result = checkAnswers([diagram(1), diagram(2)], { '1-1-1': '1.Nc7+ Kd7 2.Nxa8' });
    expect(result.issues).toEqual([{ key: '1-1-2', kind: 'no_answer', detail: 'стр. 7' }]);
  });
});
