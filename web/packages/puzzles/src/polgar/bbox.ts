export interface Word {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
}

export interface Diagram {
  number: number;
  page: number;
  /** 8 строк шрифта, сверху 8-я горизонталь. */
  rows: string[];
}

export const ROW = /^[0ZKQRBNPkqrbnpJLSAMOjlsamo]{8}$/;
const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Слова `pdftotext -bbox`, по одному массиву на страницу. */
export function parseBBox(html: string): Word[][] {
  return html
    .split('<page ')
    .slice(1)
    .map((chunk) =>
      [...chunk.matchAll(WORD)].map((m) => ({
        xMin: Number(m[1]),
        yMin: Number(m[2]),
        xMax: Number(m[3]),
        yMax: Number(m[4]),
        text: decode(m[5]),
      })),
    );
}

/** Диаграммы страницы: 8 строк доски столбиком с одним xMin, номер - число прямо над верхней строкой. */
export function findDiagrams(words: Word[], page: number): Diagram[] {
  const rows = words.filter((w) => ROW.test(w.text)).sort((a, b) => a.xMin - b.xMin || a.yMin - b.yMin);
  const numbers = words.filter((w) => /^\d{1,4}$/.test(w.text));
  const groups: Word[][] = [];
  for (const w of rows) {
    const group = groups.find((g) => {
      const last = g[g.length - 1];
      return g.length < 8 && Math.abs(last.xMin - w.xMin) < 3 && w.yMin > last.yMin && w.yMin - last.yMax < 12;
    });
    if (group) group.push(w);
    else groups.push([w]);
  }
  const out: Diagram[] = [];
  for (const g of groups) {
    if (g.length !== 8) continue;
    const top = g[0];
    const above = numbers.filter((n) => {
      const cx = (n.xMin + n.xMax) / 2;
      return n.yMax <= top.yMin + 1 && top.yMin - n.yMax < 40 && cx >= top.xMin - 5 && cx <= top.xMax + 5;
    });
    if (above.length === 0) continue;
    const num = above.reduce((a, b) => (b.yMax > a.yMax ? b : a));
    out.push({ number: Number(num.text), page, rows: g.map((w) => w.text) });
  }
  return out;
}
