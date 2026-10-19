import { describe, expect, it } from 'vitest';
import {
  validateAddLineBody,
  validateCursorBody,
  validateInboxAckBody,
  validateLessonReplyBody,
  validateLessonSay,
  validateLessonStartBody,
  validateLessonVerdictBody,
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

const SETUP = {
  fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
  orientation: 'white',
  label: 'Позиция 1',
  context: 'Контекст',
  task: 'Найди ход',
};
const START = { lessonId: 'l1', title: 'Занятие', total: 3, index: 0, position: SETUP };
const sentences = (n: number) => Array.from({ length: n }, () => 'Раз.').join(' ');

describe('validateLessonStartBody', () => {
  it('accepts a minimal body and a full one with intro, game, gameId and ply', () => {
    expect(validateLessonStartBody(START)).toBeNull();
    expect(
      validateLessonStartBody({
        ...START,
        index: 2,
        intro: 'Начнём.',
        position: { ...SETUP, gameId: 'g1', ply: 25, game: { white: 'a', black: 'b', moves: ['e4', 'e5'] } },
      }),
    ).toBeNull();
  });
  it('needs lessonId, title, total >= 1, 0 <= index < total, position.fen', () => {
    expect(validateLessonStartBody(null)).toMatch(/object/);
    expect(validateLessonStartBody({ ...START, lessonId: '' })).toMatch(/lessonId/);
    expect(validateLessonStartBody({ ...START, lessonId: undefined })).toMatch(/lessonId/);
    expect(validateLessonStartBody({ ...START, title: '' })).toMatch(/title/);
    expect(validateLessonStartBody({ ...START, total: 0 })).toMatch(/total/);
    expect(validateLessonStartBody({ ...START, total: 1.5 })).toMatch(/total/);
    expect(validateLessonStartBody({ ...START, index: -1 })).toMatch(/index/);
    expect(validateLessonStartBody({ ...START, index: 3 })).toMatch(/index/);
    expect(validateLessonStartBody({ ...START, position: undefined })).toMatch(/position/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, fen: '' } })).toMatch(/fen/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, fen: undefined } })).toMatch(/fen/);
  });
  it('checks the other position fields', () => {
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, orientation: 'up' } })).toMatch(/orientation/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, label: 5 } })).toMatch(/label/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, context: 'a'.repeat(501) } })).toMatch(/context/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, task: 'a'.repeat(501) } })).toMatch(/task/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, ply: 0 } })).toMatch(/ply/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, game: { white: 'a', black: 'b' } } })).toMatch(/game/);
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, game: { white: 'a', black: 'b', moves: [1] } } })).toMatch(/game/);
  });
  it('limits context and task by length only, intro by length and sentences', () => {
    const long = 'Раз. Два. Три. Четыре.';
    expect(validateLessonStartBody({ ...START, position: { ...SETUP, context: long, task: long } })).toBeNull();
    expect(validateLessonStartBody({ ...START, intro: sentences(3) })).toMatch(/intro.*sentences/);
    expect(validateLessonStartBody({ ...START, intro: 'a'.repeat(241) })).toMatch(/intro/);
  });
});

describe('validateLessonVerdictBody', () => {
  it('accepts every kind, with a cp or mate score from the white side or none', () => {
    for (const kind of ['correct', 'weaker', 'wrong', 'unavailable', 'info'])
      expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind } })).toBeNull();
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'wrong', score: { cp: -110 } } })).toBeNull();
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'wrong', score: { mate: -3 } } })).toBeNull();
  });
  it('rejects a bad body, kind, text-only verdict and score', () => {
    expect(validateLessonVerdictBody(null)).toMatch(/object/);
    expect(validateLessonVerdictBody({ inputId: 0, verdict: { kind: 'correct' } })).toMatch(/inputId/);
    expect(validateLessonVerdictBody({ inputId: 1 })).toMatch(/verdict/);
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'great' } })).toMatch(/kind/);
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'correct', score: 5 } })).toMatch(/score/);
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'correct', score: { cp: 1.5 } } })).toMatch(/score/);
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'correct', score: { mate: '3' } } })).toMatch(/score/);
    expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind: 'correct', score: {} } })).toMatch(/score/);
  });
  it('allows score only on correct, weaker and wrong', () => {
    for (const kind of ['correct', 'weaker', 'wrong'])
      expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind, score: { cp: 10 } } })).toBeNull();
    for (const kind of ['unavailable', 'info'])
      expect(validateLessonVerdictBody({ inputId: 1, verdict: { kind, score: { cp: 10 } } })).toMatch(/score.*kind/);
  });
});

describe('validateLessonReplyBody', () => {
  const reply = (action: unknown, extra: object = {}) => ({ inputId: 1, action, ...extra });
  it('reply body: valid play, line, end', () => {
    expect(validateLessonReplyBody(reply({ type: 'play', uci: 'e7e5' }, { say: 'Верно.', accept: true }))).toBeNull();
    expect(
      validateLessonReplyBody(
        reply(
          { type: 'line', from: 'n3', moves: ['Nf3', 'e7e5'], arrows: [{ from: 'e2', to: 'e4', color: 'green' }], then: 'feedback' },
          { verdict: { kind: 'wrong', score: { cp: -120 } }, note: 'заметка' },
        ),
      ),
    ).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'line', from: 'n3', moves: ['e4'], then: 'pause' }))).toBeNull();
    expect(
      validateLessonReplyBody(reply({ type: 'end', summary: 'Серия пройдена.', stats: { modelCalls: 4, fallbacks: 1 } })),
    ).toBeNull();
  });
  it('accepts the argument-free actions, arrows, feedback and position', () => {
    for (const type of ['none', 'ask', 'back', 'pause', 'feedback']) expect(validateLessonReplyBody(reply({ type }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'feedback', arrows: [{ from: 'a1', to: 'h8', color: 'red' }] }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'arrows', arrows: [{ from: 'a1', to: 'h8', color: 'blue' }] }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'position', index: 1, position: SETUP }))).toBeNull();
  });
  it('reply body: say of 241 chars is rejected', () => {
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: 'a'.repeat(240) }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: 'a'.repeat(241) }))).toMatch(/say/);
  });
  it('reply body: three sentences are rejected', () => {
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: 'Раз. Два.' }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: 'Раз. Два. Три.' }))).toMatch(/say.*sentences/);
    expect(validateLessonReplyBody(reply({ type: 'end', summary: 'Раз. Два. Три.', stats: { modelCalls: 0, fallbacks: 0 } }))).toMatch(
      /summary/,
    );
  });
  it('reply body: unknown action type, play without uci, line with empty moves, then outside feedback|pause', () => {
    expect(validateLessonReplyBody({ inputId: 1 })).toMatch(/action/);
    expect(validateLessonReplyBody(reply({ type: 'dance' }))).toMatch(/action/);
    expect(validateLessonReplyBody(reply('play'))).toMatch(/action/);
    expect(validateLessonReplyBody(reply({ type: 'play' }))).toMatch(/uci/);
    expect(validateLessonReplyBody(reply({ type: 'play', uci: 'e2' }))).toMatch(/uci/);
    expect(validateLessonReplyBody(reply({ type: 'line', from: 'n3', moves: [], then: 'pause' }))).toMatch(/moves/);
    expect(validateLessonReplyBody(reply({ type: 'line', from: 'n3', moves: [1], then: 'pause' }))).toMatch(/moves/);
    expect(validateLessonReplyBody(reply({ type: 'line', moves: ['e4'], then: 'pause' }))).toMatch(/from/);
    expect(validateLessonReplyBody(reply({ type: 'line', from: 'n3', moves: ['e4'], then: 'done' }))).toMatch(/then/);
    expect(validateLessonReplyBody(reply({ type: 'line', from: 'n3', moves: ['e4'] }))).toMatch(/then/);
    expect(validateLessonReplyBody(reply({ type: 'arrows' }))).toMatch(/arrows/);
    expect(validateLessonReplyBody(reply({ type: 'feedback', arrows: [{ from: 'z9', to: 'a1', color: 'red' }] }))).toMatch(/arrows/);
    expect(validateLessonReplyBody(reply({ type: 'position', index: -1, position: SETUP }))).toMatch(/index/);
    expect(validateLessonReplyBody(reply({ type: 'position', index: 1, position: { ...SETUP, fen: '' } }))).toMatch(/fen/);
    expect(validateLessonReplyBody(reply({ type: 'end', stats: { modelCalls: 0, fallbacks: 0 } }))).toMatch(/summary/);
    expect(validateLessonReplyBody(reply({ type: 'end', summary: 'ок', stats: { modelCalls: -1, fallbacks: 0 } }))).toMatch(/stats/);
  });
  it('reply body: inputId must be a positive integer', () => {
    expect(validateLessonReplyBody(null)).toMatch(/object/);
    expect(validateLessonReplyBody({ action: { type: 'none' } })).toMatch(/inputId/);
    expect(validateLessonReplyBody({ inputId: 0, action: { type: 'none' } })).toMatch(/inputId/);
    expect(validateLessonReplyBody({ inputId: -2, action: { type: 'none' } })).toMatch(/inputId/);
    expect(validateLessonReplyBody({ inputId: 1.5, action: { type: 'none' } })).toMatch(/inputId/);
    expect(validateLessonReplyBody({ inputId: '1', action: { type: 'none' } })).toMatch(/inputId/);
  });
  it('checks the optional fields', () => {
    expect(validateLessonReplyBody(reply({ type: 'none' }, { accept: 'yes' }))).toMatch(/accept/);
    expect(validateLessonReplyBody(reply({ type: 'none' }, { note: 5 }))).toMatch(/note/);
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: 5 }))).toMatch(/say/);
    expect(validateLessonReplyBody(reply({ type: 'none' }, { say: '' }))).toMatch(/say/);
    expect(validateLessonReplyBody(reply({ type: 'none' }))).toBeNull();
    expect(validateLessonReplyBody(reply({ type: 'none' }, { verdict: { kind: 'x' } }))).toMatch(/kind/);
  });
});

describe('validateLessonSay', () => {
  it('say: empty after trim and 501 chars are rejected', () => {
    expect(validateLessonSay({ text: '' })).toMatch(/text/);
    expect(validateLessonSay({ text: '   \n ' })).toMatch(/text/);
    expect(validateLessonSay({ text: 'a'.repeat(501) })).toMatch(/text/);
    expect(validateLessonSay({ text: 5 })).toMatch(/text/);
    expect(validateLessonSay(null)).toMatch(/object/);
  });
  it('counts the length after trimming', () => {
    expect(validateLessonSay({ text: 'a' })).toBeNull();
    expect(validateLessonSay({ text: `  ${'a'.repeat(500)}  ` })).toBeNull();
  });
});
