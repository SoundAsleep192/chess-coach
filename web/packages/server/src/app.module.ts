import { Module } from '@nestjs/common';
import { BoardController } from './board/board.controller';
import { BoardErrorFilter } from './board/board-error.filter';
import { BoardGateway } from './board/board.gateway';
import { BoardService } from './board/board.service';
import { BoardRepository } from './storage/board-repository';
import { MongoBoardRepository } from './storage/mongo-board-repository';

@Module({
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardGateway,
    BoardErrorFilter,
    { provide: BoardRepository, useClass: MongoBoardRepository },
  ],
})
export class AppModule {}
