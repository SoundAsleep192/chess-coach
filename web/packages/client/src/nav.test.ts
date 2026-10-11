import { describe, expect, it } from 'vitest';
import { canStudentDelete, currentLine, moveNumber, navTarget } from './nav';
import { StateBuilder } from './test-utils';

function sample() {
  const b = new StateBuilder();
  const [e4, e5, nf3] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'game');
  const [c5, c3] = b.line(e4, ['c5', 'c3'], 'coach');
  const [d5] = b.line(e4, ['d5'], 'student');
  return { b, e4, e5, nf3, c5, c3, d5 };
}

describe('navTarget', () => {
  it('moves back and forward along the current line', () => {
    const { b, e4, e5, nf3, c5, c3 } = sample();
    expect(navTarget(b.build(e5), 'prev')).toBe(e4);
    expect(navTarget(b.build(e4), 'next')).toBe(e5);
    expect(navTarget(b.build(c5), 'end')).toBe(c3);
    expect(navTarget(b.build(c5), 'start')).toBe(b.rootId);
    expect(navTarget(b.build(nf3), 'next')).toBeNull();
    expect(navTarget(b.build(b.rootId), 'prev')).toBeNull();
  });

  it('switches between variations at a branch point with up and down', () => {
    const { b, e5, c5, d5 } = sample();
    expect(navTarget(b.build(e5), 'down')).toBe(c5);
    expect(navTarget(b.build(c5), 'down')).toBe(d5);
    expect(navTarget(b.build(d5), 'down')).toBeNull();
    expect(navTarget(b.build(c5), 'up')).toBe(e5);
    expect(navTarget(b.build(e5), 'up')).toBeNull();
  });
});

describe('helpers', () => {
  it('currentLine runs from the root through the node to the end of its line', () => {
    const { b, e4, c5, c3 } = sample();
    expect(currentLine(b.build(c5))).toEqual([b.rootId, e4, c5, c3]);
  });

  it('numbers white moves always and black moves only when forced', () => {
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 w - - 0 12', false)).toBe('12.');
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 b - - 0 12', false)).toBe('');
    expect(moveNumber('8/8/8/8/8/8/k7/4K3 b - - 0 12', true)).toBe('12...');
  });

  it('offers deletion only at the start of a branch that is entirely the student’s', () => {
    const { b, e4, d5 } = sample();
    expect(canStudentDelete(b.build(e4), d5)).toBe(true);
    expect(canStudentDelete(b.build(e4), e4)).toBe(false);
    b.line(d5, ['exd5'], 'coach');
    expect(canStudentDelete(b.build(e4), d5)).toBe(false);
  });
});
