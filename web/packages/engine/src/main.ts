import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8766);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`engine: http://${host}:${port}`);
}

void bootstrap();
