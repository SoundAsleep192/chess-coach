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
import { BoardError } from './board-error';
import { BoardService } from './board.service';

@WebSocketGateway({ path: '/ws' })
export class BoardGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly board: BoardService) {}

  afterInit(): void {
    this.board.changes.subscribe((state) => this.broadcast({ event: 'state', data: state }));
  }

  handleConnection(client: WebSocket): void {
    this.send(client, { event: 'state', data: this.board.current });
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
