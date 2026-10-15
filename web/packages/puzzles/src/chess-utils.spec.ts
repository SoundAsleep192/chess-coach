import { describe, expect, it } from 'vitest';
import {
  alternativeMates,
  normalizeSan,
  parseBookLine,
  placementToFen,
  sanLineToUci,
  validatePosition,
} from './chess-utils.ts';

const KR = '7k/8/5K2/8/8/8/8/R7 w - - 0 1'; // мат в 2: Kg6 Kg8 Ra8#

describe('normalizeSan', () => {
  it.each([
    ['1.QXh7m', 'Qxh7#'],
    ['fXg8N', 'fxg8N'],
    ['2...Ф:с4', 'Qxc4'],
    ['Кр:f4', 'Kxf4'],
    ['К:с3+', 'Nxc3+'],
    ['Лf8+', 'Rf8+'],
    ['Сd3#', 'Bd3#'],
    ['0-0-0', 'O-O-O'],
    ['Nf5!?', 'Nf5'],
  ])('%s -> %s', (raw, san) => {
    expect(normalizeSan(raw)).toBe(san);
  });
});

describe('parseBookLine', () => {
  it('keeps the main line: drops comments, variations, results and move numbers', () => {
    expect(parseBookLine('1...Qa5+ 2.KXb1 ( 2.NXa5 RXc3m ) 2...Rb8m')).toEqual({
      side: 'b',
      moves: ['Qa5+', 'Kxb1', 'Rb8#'],
    });
    expect(parseBookLine('1.Rf1 [threatening Rf8m] 1...Ne4 ( 1...Kc7\n2.Rf7 ) 2.Rf8m')).toEqual({
      side: 'w',
      moves: ['Rf1', 'Ne4', 'Rf8#'],
    });
    expect(parseBookLine('3.Re7 BXe2 4.Re8+ +–')).toEqual({ side: 'w', moves: ['Re7', 'Bxe2', 'Re8+'] });
    expect(parseBookLine('1...h5 2.Л:d4 (1.Лс6 Ке5+ 2.Крf1 К:с6+) 2...Кb3+ 3.Крh2 К:d4 0–1')).toEqual({
      side: 'b',
      moves: ['h5', 'Rxd4', 'Nb3+', 'Kh2', 'Nxd4'],
    });
  });
});

describe('sanLineToUci', () => {
  it('converts a book line to UCI and names the illegal move', () => {
    expect(sanLineToUci(KR, ['Kg6', 'Kg8', 'Ra8m'])).toEqual(['f6g6', 'h8g8', 'a1a8']);
    expect(() => sanLineToUci(KR, ['Kg6', 'Kh7'])).toThrow(/move 2 \(Kh7\)/);
  });
});

describe('placementToFen', () => {
  it('grants castling only with king and rook on their home squares', () => {
    expect(placementToFen('r3k2r/8/8/8/8/8/8/R3K2R', 'w')).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(placementToFen('4k3/8/8/8/8/8/8/R3K1R1', 'b')).toBe('4k3/8/8/8/8/8/8/R3K1R1 b Q - 0 1');
    expect(sanLineToUci(placementToFen('3k4/8/2P1P3/8/8/8/8/R3K3', 'w'), ['0-0-0+'])).toEqual(['e1c1']);
  });
});

describe('validatePosition', () => {
  it('rejects positions chess.js accepts but a book diagram cannot have', () => {
    expect(validatePosition(KR)).toBeNull();
    expect(validatePosition('R6k/8/8/8/8/8/8/6K1 w - - 0 1')).toMatch(/not their move/);
    expect(validatePosition('8/8/8/8/8/8/8/6K1 w - - 0 1')).toMatch(/king/);
    expect(validatePosition('7k/8/8/8/8/8/8/K6P w - - 0 1')).toMatch(/edge/);
    expect(validatePosition('R6k/8/6K1/8/8/8/8/8 b - - 0 1')).toMatch(/no legal moves/);
  });
});

describe('alternativeMates', () => {
  it('lists other mates on the last solver move', () => {
    expect(alternativeMates('7k/8/6K1/8/8/8/8/RR6 w - - 0 1', ['a1a8'])).toEqual(['b1b8']);
    expect(alternativeMates(KR, ['f6g6', 'h8g8', 'a1a8'])).toEqual([]);
  });
});
