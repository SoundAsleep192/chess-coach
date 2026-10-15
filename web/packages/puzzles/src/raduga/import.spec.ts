import { EngineUnavailable } from '@board/shared';
import { describe, expect, it } from 'vitest';
import { fenAfter } from '../chess-utils.ts';
import { ImportReport } from '../report.ts';
import { PuzzleStore } from '../store.ts';
import { FakeEngine } from '../testing/fake-engine.ts';
import { useMongo } from '../testing/mongo.ts';
import { importRaduga, partsOf, titleFor } from './import.ts';
import type { ScannedDiagram } from './scan.ts';

const mongo = useMongo();
const FORK = 'q3k3/8/8/3N4/8/8/8/6K1';
const FORK_FEN = `${FORK} w - - 0 1`;
const RANGES = { '1': [{ from: 7, to: 30, title: 'Двойной удар' }] };

/** Вилка по движку: 1.Nc7+ Kd7 2.Nxa8 (после взятия ферзя партия кончена: конь против короля). */
const forkEngine = () =>
  new FakeEngine()
    .on(FORK_FEN, [{ move: 'd5c7', cp: 900 }, { move: 'd5f6', cp: 0 }])
    .on(FORK_FEN, [{ move: 'd5c7', cp: 900 }], ['d5c7'])
    .on(fenAfter(FORK_FEN, ['d5c7']), [{ move: 'e8d7', cp: -900 }])
    .on(fenAfter(FORK_FEN, ['d5c7', 'e8d7']), [{ move: 'c7a8', cp: 900 }]);

const diagram = (number: number, page: number, extra: Partial<ScannedDiagram> = {}): ScannedDiagram => ({
  volume: 1,
  page,
  slot: (number - 1) % 4,
  number,
  placement: FORK,
  side: 'w',
  fill: 0.18,
  weak: [],
  problems: [],
  ...extra,
});

describe('titleFor', () => {
  it('finds the header of a page by volume ranges', () => {
    expect(titleFor(RANGES, 1, 7)).toBe('Двойной удар');
    expect(titleFor(RANGES, 1, 31)).toBeUndefined();
    expect(titleFor(RANGES, 2, 7)).toBeUndefined();
  });
});

describe('partsOf', () => {
  it('starts a new part where the numbering restarts, ignoring diagrams with recognition problems', () => {
    const theory = { problems: ['номер не подтверждён'] };
    const diagrams = [
      diagram(1, 6, theory),
      diagram(1, 7),
      diagram(2, 7),
      diagram(3, 8),
      diagram(4, 9, theory),
      diagram(1, 10),
      diagram(1, 11),
      diagram(2, 11),
      diagram(1, 7, { volume: 2 }),
    ];
    expect(partsOf(diagrams)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 1]);
  });
});

describe('importRaduga', () => {
  it('imports book answers, solves the rest with the engine and reports what went wrong', async () => {
    const engine = forkEngine();
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      await importRaduga(
        [
          diagram(1, 7),
          diagram(2, 7),
          diagram(3, 7, { side: null, problems: ['сторона хода не распознана'] }),
          diagram(4, 40),
          diagram(1, 41),
          diagram(1, 42),
        ],
        { '1-1-1': '1.Nc7+ Kd7 2.N:a8', '1-1-2': '1...Kd7' },
        RANGES,
        engine,
        store,
        report,
        { accepted: new Set() },
      );
      const docs = await store.puzzles.find().sort({ _id: 1 }).toArray();
      expect(docs).toEqual([
        {
          _id: 'raduga:1-1-001',
          source: 'raduga',
          fen: FORK_FEN,
          solution: ['d5c7', 'e8d7', 'c7a8'],
          themes: ['fork'],
          themesRaw: ['Двойной удар'],
          ref: 'Дорофеева, т.1, ч.1 №1',
          page: 7,
          solutionFrom: 'book',
        },
        {
          _id: 'raduga:1-1-004',
          source: 'raduga',
          fen: FORK_FEN,
          solution: ['d5c7', 'e8d7', 'c7a8'],
          themes: [],
          ref: 'Дорофеева, т.1, ч.1 №4',
          page: 40,
          solutionFrom: 'engine',
        },
        {
          _id: 'raduga:1-2-001',
          source: 'raduga',
          fen: FORK_FEN,
          solution: ['d5c7', 'e8d7', 'c7a8'],
          themes: [],
          ref: 'Дорофеева, т.1, ч.2 №1',
          page: 41,
          solutionFrom: 'engine',
        },
      ]);
    } finally {
      await store.close();
    }
    // ответ «1-1-1» относится только к №1 части 1: №1 части 2 решён движком
    expect(report).toMatchObject({ total: 6, imported: 3, fromEngine: 2 });
    expect(report.count('answer_illegal')).toBe(1);
    expect(report.count('recognition')).toBe(2);
    const md = report.toMarkdown();
    expect(md).toContain('raduga:1-1-004 - неизвестная тема');
    expect(md).toContain('номер 1 повторяется (стр. 42)');
    expect(md).not.toContain('с ответами книги не сверялись');
  });

  it('numbers parts over the whole volume and keeps other puzzles when importing a subset', async () => {
    const engine = forkEngine();
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      await store.upsert([{ _id: 'raduga:1-1-001', source: 'raduga', fen: FORK_FEN, solution: ['d5c7', 'e8d7', 'c7a8'], themes: [], solutionFrom: 'engine' }]);
      await importRaduga([diagram(1, 7), diagram(2, 7), diagram(1, 41)], {}, RANGES, engine, store, report, {
        accepted: new Set(),
        only: (d) => d.page >= 40,
      });
      expect((await store.puzzles.find().sort({ _id: 1 }).toArray()).map((p) => p._id)).toEqual(['raduga:1-1-001', 'raduga:1-2-001']);
    } finally {
      await store.close();
    }
    // без ответов книги (F16) отчёт прямо говорит, что решения не сверялись с книгой
    expect(report.toMarkdown()).toContain('Решения всех задач посчитаны движком, с ответами книги не сверялись.');
  });

  it('rejects a position whose first move does not win, under its own reason', async () => {
    const QUIET = '4k3/8/8/3N4/8/8/8/6K1 w - - 0 1';
    const engine = new FakeEngine().on(QUIET, [{ move: 'g1g2', cp: 120 }]);
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      await importRaduga([diagram(1, 7, { placement: '4k3/8/8/3N4/8/8/8/6K1' })], {}, RANGES, engine, store, report, {
        accepted: new Set(),
      });
      expect(await store.puzzles.countDocuments()).toBe(0);
    } finally {
      await store.close();
    }
    expect(report.count('not_winning')).toBe(1);
    expect(report.toMarkdown()).toContain('raduga:1-1-001 - первый ход не выигрывает: стр. 7');
  });

  it('puts an engine error on one position into the report and goes on with the rest', async () => {
    // на второй позиции сервис движка недоступен: клиент бросает EngineUnavailable, как при упавшем процессе
    const BROKEN = '4k3/8/8/3N4/8/8/8/5K2';
    const engine = forkEngine();
    const analyse = engine.analyse.bind(engine);
    engine.analyse = async (fen, opts) => {
      if (fen.startsWith(BROKEN)) throw new EngineUnavailable('engine unavailable at http://x: fetch failed');
      return analyse(fen, opts);
    };
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      await importRaduga([diagram(1, 7), diagram(2, 7, { placement: BROKEN }), diagram(3, 8)], {}, RANGES, engine, store, report, {
        accepted: new Set(),
      });
      expect((await store.puzzles.find().sort({ _id: 1 }).toArray()).map((p) => p._id)).toEqual(['raduga:1-1-001', 'raduga:1-1-003']);
    } finally {
      await store.close();
    }
    expect(report.count('no_answer')).toBe(1);
    expect(report.toMarkdown()).toContain('raduga:1-1-002 - нет ответа: ошибка движка: engine unavailable at http://x: fetch failed (стр. 7)');
  });

  it('does not remove stale puzzles when the engine failed on some position', async () => {
    const BROKEN = '4k3/8/8/3N4/8/8/8/5K2';
    const engine = forkEngine();
    const analyse = engine.analyse.bind(engine);
    engine.analyse = async (fen, opts) => {
      if (fen.startsWith(BROKEN)) throw new EngineUnavailable('engine unavailable');
      return analyse(fen, opts);
    };
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      // задача №2 была импортирована раньше; на этот раз движок на ней упал
      await store.upsert([{ _id: 'raduga:1-1-002', source: 'raduga', fen: FORK_FEN, solution: ['d5c7'], themes: [], solutionFrom: 'engine' }]);
      await importRaduga([diagram(1, 7), diagram(2, 7, { placement: BROKEN })], {}, RANGES, engine, store, report, { accepted: new Set() });
      expect((await store.puzzles.find().sort({ _id: 1 }).toArray()).map((p) => p._id)).toEqual(['raduga:1-1-001', 'raduga:1-1-002']);
    } finally {
      await store.close();
    }
    expect(report.toMarkdown()).toContain('устаревшие задачи не удалены: были ошибки движка');
  });

  it('removes stale puzzles after a clean run and says nothing about engine errors', async () => {
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    try {
      await store.upsert([{ _id: 'raduga:1-1-099', source: 'raduga', fen: FORK_FEN, solution: ['d5c7'], themes: [], solutionFrom: 'engine' }]);
      await importRaduga([diagram(1, 7)], {}, RANGES, forkEngine(), store, report, { accepted: new Set() });
      expect((await store.puzzles.find().toArray()).map((p) => p._id)).toEqual(['raduga:1-1-001']);
    } finally {
      await store.close();
    }
    expect(report.toMarkdown()).not.toContain('ошибки движка');
  });

  it('writes finished batches before the run ends', async () => {
    const LAST = 'q3k3/8/8/3N4/8/8/7K/8';
    const LAST_FEN = `${LAST} w - - 0 1`;
    const engine = forkEngine()
      .on(LAST_FEN, [{ move: 'd5c7', cp: 900 }, { move: 'd5f6', cp: 0 }])
      .on(LAST_FEN, [{ move: 'd5c7', cp: 900 }], ['d5c7'])
      .on(fenAfter(LAST_FEN, ['d5c7']), [{ move: 'e8d7', cp: -900 }])
      .on(fenAfter(LAST_FEN, ['d5c7', 'e8d7']), [{ move: 'c7a8', cp: 900 }]);
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    const upsert = store.upsert.bind(store);
    const sizes: number[] = [];
    store.upsert = async (docs) => {
      sizes.push(docs.length);
      return upsert(docs);
    };
    let writtenBeforeLast = -1;
    const analyse = engine.analyse.bind(engine);
    engine.analyse = async (fen, opts) => {
      if (fen.startsWith(LAST) && writtenBeforeLast < 0) writtenBeforeLast = sizes.length;
      return analyse(fen, opts);
    };
    const diagrams = Array.from({ length: 200 }, (_, i) => diagram(i + 1, 7));
    diagrams.push(diagram(201, 8, { placement: LAST }));
    try {
      await importRaduga(diagrams, {}, RANGES, engine, store, report, { accepted: new Set() });
      expect(await store.puzzles.countDocuments()).toBe(201);
    } finally {
      await store.close();
    }
    expect(writtenBeforeLast).toBe(1);
    expect(sizes).toEqual([200, 1]);
  });

  it('solves several positions at once and still writes them and the report in diagram order', async () => {
    const engine = forkEngine();
    engine.delayMs = 20;
    const store = await PuzzleStore.open(mongo.url());
    const report = new ImportReport('raduga');
    const diagrams = [1, 2, 3, 4, 5, 6].map((n) => diagram(n, 7 + n));
    diagrams[2] = diagram(3, 10, { side: null, problems: ['сторона хода не распознана'] });
    try {
      await importRaduga(diagrams, {}, RANGES, engine, store, report, { accepted: new Set(), concurrency: 3 });
      expect((await store.puzzles.find().sort({ _id: 1 }).toArray()).map((p) => p._id)).toEqual([
        'raduga:1-1-001',
        'raduga:1-1-002',
        'raduga:1-1-004',
        'raduga:1-1-005',
        'raduga:1-1-006',
      ]);
    } finally {
      await store.close();
    }
    expect(engine.maxInFlight).toBe(3);
    expect(report).toMatchObject({ total: 6, imported: 5, fromEngine: 5 });
    expect(report.toMarkdown()).toContain('raduga:1-1-003 - ошибка распознавания: сторона хода не распознана (стр. 10)');
  });
});
