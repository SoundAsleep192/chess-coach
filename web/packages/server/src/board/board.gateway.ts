import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, WebSocket } from 'ws';
import type { DeleteBranchData, MoveData, NavigateData, ServerMessage } from '@board/shared';
import { PanelService } from '../panel/panel.service';
import { BoardError } from './board-error';
import { BoardService } from './board.service';
import { allowedOrigins, originAllowed } from './origin';

@WebSocketGateway({
  path: '/ws',
  // Рукопожатие с чужой страницы отклоняется до подключения (403).
  verifyClient: (info: { origin?: string }, done: (ok: boolean, code?: number, message?: string) => void) =>
    originAllowed(info.origin || undefined, allowedOrigins()) ? done(true) : done(false, 403, 'Forbidden origin'),
})
export class BoardGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly board: BoardService,
    private readonly panel: PanelService,
  ) {}

  afterInit(): void {
    this.board.changes.subscribe((state) => this.broadcast({ event: 'state', data: state }));
    this.panel.analysis.subscribe((data) => this.broadcast({ event: 'analysis', data }));
  }

  handleConnection(client: WebSocket): void {
    this.send(client, { event: 'state', data: this.board.current });
    const latest = this.panel.latest();
    if (latest && latest.nodeId === this.board.current.cursor) this.send(client, { event: 'analysis', data: latest });
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
