import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { requireTool } from './config.ts';

/** Строки файла; .zst распаковывается потоком через `zstd -dc`. Ранний выход из цикла останавливает zstd. */
export async function* readLines(path: string): AsyncGenerator<string> {
  let child: ChildProcess | undefined;
  let closed: Promise<unknown[]> | undefined;
  let input: Readable;
  if (path.endsWith('.zst')) {
    child = spawn(requireTool('zstd'), ['-dc', path], { stdio: ['ignore', 'pipe', 'inherit'] });
    closed = once(child, 'close');
    input = child.stdout!;
  } else {
    input = createReadStream(path);
  }
  let finished = false;
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) yield line.replace(/\r$/, '');
    finished = true;
  } finally {
    if (child && !finished) child.kill();
  }
  if (closed) {
    const [code] = await closed;
    if (code !== 0) throw new Error(`zstd -dc ${path} exited with code ${String(code)}`);
  }
}
