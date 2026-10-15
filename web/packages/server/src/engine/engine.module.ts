import { Module } from '@nestjs/common';
import { DEFAULT_ENGINE_URL, EngineClient } from '@board/shared';
import { AnalysisService, ENGINE_CLIENT } from './analysis.service';

@Module({
  providers: [
    {
      provide: ENGINE_CLIENT,
      useFactory: () =>
        new EngineClient(process.env.ENGINE_URL ?? DEFAULT_ENGINE_URL, {
          priority: 'interactive',
          timeoutMs: Number(process.env.ENGINE_TIMEOUT_MS ?? 30_000),
        }),
    },
    AnalysisService,
  ],
  exports: [AnalysisService],
})
export class EngineModule {}
