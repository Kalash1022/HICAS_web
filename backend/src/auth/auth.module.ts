import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AccessTokenService } from './services/access-token.service';
import { AuthRateLimiterService } from './services/auth-rate-limiter.service';
import { CookieOriginService } from './services/cookie-origin.service';
import { SessionService } from './services/session.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    AccessTokenService,
    AuthRateLimiterService,
    CookieOriginService,
    SessionService,
  ],
  exports: [AccessTokenService, SessionService],
})
export class AuthModule {}
