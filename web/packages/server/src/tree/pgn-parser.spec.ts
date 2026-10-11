import { describe, expect, it } from 'vitest';
import pgnParser from '@mliebelt/pgn-parser';

// Проверка выбранной библиотеки: вложенные варианты, комментарии с часами, заголовки chess.com.
describe('@mliebelt/pgn-parser', () => {
  it('keeps nested variations attached to the move they replace', () => {
    const game = pgnParser.parseGame('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 *');
    const sans = (line: { notation: { notation: string } }[]) => line.map((m) => m.notation.notation).join(' ');
    expect(sans(game.moves)).toBe('e4 e5 Nf3');
    const [c5line] = game.moves[1].variations;
    expect(sans(c5line)).toBe('c5 Nf3 d6');
    const [c3line] = c5line[1].variations;
    expect(sans(c3line)).toBe('c3 d5');
    expect(sans(c3line[1].variations[0])).toBe('Nf6');
  });

  it('reads clock comments and unknown chess.com headers without failing', () => {
    const game = pgnParser.parseGame(
      '[Event "Live Chess"]\n[ECOUrl "https://www.chess.com/openings/x"]\n[Link "https://www.chess.com/game/live/1"]\n\n' +
        '1. e4 { [%clk 0:09:59.6] } 1... c6 { [%clk 0:09:58.7] } *',
    );
    expect(game.moves.map((m) => m.notation.notation)).toEqual(['e4', 'c6']);
    expect(game.moves[0].commentDiag?.clk).toBe('0:09:59.6');
  });
});
