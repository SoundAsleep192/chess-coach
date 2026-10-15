/** Раздел ответов (`pdftotext -raw`): «<номер> <ходы>» до следующего номера, без колонтитула. */
export function parseSolutions(text: string): Map<number, string> {
  const clean = text
    .replace(/5334 Problems, Combinations & Games/g, '\n')
    .replace(/8\.1 Solutions/g, '\n')
    .replace(/Chapter 8\s*Solutions/g, '\n');
  const out = new Map<number, string>();
  let current: number | null = null;
  for (const line of clean.split('\n')) {
    const m = line.match(/^(\d{1,4}) (\d+\..*)$/);
    if (m) {
      current = Number(m[1]);
      out.set(current, m[2].trim());
    } else if (current !== null && line.trim()) {
      out.set(current, `${out.get(current)} ${line.trim()}`);
    }
  }
  return out;
}
