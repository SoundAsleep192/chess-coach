import { describe, expect, it } from 'vitest';
import { mapLimit } from './limit.ts';

describe('mapLimit', () => {
  it('keeps the order of results and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5, 15], 2, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
