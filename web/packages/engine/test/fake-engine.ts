import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolOptions } from '../src/pool';

export const FAKE_UCI = join(__dirname, 'fake-uci.mjs');

/** Пул на поддельном движке: node test/fake-uci.mjs с флагами. */
export function fakePool(extra: Partial<PoolOptions> & { flags?: string[] } = {}): PoolOptions {
  const { flags = [], ...rest } = extra;
  return { command: process.execPath, args: [FAKE_UCI, ...flags], workers: 1, hashMb: 16, nodes: 1000, ...rest };
}

/** Файл журнала команд поддельного движка и чтение его строк без pid. */
export function commandLog(): { path: string; lines: () => string[] } {
  const path = join(mkdtempSync(join(tmpdir(), 'fake-uci-')), 'log.txt');
  return { path, lines: () => readFileSync(path, 'utf8').trim().split('\n').map((l) => l.replace(/^\d+ /, '')) };
}
