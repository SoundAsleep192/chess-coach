import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Chess } from 'chess.js';
import type { AnalyseRequest, AnalyseResponse, EngineHealth, EnginePriority } from '@board/shared';
import { EnginePool, MAX_NODES, QueueFull } from './pool';

const PRIORITIES: EnginePriority[] = ['interactive', 'batch'];

function intIn(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
}

/** Проверка тела запроса; заодно возвращает позицию, чтобы не разбирать FEN дважды. */
export function parseRequest(body: unknown): { req: AnalyseRequest; chess: Chess } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (typeof b.fen !== 'string') throw new BadRequestException('fen must be a string');
  let chess: Chess;
  try {
    chess = new Chess(b.fen);
  } catch (e) {
    throw new BadRequestException(`bad FEN: ${(e as Error).message}`);
  }
  if (b.multipv !== undefined && !intIn(b.multipv, 1, 5)) throw new BadRequestException('multipv must be an integer 1..5');
  if (b.nodes !== undefined && !intIn(b.nodes, 1, MAX_NODES)) throw new BadRequestException(`nodes must be an integer 1..${MAX_NODES}`);
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority as EnginePriority)) {
    throw new BadRequestException('priority must be interactive or batch');
  }
  const req: AnalyseRequest = { fen: b.fen };
  if (b.multipv !== undefined) req.multipv = b.multipv as number;
  if (b.nodes !== undefined) req.nodes = b.nodes as number;
  if (b.priority !== undefined) req.priority = b.priority as EnginePriority;
  if (b.searchmoves !== undefined) {
    const moves = b.searchmoves;
    if (!Array.isArray(moves) || moves.length === 0 || moves.some((m) => typeof m !== 'string')) {
      throw new BadRequestException('searchmoves must be a non-empty array of UCI moves');
    }
    const legal = new Set(chess.moves({ verbose: true }).map((m) => m.lan));
    const bad = (moves as string[]).find((m) => !legal.has(m));
    if (bad) throw new BadRequestException(`illegal searchmove ${bad} in ${b.fen}`);
    req.searchmoves = moves as string[];
  }
  return { req, chess };
}

@Controller()
export class EngineController {
  constructor(private readonly pool: EnginePool) {}

  @Get('health')
  health(): EngineHealth {
    const health: EngineHealth = { ok: this.pool.alive(), version: this.pool.version, ...this.pool.stats() };
    // без живого процесса сервис не годен: тот же JSON, но код 503
    if (!health.ok) throw new HttpException(health, HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }

  @Post('analyse')
  @HttpCode(200)
  async analyse(@Body() body: unknown): Promise<AnalyseResponse> {
    const { req, chess } = parseRequest(body);
    const nodes = req.nodes ?? this.pool.defaultNodes;
    // мат или пат на доске: ходов нет, движку нечего считать
    if (chess.moves().length === 0) return { fen: req.fen, nodes, lines: [] };
    try {
      return { fen: req.fen, nodes, lines: await this.pool.analyse({ ...req, nodes }) };
    } catch (e) {
      if (e instanceof QueueFull) throw new ServiceUnavailableException(e.message);
      throw new InternalServerErrorException(`engine failed: ${(e as Error).message}`);
    }
  }
}
