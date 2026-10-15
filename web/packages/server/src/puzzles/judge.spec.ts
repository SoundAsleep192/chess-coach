import { describe, expect, it } from 'vitest';
import { compareMove, describeWeaker, describeWrong, formatEval, outcomeClass, terminalAfter } from './judge';

const FORK = 'q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1';
const KR = '7k/8/5K2/8/8/8/8/R7 w - - 0 1';

describe('outcomeClass', () => {
  it('splits win% at 75, 60 and 40 and treats a mate for the solver as its own class', () => {
    expect(outcomeClass({ mate: 3 })).toBe('mate');
    expect(outcomeClass({ cp: 300 })).toBe('winning');
    expect(outcomeClass({ cp: 290 })).toBe('advantage');
    expect(outcomeClass({ cp: 120 })).toBe('advantage');
    expect(outcomeClass({ cp: 110 })).toBe('equal');
    expect(outcomeClass({ cp: -110 })).toBe('equal');
    expect(outcomeClass({ cp: -120 })).toBe('worse');
    expect(outcomeClass({ mate: -2 })).toBe('worse');
  });
});

describe('compareMove', () => {
  it('compares mates by length', () => {
    expect(compareMove({ mate: 2 }, { mate: 2 })).toBe('equal');
    expect(compareMove({ mate: 2 }, { mate: 1 })).toBe('equal');
    expect(compareMove({ mate: 2 }, { mate: 3 })).toBe('weaker');
    expect(compareMove({ mate: 2 }, { cp: 900 })).toBe('wrong');
  });

  it('inside a class: within 5 points equal, further weaker, higher better; a lower class is wrong', () => {
    expect(compareMove({ cp: 900 }, { cp: 800 })).toBe('equal');
    expect(compareMove({ cp: 400 }, { cp: 350 })).toBe('equal');
    expect(compareMove({ cp: 400 }, { cp: 300 })).toBe('weaker');
    expect(compareMove({ cp: 900 }, { cp: 1000 })).toBe('better');
    expect(compareMove({ cp: 150 }, { mate: 4 })).toBe('better');
    expect(compareMove({ cp: 900 }, { cp: 0 })).toBe('wrong');
    expect(compareMove({ cp: 900 }, { cp: 290 })).toBe('wrong');
  });
});

describe('terminalAfter', () => {
  it('sees mate, stalemate and a threefold repetition from the root', () => {
    expect(terminalAfter(KR, ['f6g6', 'h8g8', 'a1a8'])).toBe('checkmate');
    expect(terminalAfter('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1', ['e7f7'])).toBe('draw');
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const knights = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    expect(terminalAfter(start, knights)).toBeNull();
    expect(terminalAfter(start, [...knights, ...knights])).toBe('draw');
    expect(terminalAfter(FORK, ['d5c7'])).toBeNull();
  });
});

describe('texts', () => {
  it('formats evaluations', () => {
    expect([{ cp: 120 }, { cp: -280 }, { cp: 0 }, { mate: 3 }, { mate: -2 }].map(formatEval)).toEqual([
      '+1.2',
      '−2.8',
      '0.0',
      '#3',
      '#−2',
    ]);
  });

  it('names a mate against the solver', () => {
    const out = describeWrong({ fen: FORK, played: 'd5f6', playedLine: { move: 'd5f6', mate: -2, pv: ['d5f6', 'e8e7'] }, expected: { cp: 900 } });
    expect(out).toEqual({ text: 'После Nf6+ вам мат в 2.', arrows: [{ from: 'e8', to: 'e7', color: 'red' }] });
  });

  it('says the mate was missed', () => {
    const out = describeWrong({ fen: KR, played: 'a1a7', playedLine: { move: 'a1a7', cp: 600, pv: ['a1a7'] }, expected: { mate: 2 } });
    expect(out).toEqual({ text: 'Мат упущен. После Ra7 оценка +6.0 (выигрыш).', arrows: [] });
  });

  it('names the lost material over four plies and marks a capture with a red arrow only', () => {
    const fen = 'r5k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const out = describeWrong({
      fen,
      played: 'd1d8',
      playedLine: { move: 'd1d8', cp: -500, pv: ['d1d8', 'a8d8', 'g1f1', 'd8d1'] },
      expected: { cp: 50 },
    });
    expect(out).toEqual({
      text: 'После Rd8+ вы теряете ладью. Оценка −5.0 (хуже), было +0.5 (равно).',
      arrows: [{ from: 'a8', to: 'd8', color: 'red' }],
    });
  });

  it('adds a blue arrow for the threat after a quiet refutation', () => {
    const out = describeWrong({
      fen: FORK,
      played: 'd5f6',
      playedLine: { move: 'd5f6', cp: -800, pv: ['d5f6', 'e8e7', 'f6g4', 'a8a1'] },
      expected: { cp: 900 },
    });
    expect(out).toEqual({
      text: 'После Nf6+ оценка −8.0 (хуже), было +9.0 (выигрыш).',
      arrows: [
        { from: 'e8', to: 'e7', color: 'red' },
        { from: 'a8', to: 'a1', color: 'blue' },
      ],
    });
  });

  it('describes a weaker move without naming the best one', () => {
    expect(describeWeaker({ mate: 2 }, { mate: 3 })).toBe('Хороший ход, но есть сильнее. Оценка #3, лучший ход даёт мат в 2.');
    expect(describeWeaker({ cp: 900 }, { cp: 400 })).toBe('Хороший ход, но есть сильнее. Оценка +4.0, лучший ход даёт +9.0.');
  });
});
