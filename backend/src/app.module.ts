import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import * as entities from './entities';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        schema: config.get<string>('DB_SCHEMA') || 'plm',
        entities: Object.values(entities),
        synchronize: false,
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: true } : false,
        extra: config.get<string>('DB_MODE', 'pglite') === 'pglite' ? { max: 1 } : {},
        retryAttempts: 2,
        retryDelay: 1500,
      }),
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: (() => {
          const secret = config.get<string>('JWT_SECRET');
          if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
          return secret;
        })(),
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [ApiController],
  providers: [ApiService, AuthGuard, { provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
