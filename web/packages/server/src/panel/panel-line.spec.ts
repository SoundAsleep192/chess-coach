import { describe, expect, it } from 'vitest';
import { toPanelLine } from './panel-line';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('toPanelLine', () => {
  it('numbers moves and keeps white-side eval when white moves', () => {
    expect(toPanelLine(START, { move: 'e2e4', cp: 30, pv: ['e2e4', 'e7e5', 'g1f3'] })).toEqual({ cp: 30, san: ['1.e4', 'e5', '2.Nf3'] });
  });
  it('flips eval and mate to white side when black moves, starts with N...', () => {
    expect(toPanelLine(AFTER_E4, { move: 'c7c5', cp: 40, pv: ['c7c5'] })).toEqual({ cp: -40, san: ['1...c5'] });
    expect(toPanelLine(AFTER_E4, { move: 'c7c5', mate: 3, pv: ['c7c5'] })).toEqual({ mate: -3, san: ['1...c5'] });
  });
  it('cuts to 8 plies and stops at an illegal move', () => {
    const pv = ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'c3b1'];
    expect(toPanelLine(START, { move: 'g1f3', cp: 0, pv }).san).toHaveLength(8);
    expect(toPanelLine(START, { move: 'g1f3', cp: 0, pv: ['g1f3', 'e2e5'] }).san).toEqual(['1.Nf3']);
  });
});
