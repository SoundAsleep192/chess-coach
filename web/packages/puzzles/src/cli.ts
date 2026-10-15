import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { alternativeMates } from './chess-utils.ts';
import { booksDataDir, loadConfig, requireTool, type CoachConfig } from './config.ts';
import { connectEngine } from './engine/connect.ts';
import { DEFAULT_SOLVE } from './engine/solution.ts';
import { importLichess } from './lichess.ts';
import { POLGAR_TOTAL } from './polgar/chapters.ts';
import { importPolgar, readPolgar } from './polgar/import.ts';
import { checkAnswers, checkReport, loadAnswers } from './raduga/answers.ts';
import { findBoardCandidates } from './raduga/boards.ts';
import { loadTemplates, missingClasses } from './raduga/classify.ts';
import { importRaduga, partsOf, type ThemeRanges } from './raduga/import.ts';
import { extractPage, renderPng, volumePdf } from './raduga/pages.ts';
import type { Rect } from './raduga/pbm.ts';
import { scanSummary, scanVolume, templatesFromLabels, type ScannedDiagram } from './raduga/scan.ts';
import { ImportReport, loadAccepted } from './report.ts';
import { PuzzleStore } from './store.ts';

type Command = (args: string[], cfg: CoachConfig) => Promise<void>;

const fromRoot = (cfg: CoachConfig, path: string) => (isAbsolute(path) ? path : join(cfg.root, path));

const COMMANDS: Record<string, Command> = {
  /** npm run import -w @board/puzzles -- lichess data/lichess/lichess_db_puzzle.csv.zst [--limit N] */
  lichess: async (args, cfg) => {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { limit: { type: 'string' } } });
    if (!positionals[0]) throw new Error('usage: lichess <file.csv or file.csv.zst> [--limit N]');
    const store = await PuzzleStore.open();
    const report = new ImportReport('lichess');
    try {
      await importLichess(fromRoot(cfg, positionals[0]), store, report, {
        limit: values.limit ? Number(values.limit) : undefined,
        onProgress: (rows) => console.log(`... ${rows} rows, ${report.imported} imported`),
      });
    } finally {
      await store.close();
    }
    const path = report.write(booksDataDir(cfg));
    console.log(`lichess: ${report.imported} imported, ${report.rejectedTotal} rejected of ${report.total}; report ${path}`);
  },

  /** npm run import -w @board/puzzles -- polgar [--from N --to M]; нужен сервис движка (docker compose up -d engine). */
  polgar: async (args, cfg) => {
    const { values } = parseArgs({
      args,
      options: { from: { type: 'string' }, to: { type: 'string' } },
    });
    // до начала работы: нет poppler или сервиса движка - понятная ошибка
    requireTool('pdftotext');
    const pdf = join(cfg.booksDir, 'polgar.pdf');
    if (!existsSync(pdf)) throw new Error(`${pdf} not found: set [puzzles] books_dir in coach.toml`);
    const partial = values.from !== undefined || values.to !== undefined;
    const bound = (name: 'from' | 'to', fallback: number): number => {
      const raw = values[name];
      if (raw === undefined) return fallback;
      if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be an integer, got "${raw}"`);
      return Number(raw);
    };
    const from = bound('from', 1);
    const to = bound('to', POLGAR_TOTAL);
    const engine = await connectEngine();
    const input = readPolgar(pdf);
    const store = await PuzzleStore.open();
    const report = new ImportReport('polgar');
    const dir = booksDataDir(cfg);
    try {
      await importPolgar(input, engine, store, report, {
        accepted: loadAccepted(dir),
        solve: { ...DEFAULT_SOLVE, uniqueGap: cfg.blunder },
        only: partial ? (n) => n >= from && n <= to : undefined,
        onProgress: (n) => {
          if (n % 100 === 0) console.log(`... ${n} positions solved`);
        },
      });
    } finally {
      await store.close();
    }
    console.log(`polgar: ${report.imported} imported, ${report.rejectedTotal} rejected of ${report.total}; report ${report.write(dir)}`);
  },

  /** PNG для разметки глазами: страница, доска (0-3), четверть страницы (1-4) или диаграмма по номеру (и части, по умолчанию 1). */
  'raduga-render': async (args, cfg) => {
    const { values } = parseArgs({
      args,
      options: {
        volume: { type: 'string' },
        page: { type: 'string' },
        dpi: { type: 'string' },
        board: { type: 'string' },
        quarter: { type: 'string' },
        number: { type: 'string' },
        part: { type: 'string' },
      },
    });
    const volume = Number(values.volume);
    let page = Number(values.page);
    let board = values.board;
    if (values.number !== undefined) {
      const diagrams = JSON.parse(readFileSync(join(booksDataDir(cfg), 'raduga-diagrams.json'), 'utf8')) as ScannedDiagram[];
      const part = Number(values.part ?? 1);
      const parts = partsOf(diagrams);
      const d = diagrams.find((x, i) => x.volume === volume && parts[i] === part && x.number === Number(values.number));
      if (!d) throw new Error(`no diagram ${values.number} of volume ${volume} part ${part} in raduga-diagrams.json`);
      page = d.page;
      board = String(d.slot);
    }
    if (!volume || !page) throw new Error('raduga-render --volume V (--page P [--board 0..3 | --quarter 1..4] | --number N [--part K]) [--dpi N]');
    const pdf = volumePdf(cfg.booksDir, volume);
    let crop: Rect | undefined;
    let suffix = '';
    if (board !== undefined) {
      const bmp = extractPage(pdf, page, tmpdir());
      const b = bmp ? findBoardCandidates(bmp)[Number(board)]?.rect : undefined;
      if (!b) throw new Error(`no board ${board} on volume ${volume} page ${page}`);
      crop = { x: b.x - Math.round(0.1 * b.w), y: b.y - Math.round(0.32 * b.w), w: Math.round(1.45 * b.w), h: Math.round(1.5 * b.w) };
      suffix = `-b${board}`;
    } else if (values.quarter !== undefined) {
      const q = Number(values.quarter) - 1;
      crop = { x: (q % 2) * 1626, y: Math.floor(q / 2) * 2361, w: 1626, h: 2361 };
      suffix = `-q${q + 1}`;
    }
    const outDir = join(booksDataDir(cfg), 'render');
    mkdirSync(outDir, { recursive: true });
    const dpi = Number(values.dpi ?? (crop ? 200 : 80));
    console.log(renderPng(pdf, page, dpi, join(outDir, `v${volume}-p${String(page).padStart(3, '0')}${suffix}.png`), crop));
  },

  /** Образцы клеток по data/books/raduga-labels.json -> raduga-templates.json. */
  'raduga-templates': async (_args, cfg) => {
    const dir = booksDataDir(cfg);
    const labels = JSON.parse(readFileSync(join(dir, 'raduga-labels.json'), 'utf8')) as Record<string, string[]>;
    const tmp = mkdtempSync(join(tmpdir(), 'raduga-'));
    let set;
    try {
      set = templatesFromLabels(labels, cfg.booksDir, tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    writeFileSync(join(dir, 'raduga-templates.json'), JSON.stringify(set));
    const missing = missingClasses(set);
    const classes = new Set(set.templates.map((t) => `${t.label}|${t.dark}`)).size;
    console.log(`templates: ${classes} classes (${set.templates.length} labelled cells) from ${Object.keys(labels).length} pages${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
    if (missing.length) process.exitCode = 1;
  },

  /** Распознать тома (все или --volume V) -> raduga-diagrams.json и raduga-scan.md. */
  'raduga-scan': async (args, cfg) => {
    const { values } = parseArgs({ args, options: { volume: { type: 'string' } } });
    const tesseract = requireTool('tesseract');
    requireTool('pdfimages');
    requireTool('pdfinfo');
    const dir = booksDataDir(cfg);
    const set = loadTemplates(join(dir, 'raduga-templates.json'));
    const volumes = values.volume ? [Number(values.volume)] : [1, 2, 3, 4, 5, 6, 7];
    const path = join(dir, 'raduga-diagrams.json');
    const previous: ScannedDiagram[] = values.volume && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    const tmp = mkdtempSync(join(tmpdir(), 'raduga-'));
    let scans: ReturnType<typeof scanVolume>[];
    try {
      scans = volumes.map((v) =>
        scanVolume(volumePdf(cfg.booksDir, v), v, set, tesseract, tmp, (p) => {
          if (p % 10 === 0) console.log(`... volume ${v} page ${p}`);
        }),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const diagrams = [...previous.filter((d) => !volumes.includes(d.volume)), ...scans.flatMap((s) => s.diagrams)];
    writeFileSync(path, JSON.stringify(diagrams, null, 1));
    writeFileSync(join(dir, 'raduga-scan.md'), scanSummary(scans));
    const bad = diagrams.filter((d) => d.problems.length > 0).length;
    console.log(`raduga: ${diagrams.length} diagrams, ${bad} with problems; see ${join(dir, 'raduga-scan.md')}`);
  },

  /** Ответы против распознанных позиций -> data/books/raduga-check.md. */
  'raduga-check': async (_args, cfg) => {
    const dir = booksDataDir(cfg);
    const diagrams = JSON.parse(readFileSync(join(dir, 'raduga-diagrams.json'), 'utf8')) as ScannedDiagram[];
    const result = checkAnswers(diagrams, loadAnswers(join(dir, 'raduga-answers.json')));
    writeFileSync(join(dir, 'raduga-check.md'), checkReport(result));
    const missing = result.issues.filter((i) => i.kind === 'no_answer').length;
    console.log(`answers: ${result.ok} legal, ${result.issues.length - missing} issues, ${missing} diagrams without an answer; see ${join(dir, 'raduga-check.md')}`);
  },

  /** npm run import -w @board/puzzles -- raduga: после raduga-scan и разметки тем; нужен сервис движка. */
  raduga: async (_args, cfg) => {
    const dir = booksDataDir(cfg);
    const need = (name: string) => {
      const path = join(dir, name);
      if (!existsSync(path)) throw new Error(`${path} not found: run raduga-scan and the labelling steps first`);
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    };
    const diagrams = need('raduga-diagrams.json') as ScannedDiagram[];
    const ranges = need('raduga-themes.json') as ThemeRanges;
    const answers = loadAnswers(join(dir, 'raduga-answers.json'));
    const engine = await connectEngine();
    const { workers } = await engine.health();
    const store = await PuzzleStore.open();
    const report = new ImportReport('raduga');
    try {
      await importRaduga(diagrams, answers, ranges, engine, store, report, {
        accepted: loadAccepted(dir),
        solve: { ...DEFAULT_SOLVE, uniqueGap: cfg.blunder },
        concurrency: workers,
        onProgress: (n) => {
          if (n % 100 === 0) console.log(`... ${n} positions solved`);
        },
      });
    } finally {
      await store.close();
    }
    const share = report.total ? ((100 * report.imported) / report.total).toFixed(1) : '0';
    console.log(`raduga: ${report.imported} of ${report.total} diagrams in the base (${share}%), report ${report.write(dir)}`);
  },

  /** Задачи mateIn1/mateIn2, где на последнем ходу есть другой мат (для приёмки). */
  'alt-mates': async (args) => {
    const { values } = parseArgs({ args, options: { limit: { type: 'string' } } });
    const limit = Number(values.limit ?? 2000);
    const store = await PuzzleStore.open();
    let found = 0;
    try {
      const cursor = store.puzzles.find({ themes: { $in: ['mateIn1', 'mateIn2'] }, disputed: { $ne: true } }).limit(limit);
      for await (const p of cursor) {
        const alt = alternativeMates(p.fen, p.solution);
        if (alt.length === 0) continue;
        console.log(`${p._id}  solution ${p.solution.join(' ')}  also mates: ${alt.join(' ')}`);
        found += 1;
        if (found >= 5) break;
      }
    } finally {
      await store.close();
    }
    if (found === 0) console.log(`no puzzle with an alternative mate among the first ${limit}`);
  },
};

async function main(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;
  const command = name ? COMMANDS[name] : undefined;
  if (!command) throw new Error(`usage: <command> [options]; commands: ${Object.keys(COMMANDS).join(', ')}`);
  await command(rest, loadConfig());
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
