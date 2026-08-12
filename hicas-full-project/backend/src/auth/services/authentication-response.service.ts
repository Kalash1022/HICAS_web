import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import {
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
} from '../auth.constants';
import type {
  AuthenticationResult,
  PublicAuthenticationResult,
  PublicSessionAuthenticationResult,
  SessionAuthenticationResult,
} from '../auth.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class AuthenticationResponseService {
  private readonly cookieSecure: boolean;

  constructor(config: ConfigService) {
    this.cookieSecure = config.getOrThrow<boolean>('COOKIE_SECURE');
  }

  finishAuthentication(
    result: AuthenticationResult,
    response: Response,
  ): PublicAuthenticationResult {
    if (result.kind === 'mfa-enrollment') {
      return {
        mfaEnrollmentRequired: true,
        enrollmentToken: result.enrollmentToken,
        expiresIn: result.expiresIn,
      };
    }
    if (result.kind === 'mfa-challenge') {
      return {
        mfaRequired: true,
        mfaToken: result.mfaToken,
        expiresIn: result.expiresIn,
      };
    }

    return this.finishSessionAuthentication(result, response);
  }

  finishSessionAuthentication(
    result: SessionAuthenticationResult,
    response: Response,
  ): PublicSessionAuthenticationResult {
    this.setRefreshCookie(response, result);
    return {
      accessToken: result.accessToken,
      expiresIn: result.accessTokenExpiresIn,
      user: result.user,
    };
  }

  disableAuthenticationResponseCaching(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }

  readRefreshToken(request: Request): string | undefined {
    return this.readCookie(request, REFRESH_TOKEN_COOKIE);
  }

  clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.refreshCookieOptions());
  }

  setGoogleStateCookie(response: Response, state: string): void {
    response.cookie(GOOGLE_OAUTH_STATE_COOKIE, state, {
      ...this.googleStateCookieOptions(),
      maxAge: GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS * 1_000,
    });
  }

  readGoogleStateCookie(request: Request): string | undefined {
    return this.readCookie(request, GOOGLE_OAUTH_STATE_COOKIE);
  }

  clearGoogleStateCookie(response: Response): void {
    response.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, this.googleStateCookieOptions());
  }

  private setRefreshCookie(response: Response, result: SessionAuthenticationResult): void {
    response.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, {
      ...this.refreshCookieOptions(),
      expires: result.refreshTokenExpiresAt,
    });
  }

  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
    };
  }

  private googleStateCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth/google/callback',
    };
  }

  private readCookie(request: Request, name: string): string | undefined {
    const cookies: unknown = request.cookies;
    if (!isRecord(cookies)) {
      return undefined;
    }

    const token = cookies[name];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }
}
