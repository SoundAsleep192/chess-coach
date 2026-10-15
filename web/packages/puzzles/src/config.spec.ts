import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRoot, loadConfig, requireTool, ToolMissing } from './config.ts';

function tmpRoot(toml: string): string {
  const root = mkdtempSync(join(tmpdir(), 'coach-'));
  writeFileSync(join(root, 'coach.toml'), toml);
  return root;
}

describe('config', () => {
  it('finds coach.toml above the working directory and reads review and puzzles', () => {
    const root = tmpRoot(
      '[engine]\npath = "bin/sf"\nthreads = 6\nhash_mb = 512\n[review]\nblunder = 15.0\n[puzzles]\nbooks_dir = "/books"\n',
    );
    const deep = join(root, 'web', 'packages', 'puzzles');
    mkdirSync(deep, { recursive: true });
    expect(findRoot(deep, {})).toBe(root);
    expect(loadConfig(root)).toEqual({
      root,
      blunder: 15,
      booksDir: '/books',
    });
  });

  it('prefers COACH_HOME', () => {
    const root = tmpRoot('');
    expect(findRoot('/', { COACH_HOME: root })).toBe(root);
  });

  it('names the missing tool and how to install it', () => {
    expect(() => requireTool('no-such-tool-xyz', { PATH: '' })).toThrow(ToolMissing);
    expect(() => requireTool('no-such-tool-xyz', { PATH: '' })).toThrow(/brew install/);
  });
});
