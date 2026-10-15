import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PuzzleSource } from '@board/shared';

export type Reason =
  | 'illegal_position'
  | 'no_answer'
  | 'answer_illegal'
  | 'disputed'
  | 'unknown_theme'
  | 'recognition'
  | 'skipped_chapter'
  | 'filtered'
  | 'not_winning';

export const REASON_TEXT: Record<Reason, string> = {
  illegal_position: 'нелегальная позиция',
  no_answer: 'нет ответа',
  answer_illegal: 'ответ нелегален',
  disputed: 'спорный ответ',
  unknown_theme: 'неизвестная тема',
  recognition: 'ошибка распознавания',
  skipped_chapter: 'глава не задачная',
  filtered: 'не прошла фильтр качества',
  not_winning: 'первый ход не выигрывает',
};

interface Entry {
  id: string;
  reason: Reason;
  detail: string;
}

/** Отчёт импорта: сколько задач в базе, сколько отброшено и почему. Пишется в data/books/import-<source>.md. */
export class ImportReport {
  readonly source: PuzzleSource;
  total = 0;
  imported = 0;
  fromEngine = 0;
  extended = 0;
  private readonly rejected = new Map<Reason, number>();
  private readonly entries: Entry[] = [];
  private readonly notes: Entry[] = [];
  private readonly remarks: string[] = [];

  constructor(source: PuzzleSource) {
    this.source = source;
  }

  /** Позиция не попала в базу. listed=false - только счётчик (фильтр Lichess на миллионах строк). */
  reject(id: string, reason: Reason, detail: string, listed = true): void {
    this.rejected.set(reason, (this.rejected.get(reason) ?? 0) + 1);
    if (listed) this.entries.push({ id, reason, detail });
  }

  /** Позиция в базе, но тренеру надо на неё посмотреть: спорный ответ, неизвестная тема. */
  note(id: string, reason: Reason, detail: string): void {
    this.notes.push({ id, reason, detail });
  }

  /** Строка об импорте в целом, печатается под итогом (например, откуда решения). */
  remark(text: string): void {
    this.remarks.push(text);
  }

  get rejectedTotal(): number {
    return [...this.rejected.values()].reduce((a, b) => a + b, 0);
  }

  count(reason: Reason): number {
    return this.rejected.get(reason) ?? 0;
  }

  toMarkdown(at: Date = new Date()): string {
    const disputed = this.notes.filter((n) => n.reason === 'disputed').length;
    const lines = [
      `# Импорт ${this.source}, ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      '',
      `Всего позиций: ${this.total}. В базе: ${this.imported} (решение от движка: ${this.fromEngine}, ` +
        `дополнено движком: ${this.extended}, спорных: ${disputed}). Отброшено: ${this.rejectedTotal}.`,
      '',
    ];
    if (this.remarks.length > 0) lines.push(...this.remarks, '');
    if (this.rejected.size > 0) {
      lines.push('## Отброшено по причинам', '', '| Причина | Число |', '|---|---|');
      for (const [reason, n] of this.rejected) lines.push(`| ${REASON_TEXT[reason]} | ${n} |`);
      lines.push('');
    }
    if (this.notes.length > 0) {
      lines.push('## В базе, но тренеру посмотреть', '');
      for (const n of this.notes) lines.push(`- ${n.id} - ${REASON_TEXT[n.reason]}: ${n.detail}`);
      lines.push('');
    }
    if (this.entries.length > 0) {
      lines.push('## Отброшенные позиции', '');
      for (const e of this.entries) lines.push(`- ${e.id} - ${REASON_TEXT[e.reason]}: ${e.detail}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  write(dir: string, at?: Date): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `import-${this.source}.md`);
    writeFileSync(path, this.toMarkdown(at));
    return path;
  }
}

/** Спорные задачи, которые тренер посмотрел и принял: массив id в data/books/accepted.json. */
export function loadAccepted(dir: string): Set<string> {
  const path = join(dir, 'accepted.json');
  if (!existsSync(path)) return new Set();
  return new Set(JSON.parse(readFileSync(path, 'utf8')) as string[]);
}
