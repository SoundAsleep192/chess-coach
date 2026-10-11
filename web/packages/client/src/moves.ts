import { Chess } from 'chess.js';

export type DropResult =
  | { kind: 'move'; uci: string }
  | { kind: 'promotion'; from: string; to: string }
  | { kind: 'illegal' };

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

/** Перевод перетаскивания в ход UCI. Рокировка - ход короля на две клетки (e1g1). */
export function dropToMove(fen: string, from: string, to: string): DropResult {
  const candidates = new Chess(fen)
    .moves({ verbose: true })
    .filter((m) => m.from === from && m.to === to);
  if (candidates.length === 0) return { kind: 'illegal' };
  if (candidates.some((m) => m.promotion)) return { kind: 'promotion', from, to };
  return { kind: 'move', uci: candidates[0].lan };
}

export function promotionUci(from: string, to: string, piece: PromotionPiece): string {
  return `${from}${to}${piece}`;
}
