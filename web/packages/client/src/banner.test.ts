import { describe, expect, it } from 'vitest';
import type { BoardState, PuzzleSession } from '@board/shared';
import { banner, canDrag } from './banner';
import { puzzleSession, StateBuilder } from './test-utils';

const FORK = 'q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1';

function withPuzzle(mode: BoardState['mode'], puzzle?: Partial<PuzzleSession>): BoardState {
  const b = new StateBuilder(FORK);
  const s = b.build(b.rootId, mode);
  if (puzzle) s.puzzle = puzzleSession(puzzle);
  return s;
}

describe('banner', () => {
  it('shows the puzzle, its result and the plain modes', () => {
    expect(banner(withPuzzle('puzzle', {}), true)).toEqual({ kind: 'puzzle', text: 'Задача: Дорофеева, т.1 №1, ход белых' });
    expect(banner(withPuzzle('puzzle', { side: 'black' }), true).text).toBe('Задача: Дорофеева, т.1 №1, ход чёрных');
    expect(banner(withPuzzle('free', { status: 'solved', found: ['d5c7'] }), true)).toEqual({ kind: 'solved', text: 'Решено: Дорофеева, т.1 №1' });
    expect(banner(withPuzzle('free', { status: 'failed', answer: '1.Nc7+ Kd7 2.Nxa8' }), true)).toEqual({
      kind: 'failed',
      text: 'Решение: 1.Nc7+ Kd7 2.Nxa8',
    });
    expect(banner(withPuzzle('free', { status: 'failed' }), true)).toEqual({ kind: 'failed', text: 'Не решено: Дорофеева, т.1 №1' });
    expect(banner(withPuzzle('frozen'), true)).toEqual({ kind: 'frozen', text: 'Заморожено тренером' });
    expect(banner(withPuzzle('puzzle', {}), false).kind).toBe('offline');
  });

  it('shows the check, the verdicts from the server and the second-solution offer', () => {
    const fb = (kind: 'correct' | 'wrong' | 'weaker' | 'repeat' | 'unavailable', text: string) => banner(withPuzzle('puzzle', { feedback: { kind, text } }), true);
    expect(banner(withPuzzle('puzzle', { phase: 'checking' }), true)).toEqual({ kind: 'checking', text: 'Проверяю ход…' });
    expect(fb('correct', 'Верно, продолжайте')).toEqual({ kind: 'correct', text: 'Верно, продолжайте' });
    expect(fb('wrong', 'После Nf6+ оценка −8.0 (хуже), было +9.0 (выигрыш).')).toEqual({
      kind: 'wrong',
      text: 'После Nf6+ оценка −8.0 (хуже), было +9.0 (выигрыш).',
    });
    expect(fb('weaker', 'Хороший ход, но есть сильнее.').kind).toBe('weaker');
    expect(fb('repeat', 'Это решение вы уже нашли')).toEqual({ kind: 'weaker', text: 'Это решение вы уже нашли' });
    expect(fb('unavailable', 'Не могу проверить ход: движок недоступен').kind).toBe('unavailable');
    const solved = { status: 'solved' as const, found: ['d5c7'], rootAlternatives: ['d5f6'] };
    expect(banner(withPuzzle('free', solved), true)).toEqual({ kind: 'solvedAlt', text: 'Решено! Есть ещё одно решение' });
    expect(banner(withPuzzle('free', { ...solved, bonus: true }), true).kind).toBe('solved');
    expect(banner(withPuzzle('puzzle', { bonus: true }), true).text).toBe('Задача: Дорофеева, т.1 №1, ход белых. Найдите другое решение');
  });
});

describe('canDrag', () => {
  it('lets the solver move only when the server waits for a move, and anyone move in free mode', () => {
    expect(canDrag(withPuzzle('free'), true)).toBe(true);
    expect(canDrag(withPuzzle('frozen'), true)).toBe(false);
    expect(canDrag(withPuzzle('puzzle', { phase: 'move' }), true)).toBe(true);
    expect(canDrag(withPuzzle('free', { status: 'failed' }), true)).toBe(true);
    expect(canDrag(withPuzzle('puzzle', { phase: 'move' }), false)).toBe(false);
  });

  it('blocks dragging while a move is checked, the reply is pending or a verdict waits for «Ещё раз»', () => {
    for (const phase of ['checking', 'reply', 'feedback'] as const) {
      expect(canDrag(withPuzzle('puzzle', { phase }), true)).toBe(false);
    }
  });
});
