import { describe, expect, it } from 'vitest';
import { dropToMove, promotionUci } from './moves';

describe('dropToMove', () => {
  it('turns a normal drop into UCI and rejects illegal drops', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(dropToMove(start, 'g1', 'f3')).toEqual({ kind: 'move', uci: 'g1f3' });
    expect(dropToMove(start, 'e2', 'e5')).toEqual({ kind: 'illegal' });
  });

  it('treats a king move by two squares as castling', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(dropToMove(fen, 'e1', 'g1')).toEqual({ kind: 'move', uci: 'e1g1' });
    expect(dropToMove(fen, 'e1', 'c1')).toEqual({ kind: 'move', uci: 'e1c1' });
  });

  it('asks for a piece when a pawn reaches the last rank', () => {
    const fen = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    expect(dropToMove(fen, 'e7', 'e8')).toEqual({ kind: 'promotion', from: 'e7', to: 'e8' });
    expect(promotionUci('e7', 'e8', 'n')).toBe('e7e8n');
  });
});
