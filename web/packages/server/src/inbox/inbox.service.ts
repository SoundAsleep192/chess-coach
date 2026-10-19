import { Injectable } from '@nestjs/common';
import type { BoardState, InboxResponse, LessonReplyBody, NodeId } from '@board/shared';
import {
  appendToLine,
  cursorLine,
  deleteDraft,
  eventText,
  lessonDrafts,
  lineDraft,
  puzzleDraft,
  type Draft,
  type StoredEvent,
} from './inbox-format';
import { InboxRepository } from './inbox-repository';

export const INBOX_KEEP = 500;
export const INBOX_PAGE = 50;

/** Очередь событий ученика. Запись идёт вне пути хода: сбой записи пишется в лог и ход не задерживает и не ломает. */
@Injectable()
export class InboxService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly repo: InboxRepository) {}

  /** s - состояние после хода. */
  recordMove(s: BoardState, nodeId: NodeId): void {
    this.enqueue(async () => {
      const node = s.nodes[nodeId];
      const last = await this.repo.last();
      const glued = last ? appendToLine(last, s, node) : null;
      if (glued) return this.repo.replace(glued);
      await this.insert(lineDraft(s, node), last);
    });
  }

  /** before - состояние до удаления. */
  recordDelete(before: BoardState, nodeId: NodeId): void {
    this.enqueue(async () => this.insert(deleteDraft(before, nodeId), await this.repo.last()));
  }

  recordPuzzle(prev: BoardState, next: BoardState): void {
    this.enqueue(async () => {
      const draft = puzzleDraft(prev, next);
      if (draft) await this.insert(draft, await this.repo.last());
    });
  }

  /**
   * prev - состояние до ответа или остановки, next - после. note - заметка помощника; reply - тело ответа
   * (реплика, оценка из ответа, итог серии), нужно для текстов, которых нет в состоянии.
   */
  recordLesson(prev: BoardState, next: BoardState, note?: string, reply?: Pick<LessonReplyBody, 'say' | 'verdict' | 'action'>): void {
    this.enqueue(async () => {
      for (const draft of lessonDrafts(prev, next, note, reply)) await this.insert(draft, await this.repo.last());
    });
  }

  async read(current: BoardState): Promise<InboxResponse> {
    await this.flush();
    const { events, total } = await this.repo.unread(INBOX_PAGE);
    return {
      events: events.map((e) => ({ id: e._id, at: e.at.toISOString(), kind: e.kind, text: e.text })),
      more: total - events.length,
      cursor: cursorLine(current),
    };
  }

  async ack(upto: number): Promise<void> {
    await this.flush();
    await this.repo.ack(upto);
  }

  /** Для тестов и чтения: дождаться записи всех событий. */
  flush(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  private async insert(d: Draft, last: StoredEvent | null): Promise<void> {
    await this.repo.insert({ ...d, _id: (last?._id ?? 0) + 1, at: new Date(), read: false, text: eventText(d) });
    await this.repo.trim(INBOX_KEEP);
  }

  private enqueue(job: () => Promise<unknown>): void {
    this.chain = this.chain.then(job).catch((e: unknown) =>
      console.error(`board: inbox write failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}
