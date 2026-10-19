import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisData, BoardState, ClientMessage, LessonView } from '@board/shared';
import { LessonPanel } from './LessonPanel';
import { lessonLayout, type LessonLayout } from './lessonLayout';
import { StateBuilder, said } from './test-utils';
import type { ReplayView } from './useLessonReplay';

afterEach(cleanup);

// корень n1; ход ученика e4 = n2 (ошибка), опровержение e5 Nf3 = n3, n4
const b = new StateBuilder();
const [e4, e5, nf3] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'student');

const WIDE = lessonLayout(1280, 760);
const NARROW = lessonLayout(630, 860);
const IDLE: ReplayView = { shownNode: null, step: 0, total: 0, replaying: false, restart: () => {} };

const ready = (nodeId: string, depth = 22): AnalysisData => ({
  nodeId,
  fen: 'x',
  status: 'ready',
  depth,
  lines: [
    { cp: 120, san: ['2.Nf3', 'Nc6'] },
    { cp: 40, san: ['2.d4'] },
    { cp: -30, san: ['2.Bc4'] },
  ],
});

interface Opts {
  cursor?: string;
  lesson?: Partial<LessonView>;
  analysis?: AnalysisData | null;
  replay?: ReplayView;
  connected?: boolean;
  layout?: LessonLayout;
  engineOn?: boolean;
}

function show(o: Opts = {}) {
  const sent: ClientMessage[] = [];
  const setEngine = vi.fn();
  const state: BoardState = b.lesson(o.cursor ?? b.rootId, o.lesson);
  const props = (p: Opts) => ({
    state: b.lesson(p.cursor ?? b.rootId, p.lesson),
    analysis: p.analysis ?? null,
    replay: p.replay ?? IDLE,
    connected: p.connected ?? true,
    send: (m: ClientMessage) => sent.push(m),
    layout: p.layout ?? WIDE,
    engine: { on: p.engineOn ?? true, set: setEngine },
  });
  const r = render(<LessonPanel {...props(o)} />);
  return { ...r, sent, state, setEngine, update: (p: Opts) => r.rerender(<LessonPanel {...props(p)} />) };
}

const input = () => screen.queryByRole('textbox', { name: 'Фраза тренеру' }) as HTMLInputElement | null;
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const history = () => screen.getByTestId('lesson-history');

describe('LessonPanel: input', () => {
  it('Enter sends lessonSay with trimmed text and clears the field; empty is not sent', () => {
    const { sent } = show();
    expect(input()!.maxLength).toBe(500);
    expect(input()!.placeholder).toBe('Ход на доске или короткая фраза');
    fireEvent.change(input()!, { target: { value: '   ' } });
    fireEvent.keyDown(input()!, { key: 'Enter' });
    expect(sent).toEqual([]);
    fireEvent.change(input()!, { target: { value: '  боюсь связки  ' } });
    fireEvent.keyDown(input()!, { key: 'Enter' });
    expect(sent).toEqual([{ event: 'lessonSay', data: { text: 'боюсь связки' } }]);
    expect(input()!.value).toBe('');
    fireEvent.change(input()!, { target: { value: 'кнопкой' } });
    fireEvent.click(button('отправить')!);
    expect(sent.at(-1)).toEqual({ event: 'lessonSay', data: { text: 'кнопкой' } });
  });

  it('input is disabled in phases coach and done and when the assistant is offline', () => {
    const { update, sent } = show({ cursor: e4, lesson: { phase: 'coach' } });
    expect(input()!.disabled).toBe(true);
    expect(input()!.placeholder).toBe('Подожди, тренер отвечает');
    expect(button('отправить')!.disabled).toBe(true);
    update({ lesson: { online: false } });
    expect(input()!.disabled).toBe(true);
    expect(input()!.placeholder).toBe('Помощник не подключён');
    fireEvent.keyDown(input()!, { key: 'Enter' });
    update({ lesson: { phase: 'done', status: 'done', summary: 'Итог.' } });
    expect(input()).toBeNull();
    update({ connected: false });
    expect(input()!.disabled).toBe(true);
    // после «почему?» подсказка другая
    update({ cursor: e4, lesson: { node: e4, verdict: { kind: 'correct', score: { cp: 50 } } } });
    expect(input()!.placeholder).toBe('Ответь фразой или покажи ход на доске');
    expect(sent).toEqual([]);
  });
});

describe('LessonPanel: history', () => {
  it('coach bubbles left with the verdict merged into the next say, student right, move chip, typing in phase coach', () => {
    const transcript = [
      said('coach', 'say', 'У тебя была 21 секунда.'),
      said('coach', 'say', 'Что сыграешь?'),
      said('student', 'move', '25.Nd3'),
      said('coach', 'verdict', 'Ошибка'),
      said('coach', 'say', 'Конь ушёл, и поле e5 осталось без защиты.'),
      said('student', 'say', 'а если слоном?'),
    ];
    const { update } = show({ cursor: e4, lesson: { phase: 'coach', transcript } });
    const items = Array.from(history().querySelectorAll('[data-entry]'));
    expect(items.map((i) => i.getAttribute('data-entry'))).toEqual(['coach', 'coach', 'move', 'coach', 'student', 'typing']);
    expect(items[2].textContent).toBe('ход на доске 25.Nd3');
    expect(items[3].querySelector('.badge')!.textContent).toBe('Ошибка');
    expect(items[3].textContent).toContain('Конь ушёл');
    expect(items[4].textContent).toBe('а если слоном?');
    expect(items[5].textContent).toContain('Тренер отвечает');
    // вердикт без реплики (ответ ещё не пришёл) - отдельный пузырь с одной плашкой
    update({ cursor: e4, lesson: { phase: 'coach', transcript: [...transcript.slice(0, 3), said('coach', 'verdict', 'Верно')] } });
    const last = Array.from(history().querySelectorAll('[data-entry="coach"]')).at(-1)!;
    expect(last.textContent).toBe('Верно');
  });

  it('verdict badge class follows verdict.kind', () => {
    const words = { correct: 'Верно', weaker: 'Неплохо, но есть сильнее', wrong: 'Ошибка', unavailable: 'Не могу проверить ход: движок недоступен' };
    show({ lesson: { transcript: Object.values(words).flatMap((w) => [said('coach', 'verdict', w), said('coach', 'say', 'Текст.')]) } });
    const badges = Array.from(history().querySelectorAll('.badge'));
    expect(badges.map((x) => x.className)).toEqual(Object.keys(words).map((k) => `badge badge-${k}`));
  });

  it('scrolls to the bottom on new entries', () => {
    const { update } = show({ lesson: { transcript: [said('coach', 'say', 'Раз.')] } });
    const el = history();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 900 });
    el.scrollTop = 0;
    update({ lesson: { transcript: [said('coach', 'say', 'Раз.'), said('student', 'say', 'Два')] } });
    expect(el.scrollTop).toBe(900);
    // запись не добавилась, но над историей поменялась полоса (пришёл анализ): история снова внизу
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1200 });
    update({ analysis: ready(b.rootId), lesson: { transcript: [said('coach', 'say', 'Раз.'), said('student', 'say', 'Два')] } });
    expect(el.scrollTop).toBe(1200);
  });
});

describe('LessonPanel: buttons', () => {
  const wrong = { kind: 'wrong' as const, score: { cp: -110 } };
  const transcript = [said('student', 'move', '1.e4'), said('coach', 'verdict', 'Ошибка'), said('coach', 'say', 'Смотри.')];

  it('feedback: "Попробовать другой ход" after a wrong verdict, "К позиции" after info; both send lessonRetry; "Повторить показ" replays locally', () => {
    const restart = vi.fn();
    const replay = { ...IDLE, restart };
    const { sent, update } = show({ cursor: nf3, replay, lesson: { phase: 'feedback', verdict: wrong, transcript, replay: { from: e4, to: nf3, id: 1 } } });
    // кнопки стоят в истории сразу под последней репликой тренера
    const actions = within(history()).getByTestId('lesson-actions');
    expect(actions.previousElementSibling!.getAttribute('data-entry')).toBe('coach');
    fireEvent.click(button('Попробовать другой ход')!);
    fireEvent.click(button('Повторить показ')!);
    expect(button('К позиции')).toBeNull();
    expect(restart).toHaveBeenCalledTimes(1);
    for (const kind of ['weaker', 'unavailable'] as const) {
      update({ cursor: e4, lesson: { phase: 'feedback', verdict: { kind } } });
      expect(button('Попробовать другой ход')).not.toBeNull();
    }
    // показ без ошибки, без replay - нет «Повторить показ»
    update({ cursor: e4, lesson: { phase: 'feedback', verdict: { kind: 'info' } } });
    expect(button('Повторить показ')).toBeNull();
    fireEvent.click(button('К позиции')!);
    expect(sent).toEqual([
      { event: 'lessonRetry', data: {} },
      { event: 'lessonRetry', data: {} },
    ]);
    // во время показа и без связи кнопки выключены
    update({ cursor: nf3, replay: { ...IDLE, replaying: true, shownNode: e5, step: 1, total: 2 }, lesson: { phase: 'feedback', verdict: wrong, replay: { from: e4, to: nf3, id: 1 } } });
    expect(button('Попробовать другой ход')!.disabled).toBe(true);
    expect(button('Повторить показ')!.disabled).toBe(true);
    update({ cursor: nf3, connected: false, lesson: { phase: 'feedback', verdict: wrong } });
    expect(button('Попробовать другой ход')!.disabled).toBe(true);
  });

  it('pause: "Дальше" sends lessonNext; done: summary and the back-to-chat line', () => {
    const { sent, update } = show({ cursor: e4, lesson: { phase: 'pause', node: e4, transcript: [said('coach', 'say', 'Позиция решена.')] } });
    expect(button('Попробовать другой ход')).toBeNull();
    fireEvent.click(button('Дальше')!);
    expect(sent).toEqual([{ event: 'lessonNext', data: {} }]);
    update({ cursor: e4, lesson: { phase: 'pause', online: false } });
    expect(button('Дальше')!.disabled).toBe(true);
    update({
      cursor: e4,
      lesson: { phase: 'done', status: 'done', index: 2, total: 3, summary: 'Ты стал проверять ответ.', transcript: [said('coach', 'say', 'Позиция решена.')] },
    });
    const done = screen.getByTestId('lesson-done');
    expect(done.querySelector('.badge')!.textContent).toBe('Верно');
    expect(done.textContent).toContain('Позиция 3 из 3 решена');
    expect(done.textContent).toContain('Ты стал проверять ответ.');
    expect(done.textContent).toContain('Возвращайся в чат: напиши тренеру, что закончил.');
    expect(done.querySelector('.bubble-foot')!.textContent).toBe('Возвращайся в чат: напиши тренеру, что закончил.');
    expect(done.textContent).not.toContain('Позиция решена.');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(input()).toBeNull();
  });
});

describe('lessonLayout', () => {
  it('board size: 630x860 stack with board 456, 1280x760 columns with board 688 and column 512', () => {
    expect(NARROW).toMatchObject({ mode: 'stack', board: 456, panel: 320 });
    expect(WIDE).toMatchObject({ mode: 'columns', board: 688, column: 512, panel: 688 });
    // доска не меньше 280 и кратна 8
    expect(lessonLayout(300, 400).board).toBe(280);
    expect(lessonLayout(1000, 803).board % 8).toBe(0);
    // три линии движка, только если истории остаётся от 200
    expect(WIDE.fullStrip).toBe(true);
    expect(NARROW.fullStrip).toBe(false);
  });
});

describe('LessonPanel: engine strip', () => {
  const strip = () => screen.getByTestId('engine-strip');
  const wrongTranscript = [said('student', 'move', '1.e4'), said('coach', 'verdict', 'Ошибка'), said('coach', 'say', 'Смотри.')];

  it('engine strip: closed in student and coach; after wrong only the refutation; after correct three lines or one row', () => {
    const { update } = show({ analysis: ready(b.rootId) });
    expect(strip().textContent).toContain('Движок скрыт, пока ты думаешь над ходом');
    expect(screen.queryByTestId('strip-lines')).toBeNull();
    update({ cursor: e4, analysis: ready(e4), lesson: { phase: 'coach' } });
    expect(strip().textContent).toContain('Оценка появится вместе с ответом');
    // вердикт уже пришёл, шкала у доски есть, линий нет до ответа
    update({ cursor: e4, analysis: ready(e4), lesson: { phase: 'coach', verdict: { kind: 'wrong', score: { cp: -110 } } } });
    expect(strip().textContent).toContain('Линии появятся вместе с ответом');
    expect(screen.queryByTestId('strip-lines')).toBeNull();

    // после ошибки: оценка и показанное опровержение, линий движка нет
    const wrong = { phase: 'feedback' as const, verdict: { kind: 'wrong' as const, score: { cp: -110 } }, transcript: wrongTranscript };
    update({ cursor: nf3, analysis: ready(nf3), lesson: { ...wrong, replay: { from: e4, to: nf3, id: 1 } } });
    expect(screen.getByTestId('strip-refutation').textContent).toBe('−1.1 1...e5 2.Nf3');
    expect(screen.queryByTestId('strip-lines')).toBeNull();
    expect(strip().textContent).not.toContain('2.d4');
    // показ тренера на фразу ученика (вердикта нет или info): только оценка и показанная линия, ход ещё не найден
    const demo = { phase: 'feedback' as const, transcript: [said('student', 'say', 'а что тут?'), said('coach', 'say', 'Смотри.')], replay: { from: e4, to: nf3, id: 2 } };
    for (const verdict of [undefined, { kind: 'info' as const }]) {
      update({ cursor: nf3, analysis: ready(nf3), lesson: { ...demo, verdict } });
      expect(screen.getByTestId('strip-refutation').textContent).toBe('+1.2 1...e5 2.Nf3');
      expect(screen.queryByTestId('strip-lines')).toBeNull();
    }
    // в разборе после «Верно» в этой позиции линии открыты
    update({ cursor: nf3, analysis: ready(nf3), lesson: { ...demo, transcript: [said('coach', 'verdict', 'Верно'), ...demo.transcript] } });
    expect(screen.getByTestId('strip-lines').querySelectorAll('li')).toHaveLength(3);
    // позиция решена (pause) - линии открыты и после прошлой ошибки
    update({ cursor: e4, analysis: ready(e4), lesson: { phase: 'pause', verdict: { kind: 'correct', score: { cp: 30 } }, transcript: [...wrongTranscript, said('coach', 'verdict', 'Верно')] } });
    expect(screen.getByTestId('strip-lines').querySelectorAll('li')).toHaveLength(3);

    // после верного хода: три линии и заголовок с глубиной на широком окне, одна строка на узком
    const correct = { phase: 'pause' as const, verdict: { kind: 'correct' as const, score: { cp: 120 } }, transcript: [said('coach', 'verdict', 'Верно')] };
    update({ cursor: e4, analysis: ready(e4), lesson: correct });
    expect(strip().textContent).toContain('Stockfish 19 · глубина 22');
    expect(screen.getByTestId('strip-lines').querySelectorAll('li')).toHaveLength(3);
    update({ cursor: e4, analysis: ready(e4), lesson: correct, layout: NARROW });
    expect(screen.queryByTestId('strip-lines')).toBeNull();
    expect(screen.getByTestId('strip-row').textContent).toBe('+1.2 2.Nf3 Nc6');
    expect(strip().querySelector('.strip-depth')!.textContent).toBe('гл. 22');
    // анализ другого узла не показывается
    update({ cursor: e4, analysis: ready(b.rootId), lesson: correct, layout: NARROW });
    expect(screen.getByTestId('strip-row').textContent).toBe('…');
  });

  it('the strip shows the replayed line with the current move during a replay; the toggle hides the lines', () => {
    const replaying: ReplayView = { ...IDLE, replaying: true, shownNode: e5, step: 1, total: 2 };
    const { update, setEngine } = show({
      cursor: nf3,
      replay: replaying,
      lesson: { phase: 'feedback', verdict: { kind: 'wrong', score: { cp: -110 } }, replay: { from: e4, to: nf3, id: 1 } },
    });
    const moves = screen.getByTestId('strip-replay').querySelectorAll('.strip-move');
    expect(Array.from(moves).map((m) => m.textContent)).toEqual(['1...e5', '2.Nf3']);
    expect(moves[0].className).toBe('strip-move current');
    expect(moves[1].className).toBe('strip-move rest');
    expect(screen.getByTestId('strip-replay').querySelector('.line-eval')!.textContent).toBe('−1.1');
    // во время показа переключатель заблокирован и выглядит выключенным
    const locked = screen.getByRole('switch', { name: 'Движок' }) as HTMLInputElement;
    expect(locked.disabled).toBe(true);
    expect(locked.checked).toBe(false);
    const correct = { phase: 'pause' as const, verdict: { kind: 'correct' as const, score: { cp: 120 } } };
    update({ cursor: e4, analysis: ready(e4), lesson: correct, engineOn: false });
    expect(screen.queryByTestId('strip-lines')).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Движок' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(setEngine).toHaveBeenCalledWith(true);
  });

  it('the toggle is locked while the student thinks and the coach answers, available without the assistant', () => {
    const toggle = () => screen.getByRole('switch', { name: 'Движок' }) as HTMLInputElement;
    const { update } = show();
    expect(toggle().disabled).toBe(true);
    expect(toggle().checked).toBe(false);
    expect(toggle().closest('label')!.className).toContain('locked');
    update({ cursor: e4, lesson: { phase: 'coach', verdict: { kind: 'wrong', score: { cp: -110 } } } });
    expect(toggle().disabled).toBe(true);
    update({ lesson: { online: false }, engineOn: false });
    expect(toggle().disabled).toBe(false);
    expect(toggle().checked).toBe(false);
    update({ cursor: e4, lesson: { phase: 'pause' } });
    expect(toggle().disabled).toBe(false);
    expect(toggle().checked).toBe(true);
  });

  it('without the assistant the game moves stand in the column instead of the history', () => {
    const game = { white: 'Наби', black: 'Соперник', moves: ['e4', 'e5', 'Nf3'] };
    const { update } = show({ lesson: { online: false, game, transcript: [said('coach', 'say', 'Что сыграешь?')] } });
    expect(screen.queryByTestId('lesson-history')).toBeNull();
    const list = screen.getByTestId('game-moves');
    expect(list.querySelector('.game-title')!.textContent).toBe('Ходы партии · Наби - Соперник');
    const rows = Array.from(list.querySelectorAll('tr')).map((tr) => Array.from(tr.cells).map((c) => c.textContent));
    expect(rows).toEqual([
      ['1.', 'e4', 'e5'],
      ['2.', 'Nf3', ''],
    ]);
    expect(list.querySelector('.current')!.textContent).toBe('Nf3');
    update({ lesson: { game, transcript: [said('coach', 'say', 'Что сыграешь?')] } });
    expect(history().textContent).toContain('Что сыграешь?');
  });
});
