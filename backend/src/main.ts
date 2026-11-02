import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { startLocalDatabase } from './local-database';

async function bootstrap() {
  const mode = process.env.DB_MODE || 'pglite';
  if (!['pglite', 'postgres'].includes(mode)) throw new Error('DB_MODE must be pglite or postgres');
  const closeDatabase = mode === 'pglite' ? await startLocalDatabase() : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'], credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const frontendDist = join(__dirname, '../../frontend/dist');
  if (existsSync(frontendDist)) app.useStaticAssets(frontendDist);
  const mediaDir = process.env.MEDIA_DIR || join(process.cwd(), 'data', 'media');
  app.useStaticAssets(mediaDir, { prefix: '/media/' });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`PLM API listening on ${host}:${port}`);
  if (closeDatabase) {
    let closing = false;
    const shutdown = async () => { if (closing) return; closing = true; await app.close(); await closeDatabase(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
bootstrap().catch((error) => { console.error(error); process.exitCode = 1; });
