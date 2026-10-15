import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { poolOptionsFromEnv } from './config';
import { EngineController } from './engine.controller';
import { EnginePool } from './pool';

@Module({
  controllers: [EngineController],
  providers: [{ provide: EnginePool, useFactory: () => EnginePool.start(poolOptionsFromEnv()) }],
})
export class AppModule implements OnApplicationShutdown {
  constructor(private readonly pool: EnginePool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.close();
  }
}
