import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleAuthRepository } from './google/google-auth.repository';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleOidcClient } from './google/google-oidc.client';
import { OauthTransactionCipher } from './google/oauth-transaction-cipher';
import { MfaController } from './mfa/mfa.controller';
import { MfaRepository } from './mfa/mfa.repository';
import { MfaSecretCipher } from './mfa/mfa-secret-cipher';
import { MfaService } from './mfa/mfa.service';
import { RecoveryCodeService } from './mfa/recovery-code.service';
import { TotpService } from './mfa/totp.service';
import { AccessTokenService } from './services/access-token.service';
import { AuthRateLimiterService } from './services/auth-rate-limiter.service';
import { AuthenticationResponseService } from './services/authentication-response.service';
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
  controllers: [AuthController, GoogleAuthController, MfaController],
  providers: [
    AuthRepository,
    AuthService,
    GoogleAuthRepository,
    GoogleAuthService,
    GoogleOidcClient,
    OauthTransactionCipher,
    MfaRepository,
    MfaSecretCipher,
    MfaService,
    RecoveryCodeService,
    TotpService,
    AccessTokenService,
    AuthRateLimiterService,
    AuthenticationResponseService,
    CookieOriginService,
    SessionService,
  ],
  exports: [AccessTokenService, SessionService],
})
export class AuthModule {}
