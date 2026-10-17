import { Module } from '@nestjs/common';
import { BoardController } from './board/board.controller';
import { BoardErrorFilter } from './board/board-error.filter';
import { BoardGateway } from './board/board.gateway';
import { BoardService } from './board/board.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxRepository } from './inbox/inbox-repository';
import { InboxService } from './inbox/inbox.service';
import { EngineModule } from './engine/engine.module';
import { PanelService } from './panel/panel.service';
import { PuzzleRepository } from './puzzles/puzzle-repository';
import { PuzzleSolver } from './puzzles/puzzle-solver';
import { PuzzlesController } from './puzzles/puzzles.controller';
import { PuzzlesService } from './puzzles/puzzles.service';
import { BoardRepository } from './storage/board-repository';
import { MongoBoardRepository } from './storage/mongo-board-repository';

@Module({
  imports: [EngineModule],
  controllers: [BoardController, PuzzlesController, InboxController],
  providers: [
    BoardService,
    BoardGateway,
    BoardErrorFilter,
    InboxRepository,
    InboxService,
    PanelService,
    PuzzleRepository,
    PuzzleSolver,
    PuzzlesService,
    { provide: BoardRepository, useClass: MongoBoardRepository },
  ],
})
export class AppModule {}
