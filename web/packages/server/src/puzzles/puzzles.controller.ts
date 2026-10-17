import { Body, Controller, Get, HttpCode, Post, Query, UseFilters } from '@nestjs/common';
import { validatePuzzleNextBody, type PuzzleNextBody, type PuzzleNextResponse, type PuzzleStats } from '@board/shared';
import { BoardErrorFilter } from '../board/board-error.filter';
import { validated } from '../board/validated';
import { PuzzlesService } from './puzzles.service';

@Controller('api/puzzles')
@UseFilters(BoardErrorFilter)
export class PuzzlesController {
  constructor(private readonly puzzles: PuzzlesService) {}

  @Post('next')
  @HttpCode(200)
  next(@Body() body: unknown): Promise<PuzzleNextResponse> {
    return this.puzzles.next(validated<PuzzleNextBody>(body ?? {}, validatePuzzleNextBody));
  }

  @Get('stats')
  stats(@Query('since') since?: string): Promise<PuzzleStats> {
    return this.puzzles.stats(since);
  }
}
