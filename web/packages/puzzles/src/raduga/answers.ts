import { existsSync, readFileSync } from 'node:fs';
import { parseBookLine, placementToFen, sanLineToUci, validatePosition, type Side } from '../chess-utils.ts';
import { diagramKey, partsOf } from './import.ts';
import type { ScannedDiagram } from './scan.ts';

/** Ответы, переписанные по картинкам: "<том>-<часть>-<номер>" -> главная линия (часть - как в partsOf). */
export type Answers = Record<string, string>;

export interface CheckIssue {
  key: string;
  kind: 'no_diagram' | 'illegal' | 'side' | 'position' | 'no_answer';
  detail: string;
}

const SIDE_RU: Record<Side, string> = { w: 'белых', b: 'чёрных' };

export function loadAnswers(path: string): Answers {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Answers) : {};
}

/** Каждый ответ должен быть легален из распознанной позиции; несовпадение - ошибка распознавателя или переписчика. */
export function checkAnswers(diagrams: ScannedDiagram[], answers: Answers): { ok: number; issues: CheckIssue[] } {
  const byKey = new Map<string, ScannedDiagram>();
  const parts = partsOf(diagrams);
  diagrams.forEach((d, i) => {
    if (d.number !== null) byKey.set(diagramKey(d, parts[i]), d);
  });
  const issues: CheckIssue[] = [];
  let ok = 0;
  for (const [key, text] of Object.entries(answers)) {
    const d = byKey.get(key);
    if (!d) {
      issues.push({ key, kind: 'no_diagram', detail: 'диаграммы с таким номером нет в raduga-diagrams.json' });
      continue;
    }
    const book = parseBookLine(text);
    if (book.moves.length === 0) {
      issues.push({ key, kind: 'illegal', detail: `в ответе нет ходов: ${text} (стр. ${d.page})` });
      continue;
    }
    if (book.side && d.side && book.side !== d.side) {
      issues.push({ key, kind: 'side', detail: `ответ начинается ходом ${SIDE_RU[book.side]}, треугольник - ход ${SIDE_RU[d.side]} (стр. ${d.page})` });
      continue;
    }
    const fen = placementToFen(d.placement, d.side ?? book.side ?? 'w');
    const bad = validatePosition(fen);
    if (bad) {
      issues.push({ key, kind: 'position', detail: `${bad}; FEN ${fen} (стр. ${d.page})` });
      continue;
    }
    try {
      sanLineToUci(fen, book.moves);
      ok += 1;
    } catch (e) {
      issues.push({ key, kind: 'illegal', detail: `${(e as Error).message}; ответ: ${text} (стр. ${d.page})` });
    }
  }
  for (const [key, d] of byKey) {
    if (!(key in answers)) issues.push({ key, kind: 'no_answer', detail: `стр. ${d.page}` });
  }
  return { ok, issues };
}

const KIND_TITLE: Record<CheckIssue['kind'], string> = {
  side: 'Сторона хода в ответе не совпадает с треугольником',
  illegal: 'Ответ нелегален из распознанной позиции',
  position: 'Распознанная позиция нелегальна',
  no_diagram: 'Ответ без диаграммы (номер распознан неверно или опечатка в ключе)',
  no_answer: 'Диаграммы без ответа (решение построит движок)',
};

export function checkReport(result: { ok: number; issues: CheckIssue[] }): string {
  const lines = ['# Проверка ответов «Радуги»', '', `Легальных ответов: ${result.ok}.`, ''];
  for (const kind of Object.keys(KIND_TITLE) as CheckIssue['kind'][]) {
    const items = result.issues.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push(`## ${KIND_TITLE[kind]}: ${items.length}`, '');
    for (const i of items) lines.push(`- ${i.key}: ${i.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}
