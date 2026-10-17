import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisData, BoardState, ClientMessage, ErrorPayload, ServerMessage } from '@board/shared';

export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = () => SocketLike;

export const OPEN = 1;
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10000;

export function defaultSocketUrl(loc: Location = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

const browserSocket: SocketFactory = () => new WebSocket(defaultSocketUrl()) as unknown as SocketLike;

export interface BoardSocket {
  state: BoardState | null;
  connected: boolean;
  error: ErrorPayload | null;
  /** Последнее сообщение analysis; сбрасывается при переподключении. */
  analysis: AnalysisData | null;
  send(msg: ClientMessage): void;
}

export function useBoardSocket(factory: SocketFactory = browserSocket): BoardSocket {
  const [state, setState] = useState<BoardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const socketRef = useRef<SocketLike | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      // Версия отслеживается в пределах одного соединения: после перезапуска сервера
      // или пересоздания базы первое состояние принимается всегда.
      let lastVersion = 0;
      setAnalysis(null);
      const ws = factory();
      socketRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.event === 'state') {
          if (msg.data.version < lastVersion) return;
          lastVersion = msg.data.version;
          setState(msg.data);
        } else if (msg.event === 'analysis') {
          setAnalysis(msg.data);
        } else if (msg.event === 'error') {
          setError(msg.data);
        }
      };
      ws.onclose = () => {
        // Сокет, закрытый очисткой эффекта (двойной монтаж в StrictMode), не должен
        // ни сбрасывать «на связи» у живого сокета, ни планировать переподключение.
        if (stopped) return;
        setConnected(false);
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(open, delay);
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [factory]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    setError(null);
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, connected, error, send, analysis };
}
