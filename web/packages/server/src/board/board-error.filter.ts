import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { BoardError, HTTP_STATUS } from './board-error';
import { BoardService } from './board.service';

@Catch(BoardError)
export class BoardErrorFilter implements ExceptionFilter {
  constructor(private readonly board: BoardService) {}

  catch(error: BoardError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HTTP_STATUS[error.code]).json({
      code: error.code,
      message: error.message,
      version: this.board.current.version,
    });
  }
}
