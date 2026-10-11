import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';

/** Общая настройка для main.ts и тестов: WebSocket-адаптер, размер тела, статика клиента. */
export function configureApp(app: NestExpressApplication): void {
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useBodyParser('json', { limit: '2mb' });
  const clientDir = process.env.CLIENT_DIR ?? join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDir)) app.useStaticAssets(clientDir);
}
