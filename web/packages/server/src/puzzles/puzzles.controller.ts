import { Body, Controller, Get, HttpCode, Post, Query, UseFilters } from '@nestjs/common';
import type { PuzzleNextBody, PuzzleNextResponse, PuzzleStats } from '@board/shared';
import { BoardErrorFilter } from '../board/board-error.filter';
import { PuzzlesService } from './puzzles.service';

@Controller('api/puzzles')
@UseFilters(BoardErrorFilter)
export class PuzzlesController {
  constructor(private readonly puzzles: PuzzlesService) {}

  @Post('next')
  @HttpCode(200)
  next(@Body() body: PuzzleNextBody): Promise<PuzzleNextResponse> {
    return this.puzzles.next(body ?? {});
  }

  @Get('stats')
  stats(@Query('since') since?: string): Promise<PuzzleStats> {
    return this.puzzles.stats(since);
  }
}
