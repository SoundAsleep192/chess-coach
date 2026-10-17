import { Body, Controller, Get, HttpCode, Post, UseFilters } from '@nestjs/common';
import { validateInboxAckBody, type InboxAckBody, type InboxResponse } from '@board/shared';
import { BoardErrorFilter } from '../board/board-error.filter';
import { BoardService } from '../board/board.service';
import { validated } from '../board/validated';
import { InboxService } from './inbox.service';

@Controller('api/inbox')
@UseFilters(BoardErrorFilter)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly board: BoardService,
  ) {}

  @Get()
  read(): Promise<InboxResponse> {
    return this.inbox.read(this.board.current);
  }

  @Post('ack')
  @HttpCode(200)
  async ack(@Body() body: unknown): Promise<{ ok: true }> {
    await this.inbox.ack(validated<InboxAckBody>(body, validateInboxAckBody).upto);
    return { ok: true };
  }
}
