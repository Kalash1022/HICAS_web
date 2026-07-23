import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrimaryAuthMethod, UserStatus } from '@prisma/client';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { AuthRepository, type PrimaryAuthenticationProof } from '../auth.repository';
import type {
  AuthenticationResult,
  RequestContext,
  SessionAuthenticationResult,
} from '../auth.types';
import { createOpaqueToken, hashOpaqueToken } from '../utilities/auth-crypto';
import { AccessTokenService } from './access-token.service';

@Injectable()
export class SessionService {
  private readonly refreshTtlDays: number;
  private readonly mfaChallengeTtlSeconds: number;

  constructor(
    private readonly repository: AuthRepository,
    private readonly accessTokens: AccessTokenService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    this.mfaChallengeTtlSeconds = config.getOrThrow<number>('MFA_CHALLENGE_TTL_SECONDS');
  }

  beginPasswordAuthentication(
    userId: string,
    passwordHash: string,
    context: RequestContext,
  ): Promise<AuthenticationResult> {
    return this.beginPrimaryAuthentication(
      userId,
      {
        method: PrimaryAuthMethod.PASSWORD,
        passwordHash,
      },
      context,
    );
  }

  beginGoogleAuthentication(
    userId: string,
    providerAccountId: string,
    context: RequestContext,
  ): Promise<AuthenticationResult> {
    return this.beginPrimaryAuthentication(
      userId,
      {
        method: PrimaryAuthMethod.GOOGLE,
        providerAccountId,
      },
      context,
    );
  }

  private async beginPrimaryAuthentication(
    userId: string,
    proof: PrimaryAuthenticationProof,
    context: RequestContext,
  ): Promise<AuthenticationResult> {
    const result = await this.repository.beginPrimaryAuthentication({
      userId,
      proof,
      context,
      refreshTtlDays: this.refreshTtlDays,
      mfaChallengeTtlSeconds: this.mfaChallengeTtlSeconds,
      now: new Date(),
    });

    if (result.kind === 'status-rejected') {
      this.throwForStatus(result.status);
    }
    if (result.kind === 'credentials-changed') {
      if (proof.method === PrimaryAuthMethod.GOOGLE) {
        throw new ApplicationException(
          HttpStatus.UNAUTHORIZED,
          'OAUTH_IDENTITY_INVALID',
          'The Google identity is no longer available. Start sign-in again.',
        );
      }
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_INVALID_CREDENTIALS',
        'Email or password is incorrect.',
      );
    }
    if (result.kind === 'mfa-enrollment') {
      return {
        kind: 'mfa-enrollment',
        mfaEnrollmentRequired: true,
        enrollmentToken: result.enrollmentToken,
        expiresIn: result.expiresIn,
      };
    }
    if (result.kind === 'mfa-challenge') {
      return {
        kind: 'mfa-challenge',
        mfaRequired: true,
        mfaToken: result.mfaToken,
        expiresIn: result.expiresIn,
      };
    }

    return this.completeAuthentication(result);
  }

  async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<SessionAuthenticationResult> {
    const result = await this.repository.rotateRefreshToken({
      refreshTokenHash: hashOpaqueToken(refreshToken),
      newRefreshToken: createOpaqueToken(),
      refreshTtlDays: this.refreshTtlDays,
      context,
      now: new Date(),
    });

    if (result.kind === 'reuse') {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REFRESH_TOKEN_REUSED',
        'Refresh token reuse was detected. Sign in again.',
      );
    }
    if (result.kind === 'status-rejected') {
      this.throwForStatus(result.status);
    }
    if (result.kind === 'invalid') {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REFRESH_TOKEN_INVALID',
        'The refresh token is invalid or expired.',
      );
    }

    return this.completeAuthentication(result);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.repository.revokeRefreshToken(hashOpaqueToken(refreshToken), new Date());
  }

  async completeAuthentication(input: {
    sessionId: string;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    user: SessionAuthenticationResult['user'];
  }): Promise<SessionAuthenticationResult> {
    const accessToken = await this.accessTokens.sign({
      userId: input.user.id,
      sessionId: input.sessionId,
      role: input.user.role,
    });

    return {
      kind: 'session',
      accessToken,
      accessTokenExpiresIn: this.accessTokens.expiresInSeconds,
      refreshToken: input.refreshToken,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      user: input.user,
    };
  }

  private throwForStatus(status: UserStatus): never {
    if (status === UserStatus.BLOCKED) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_ACCOUNT_BLOCKED',
        'This account has been blocked.',
      );
    }

    throw new ApplicationException(
      HttpStatus.FORBIDDEN,
      'AUTH_EMAIL_NOT_VERIFIED',
      'Verify your email before signing in.',
    );
  }
}
