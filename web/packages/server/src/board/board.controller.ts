import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import {
  validateAddLineBody,
  validateCursorBody,
  validateModeBody,
  validatePanelBody,
  validateReplaceBody,
  type AddLineBody,
  type BoardState,
  type CursorBody,
  type ModeBody,
  type PanelBody,
  type ReplaceBody,
} from '@board/shared';
import { BoardErrorFilter } from './board-error.filter';
import { BoardService } from './board.service';
import { validated } from './validated';

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
  replace(@Body() body: unknown): Promise<BoardState> {
    return this.board.replace(validated<ReplaceBody>(body, validateReplaceBody));
  }

  @Post('board/lines')
  @HttpCode(200)
  addLine(@Body() body: unknown): Promise<BoardState> {
    return this.board.addCoachLine(validated<AddLineBody>(body, validateAddLineBody));
  }

  @Patch('board/cursor')
  cursor(@Body() body: unknown): Promise<BoardState> {
    return this.board.setCursor(validated<CursorBody>(body, validateCursorBody));
  }

  @Patch('board/mode')
  mode(@Body() body: unknown): Promise<BoardState> {
    return this.board.setMode(validated<ModeBody>(body, validateModeBody).mode);
  }

  @Patch('board/panel')
  panel(@Body() body: unknown): Promise<BoardState> {
    return this.board.setPanel(validated<PanelBody>(body, validatePanelBody));
  }

  @Delete('board/nodes/:id')
  remove(@Param('id') id: string): Promise<BoardState> {
    return this.board.deleteNode(id);
  }
}
