import { Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import {
  validateLessonReplyBody,
  validateLessonStartBody,
  validateLessonVerdictBody,
  type BoardState,
  type LessonReplyBody,
  type LessonStartBody,
  type LessonVerdictBody,
} from '@board/shared';
import { BoardErrorFilter } from '../board/board-error.filter';
import { BoardService } from '../board/board.service';
import { validated } from '../board/validated';

/** Занятие у доски: ручки помощника (`coach lesson ...`). Все отвечают состоянием доски. */
@Controller('api/lesson')
@UseFilters(BoardErrorFilter)
export class LessonController {
  constructor(private readonly board: BoardService) {}

  @Post('start')
  @HttpCode(200)
  start(@Body() body: unknown): Promise<BoardState> {
    return this.board.startLesson(validated<LessonStartBody>(body, validateLessonStartBody));
  }

  @Post('verdict')
  @HttpCode(200)
  verdict(@Body() body: unknown): Promise<BoardState> {
    return this.board.lessonVerdict(validated<LessonVerdictBody>(body, validateLessonVerdictBody));
  }

  @Post('reply')
  @HttpCode(200)
  reply(@Body() body: unknown): Promise<BoardState> {
    return this.board.lessonReply(validated<LessonReplyBody>(body, validateLessonReplyBody));
  }

  @Post('stop')
  @HttpCode(200)
  stop(): Promise<BoardState> {
    return this.board.stopLesson();
  }
}
