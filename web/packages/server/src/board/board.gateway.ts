import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server, WebSocket } from 'ws';
import { validateLessonSay, type DeleteBranchData, type LessonSayData, type MoveData, type NavigateData, type ServerMessage } from '@board/shared';
import { PanelService } from '../panel/panel.service';
import { BoardError } from './board-error';
import { validated } from './validated';
import { BoardService } from './board.service';
import { allowedOrigins, originAllowed } from './origin';

/** ?role=assistant в адресе подключения; всё остальное - обычный браузер. */
function roleOf(req?: IncomingMessage): string | null {
  try {
    return new URL(req?.url ?? '', 'http://localhost').searchParams.get('role');
  } catch {
    return null;
  }
}

@WebSocketGateway({
  path: '/ws',
  // Рукопожатие с чужой страницы отклоняется до подключения (403).
  verifyClient: (info: { origin?: string }, done: (ok: boolean, code?: number, message?: string) => void) =>
    originAllowed(info.origin || undefined, allowedOrigins()) ? done(true) : done(false, 403, 'Forbidden origin'),
})
export class BoardGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private stopping = false;

  constructor(
    private readonly board: BoardService,
    private readonly panel: PanelService,
  ) {}

  afterInit(): void {
    this.board.changes.subscribe((state) => this.broadcast({ event: 'state', data: state }));
    this.panel.analysis.subscribe((data) => this.broadcast({ event: 'analysis', data }));
  }

  /** При остановке сервера сокеты закрываются, а база уже закрывается: статус помощника не пишем. */
  onModuleDestroy(): void {
    this.stopping = true;
  }

  handleConnection(client: WebSocket, req?: IncomingMessage): void {
    this.send(client, { event: 'state', data: this.board.current });
    const latest = this.panel.latest();
    if (latest && latest.nodeId === this.board.current.cursor) this.send(client, { event: 'analysis', data: latest });
    if (roleOf(req) === 'assistant') this.trackAssistant(client);
  }

  @SubscribeMessage('navigate')
  navigate(@MessageBody() data: NavigateData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentNavigate(data?.nodeId));
  }

  @SubscribeMessage('move')
  move(@MessageBody() data: MoveData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentMove(data?.parentId, data?.uci));
  }

  @SubscribeMessage('deleteBranch')
  deleteBranch(@MessageBody() data: DeleteBranchData, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentDelete(data?.nodeId));
  }

  @SubscribeMessage('puzzleRetry')
  puzzleRetry(@ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.puzzleRetry());
  }

  @SubscribeMessage('puzzleGiveUp')
  puzzleGiveUp(@ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.puzzleGiveUp());
  }

  @SubscribeMessage('puzzleAnother')
  puzzleAnother(@ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.puzzleAnother());
  }

  @SubscribeMessage('lessonSay')
  lessonSay(@MessageBody() data: unknown, @ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.studentSay(validated<LessonSayData>(data, validateLessonSay).text));
  }

  @SubscribeMessage('lessonRetry')
  lessonRetry(@ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.lessonRetry());
  }

  @SubscribeMessage('lessonNext')
  lessonNext(@ConnectedSocket() client: WebSocket): Promise<void> {
    return this.guard(client, () => this.board.lessonNext());
  }

  /** Сокет помощника занятий считается, пока открыт: занятие знает, есть ли кому отвечать. */
  private trackAssistant(client: WebSocket): void {
    const failed = (e: unknown): void => console.error(`board: cannot update the assistant status: ${String(e)}`);
    this.board.assistantConnected(1).catch(failed);
    client.once('close', () => {
      if (!this.stopping) this.board.assistantConnected(-1).catch(failed);
    });
  }

  private async guard(client: WebSocket, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (e) {
      const code = e instanceof BoardError ? e.code : 'bad_request';
      const message = e instanceof Error ? e.message : String(e);
      this.send(client, { event: 'error', data: { code, message, version: this.board.current.version } });
      this.send(client, { event: 'state', data: this.board.current });
    }
  }

  private send(client: WebSocket, msg: ServerMessage): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    for (const client of this.server.clients) this.send(client, msg);
  }
}
