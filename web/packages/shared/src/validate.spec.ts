import { describe, expect, it } from 'vitest';
import {
  validateAddLineBody,
  validateCursorBody,
  validateInboxAckBody,
  validateModeBody,
  validatePanelBody,
  validatePuzzleNextBody,
  validateReplaceBody,
} from './validate';

describe('validateReplaceBody', () => {
  it('accepts pgn, fen with moves, and all optional fields', () => {
    expect(validateReplaceBody({ pgn: '1. e4 *', cursorPly: 3, upto: 5, plyOffset: 0, orientation: 'black', title: 't', gameId: 'g' })).toBeNull();
    expect(validateReplaceBody({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['Kb1'] })).toBeNull();
    expect(validateReplaceBody({ moves: ['e4'] })).toBeNull();
  });
  it('rejects bad fields', () => {
    expect(validateReplaceBody(null)).toMatch(/object/);
    expect(validateReplaceBody({ pgn: '1. e4 *', fen: 'x' })).toMatch(/pgn or fen/);
    expect(validateReplaceBody({ pgn: 5 })).toMatch(/pgn/);
    expect(validateReplaceBody({ moves: 'e4' })).toMatch(/moves/);
    expect(validateReplaceBody({ moves: [1] })).toMatch(/moves/);
    expect(validateReplaceBody({ pgn: 'x', upto: 0 })).toMatch(/upto/);
    expect(validateReplaceBody({ pgn: 'x', cursorPly: 1.5 })).toMatch(/cursorPly/);
    expect(validateReplaceBody({ pgn: 'x', plyOffset: -1 })).toMatch(/plyOffset/);
    expect(validateReplaceBody({ pgn: 'x', orientation: 'up' })).toMatch(/orientation/);
    expect(validateReplaceBody({ pgn: 'x', title: 'a'.repeat(201) })).toMatch(/title/);
  });
});

describe('validateAddLineBody and validateCursorBody', () => {
  it('accepts ply numbers and node ids', () => {
    expect(validateAddLineBody({ at: 0, moves: ['e4'], caption: 'c' })).toBeNull();
    expect(validateAddLineBody({ at: 'n17', moves: ['e4'] })).toBeNull();
    expect(validateCursorBody({ at: 4, arrows: [{ from: 'e2', to: 'e4', color: 'green' }], caption: 'x' })).toBeNull();
  });
  it('rejects bad at, moves, arrows and captions', () => {
    expect(validateAddLineBody({ at: -1, moves: ['e4'] })).toMatch(/at/);
    expect(validateAddLineBody({ at: '', moves: ['e4'] })).toMatch(/at/);
    expect(validateAddLineBody({ at: 1, moves: [] })).toMatch(/moves/);
    expect(validateAddLineBody({ at: 1, moves: ['e4'], caption: 'a'.repeat(501) })).toMatch(/caption/);
    expect(validateCursorBody({ at: 1, arrows: 'e2e4' })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: [{ from: 'e9', to: 'e4', color: 'green' }] })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: [{ from: 'e2', to: 'e4', color: 'pink' }] })).toMatch(/arrows/);
    expect(validateCursorBody({ at: 1, arrows: Array(21).fill({ from: 'e2', to: 'e4', color: 'red' }) })).toMatch(/arrows/);
  });
});

describe('validateModeBody, validatePanelBody, validatePuzzleNextBody, validateInboxAckBody', () => {
  it('mode is frozen or free', () => {
    expect(validateModeBody({ mode: 'free' })).toBeNull();
    expect(validateModeBody({ mode: 'frozen' })).toBeNull();
    expect(validateModeBody({ mode: 'puzzle' })).toMatch(/mode/);
  });
  it('panel needs at least one valid field', () => {
    expect(validatePanelBody({ eval: true })).toBeNull();
    expect(validatePanelBody({ lines: 3 })).toBeNull();
    expect(validatePanelBody({ note: null })).toBeNull();
    expect(validatePanelBody({ note: 'план: f4-f5' })).toBeNull();
    expect(validatePanelBody({})).toMatch(/at least one/);
    expect(validatePanelBody({ eval: 'on' })).toMatch(/eval/);
    expect(validatePanelBody({ lines: 4 })).toMatch(/lines/);
    expect(validatePanelBody({ note: 'a'.repeat(2001) })).toMatch(/note/);
  });
  it('puzzle next fields', () => {
    expect(validatePuzzleNextBody({})).toBeNull();
    expect(validatePuzzleNextBody({ id: 'polgar:0001', theme: 'fork', themes: ['pin'], source: 'raduga', rating: 1500 })).toBeNull();
    expect(validatePuzzleNextBody({ source: 'chesscom' })).toMatch(/source/);
    expect(validatePuzzleNextBody({ themes: 'fork' })).toMatch(/themes/);
    expect(validatePuzzleNextBody({ rating: '1500' })).toMatch(/rating/);
  });
  it('inbox ack upto', () => {
    expect(validateInboxAckBody({ upto: 0 })).toBeNull();
    expect(validateInboxAckBody({ upto: -1 })).toMatch(/upto/);
    expect(validateInboxAckBody({})).toMatch(/upto/);
  });
});
