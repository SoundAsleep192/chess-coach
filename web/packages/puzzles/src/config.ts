import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parse } from 'smol-toml';

export interface CoachConfig {
  root: string;
  /** Порог зевка в пунктах win% из [review].blunder: он же порог «единственного хода». */
  blunder: number;
  booksDir: string;
}

export class ToolMissing extends Error {
  name = 'ToolMissing';
}

/** Корень репозитория: $COACH_HOME или первый каталог вверх, где лежит coach.toml (как в coach/config.py). */
export function findRoot(start: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.COACH_HOME) return resolve(env.COACH_HOME);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'coach.toml'))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`coach.toml not found above ${start}; set COACH_HOME`);
    dir = up;
  }
}

type Table = Record<string, unknown>;
const table = (value: unknown): Table => (value && typeof value === 'object' ? (value as Table) : {});

export function loadConfig(root: string = findRoot()): CoachConfig {
  const path = join(root, 'coach.toml');
  const data = existsSync(path) ? table(parse(readFileSync(path, 'utf8'))) : {};
  const review = table(data.review);
  const puzzles = table(data.puzzles);
  return {
    root,
    blunder: Number(review.blunder ?? 15),
    booksDir: String(puzzles.books_dir ?? join(process.env.HOME ?? '', 'Desktop', 'мои_книги_шахматы')),
  };
}

export function booksDataDir(cfg: CoachConfig): string {
  return join(cfg.root, 'data', 'books');
}

const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const BREW: Record<string, string> = {
  pdftotext: 'poppler',
  pdfimages: 'poppler',
  pdftoppm: 'poppler',
  pdfinfo: 'poppler',
};

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Путь к утилите хоста (pdftotext, tesseract, zstd ...) или ToolMissing с подсказкой, как поставить. */
export function requireTool(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_DIRS];
  for (const dir of dirs) {
    const path = join(dir, name);
    if (executable(path)) return path;
  }
  throw new ToolMissing(
    `${name} not found (looked in PATH and ${EXTRA_DIRS.join(', ')}). Install it: brew install ${BREW[name] ?? name}`,
  );
}
