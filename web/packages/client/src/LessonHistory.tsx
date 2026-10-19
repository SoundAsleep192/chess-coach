import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { LESSON_VERDICT_WORD, type LessonEntry, type LessonVerdictKind, type LessonView } from '@board/shared';

type BadgeKind = Exclude<LessonVerdictKind, 'info'>;

const KIND_OF_WORD = new Map(
  (Object.entries(LESSON_VERDICT_WORD) as [BadgeKind, string][]).map(([kind, word]) => [word, kind]),
);

type Item =
  | { type: 'coach'; badge?: BadgeKind; text?: string }
  | { type: 'student'; text: string }
  | { type: 'move'; text: string };

/** Записи истории в пузыри: плашка вердикта сливается со следующей репликой тренера. */
function items(transcript: LessonEntry[]): Item[] {
  const out: Item[] = [];
  for (const e of transcript) {
    const badge = e.kind === 'verdict' ? KIND_OF_WORD.get(e.text) : undefined;
    const prev = out.at(-1);
    if (e.who === 'student') {
      out.push(e.kind === 'move' ? { type: 'move', text: e.text } : { type: 'student', text: e.text });
    } else if (badge) {
      out.push({ type: 'coach', badge });
    } else if (prev?.type === 'coach' && prev.badge && prev.text === undefined) {
      prev.text = e.text;
    } else {
      out.push({ type: 'coach', text: e.text });
    }
  }
  return out;
}

export function Badge({ kind }: { kind: BadgeKind }) {
  return <span className={`badge badge-${kind}`}>{LESSON_VERDICT_WORD[kind]}</span>;
}

export function TypingDots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * История прижата к низу после каждого обновления (как afterUpdate в дизайне): новые записи, «Тренер отвечает», плашка,
 * кнопки, смена полосы движка над историей. Layout-эффект - чтобы первый же кадр был уже внизу; ResizeObserver
 * ловит изменения высоты без рендера истории.
 */
function usePinnedToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

/** История позиции как чат: тренер слева, ученик справа, кнопки под последней репликой тренера. */
export function LessonHistory({ lesson, actions }: { lesson: LessonView; actions: ReactNode }) {
  const ref = usePinnedToBottom();
  const typing = lesson.status === 'running' && lesson.online && lesson.phase === 'coach';

  return (
    <div className="lesson-history" data-testid="lesson-history" ref={ref}>
      {items(lesson.transcript).map((item, i) => {
        if (item.type === 'move') {
          return (
            <div key={i} className="chip" data-entry="move">
              ход на доске <code>{item.text}</code>
            </div>
          );
        }
        if (item.type === 'student') {
          return (
            <div key={i} className="bubble student" data-entry="student">
              {item.text}
            </div>
          );
        }
        return (
          <div key={i} className="bubble coach" data-entry="coach">
            {item.badge && <Badge kind={item.badge} />}
            {item.text !== undefined && <div className="bubble-text">{item.text}</div>}
          </div>
        );
      })}
      {typing && (
        <div className="bubble coach typing" data-entry="typing">
          Тренер отвечает
          <TypingDots />
        </div>
      )}
      {actions}
    </div>
  );
}

/** Конец серии: реплика «Позиция n из n решена.» с плашкой «Верно», под ней итог и строка о возвращении в чат. */
export function LessonDone({ lesson }: { lesson: LessonView }) {
  const ref = usePinnedToBottom();
  return (
    <div className="lesson-history" data-testid="lesson-done" ref={ref}>
      <div className="bubble coach" data-entry="coach">
        <Badge kind="correct" />
        {/* index с нуля и в конце остаётся у последней позиции: в конце серии решены все total */}
        <div className="bubble-text">
          Позиция {lesson.total} из {lesson.total} решена.
        </div>
      </div>
      <div className="bubble coach" data-entry="coach">
        {lesson.summary && <div className="bubble-text">{lesson.summary}</div>}
        <div className="bubble-foot">Возвращайся в чат: напиши тренеру, что закончил.</div>
      </div>
    </div>
  );
}
