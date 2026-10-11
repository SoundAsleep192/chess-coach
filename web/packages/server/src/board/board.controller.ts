import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import type { AddLineBody, BoardState, CursorBody, ModeBody, ReplaceBody } from '@board/shared';
import { BoardErrorFilter } from './board-error.filter';
import { BoardService } from './board.service';

@Controller('api')
@UseFilters(BoardErrorFilter)
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get('health')
  async health(@Res() res: Response): Promise<void> {
    const ok = await this.board.health();
    res.status(ok ? 200 : 503).json({ ok });
  }

  @Get('board')
  get(): BoardState {
    return this.board.current;
  }

  @Get('board/pgn')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  pgn(): string {
    return this.board.pgn();
  }

  @Put('board')
  replace(@Body() body: ReplaceBody): Promise<BoardState> {
    return this.board.replace(body);
  }

  @Post('board/lines')
  @HttpCode(200)
  addLine(@Body() body: AddLineBody): Promise<BoardState> {
    return this.board.addCoachLine(body);
  }

  @Patch('board/cursor')
  cursor(@Body() body: CursorBody): Promise<BoardState> {
    return this.board.setCursor(body);
  }

  @Patch('board/mode')
  mode(@Body() body: ModeBody): Promise<BoardState> {
    return this.board.setMode(body.mode);
  }

  @Delete('board/nodes/:id')
  remove(@Param('id') id: string): Promise<BoardState> {
    return this.board.deleteNode(id);
  }
}
