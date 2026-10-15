import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../testing/fake-engine.ts';
import { useMongo } from '../testing/mongo.ts';
import { ImportReport } from '../report.ts';
import { PuzzleStore } from '../store.ts';
import { importPolgar } from './import.ts';
import { diagramWords, page } from './test-pages.ts';

const mongo = useMongo();
const MATE1 = '7k/8/6K1/8/8/8/8/R7';
const MATE1_FEN = `${MATE1} w - - 0 1`;

// №1 - мат в 1 с ответом книги, №2 - два белых короля, №3 - тот же мат в 1, но в «ответе» слабый ход 1.Rb1,
// №4470 - глава миниатюр, она не импортируется.
const input = {
  firstPage: 16,
  bboxHtml: `<doc>${page(diagramWords(1, 50, 80, MATE1), diagramWords(2, 300, 80, 'K6k/8/8/8/8/8/8/K7'))}${page(
    diagramWords(3, 50, 80, MATE1),
    diagramWords(4470, 300, 80, MATE1),
  )}</doc>`,
  solutionsText: '5334 Problems, Combinations & Games 8.1 Solutions\n1 1.Ra8m\n2 1.Ka2\n3 1.Rb1\n4470 1.e4 e5\n',
};

// После 1.Rb1 (позиция с ходом чёрных) решающий уже на +9, поэтому линия книги не продлевается.
const engine = () =>
  new FakeEngine()
    .on(MATE1_FEN, [{ move: 'a1a8', mate: 1 }])
    .on(MATE1_FEN, [{ move: 'a1a8', mate: 1 }], ['a1a8'])
    .on(MATE1_FEN, [{ move: 'a1b1', cp: 300 }], ['a1b1'])
    .on('7k/8/6K1/8/8/8/8/1R6 b - - 1 1', [{ move: 'h8g8', cp: -900 }]);

async function run(accepted = new Set<string>()) {
  const store = await PuzzleStore.open(mongo.url());
  const report = new ImportReport('polgar');
  try {
    await importPolgar(input, engine(), store, report, { accepted, total: 3 });
    return { report, docs: await store.puzzles.find().sort({ _id: 1 }).toArray() };
  } finally {
    await store.close();
  }
}

describe('importPolgar', () => {
  it('imports a mate in 1 from the book and reports the illegal and skipped diagrams', async () => {
    const { report, docs } = await run();
    expect(docs[0]).toEqual({
      _id: 'polgar:0001',
      source: 'polgar',
      fen: MATE1_FEN,
      solution: ['a1a8'],
      themes: ['mate', 'mateIn1'],
      themesRaw: ['Mate in 1'],
      ref: 'Полгар №1',
      page: 16,
      solutionFrom: 'book',
    });
    expect(report).toMatchObject({ total: 4, imported: 2 });
    expect(report.count('illegal_position')).toBe(1);
    expect(report.count('skipped_chapter')).toBe(1);
  });

  it('keeps a disputed puzzle out unless the coach accepted it', async () => {
    const first = await run();
    expect(first.docs.find((d) => d._id === 'polgar:0003')).toMatchObject({ disputed: true, solution: ['a1b1'] });
    expect(first.report.toMarkdown()).toContain('polgar:0003 - спорный ответ');
    const second = await run(new Set(['polgar:0003']));
    expect(second.docs.find((d) => d._id === 'polgar:0003')?.disputed).toBeUndefined();
  });
});
