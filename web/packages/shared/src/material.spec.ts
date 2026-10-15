import { describe, expect, it } from 'vitest';
import { materialBalance, materialWord } from './material.ts';

describe('materialBalance', () => {
  it('counts white minus black from the FEN placement', () => {
    expect(materialBalance('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(0);
    expect(materialBalance('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1')).toBe(-6);
    expect(materialBalance('6k1/5ppp/8/8/8/8/5PPP/3r1K2 w - - 2 3')).toBe(-5);
  });
});

describe('materialWord', () => {
  it('names the loss in Russian with the right plural', () => {
    expect([1, 2, 3, 5, 9].map(materialWord)).toEqual(['пешку', 'две пешки', 'фигуру', 'ладью', 'ферзя']);
    expect([4, 6, 11, 12, 21, 22, 25].map(materialWord)).toEqual([
      '4 пешки',
      '6 пешек',
      '11 пешек',
      '12 пешек',
      '21 пешку',
      '22 пешки',
      '25 пешек',
    ]);
  });
});
