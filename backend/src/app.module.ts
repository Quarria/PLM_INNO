import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import * as entities from './entities';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { databaseConnectionConfig } from './database-config';
import { AuthGuard } from './auth.guard';
import { OpsDatabase } from './ops-database';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        ...databaseConnectionConfig(),
        entities: Object.values(entities),
        synchronize: false,
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
  controllers: [ApiController, InventoryController, CommerceController],
  providers: [ApiService, OpsDatabase, InventoryService, CommerceService, AuthGuard, { provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
