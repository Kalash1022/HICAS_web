import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { CookieOptions, Request, Response } from 'express';

import { AuthenticationResponseService } from '../services/authentication-response.service';
import { CookieOriginService } from '../services/cookie-origin.service';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';

const STATE = 's'.repeat(43);

describe(GoogleAuthController.name, () => {
  let google: jest.Mocked<GoogleAuthService>;
  let cookieOrigins: jest.Mocked<CookieOriginService>;
  let controller: GoogleAuthController;

  beforeEach(() => {
    google = {
      createAuthorizationUrl: jest.fn(),
      callback: jest.fn(),
    } as unknown as jest.Mocked<GoogleAuthService>;
    cookieOrigins = {
      assertTrusted: jest.fn(),
    } as unknown as jest.Mocked<CookieOriginService>;
    controller = new GoogleAuthController(
      google,
      cookieOrigins,
      new AuthenticationResponseService(new ConfigService({ COOKIE_SECURE: false })),
    );
  });

  it('binds an authorization URL to a short-lived HttpOnly browser cookie', async () => {
    google.createAuthorizationUrl.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?request=1',
      browserState: STATE,
      expiresIn: 600,
    });
    const request = createRequest();
    const response = createResponse();

    await expect(controller.authorizationUrl(request, response.value)).resolves.toEqual({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?request=1',
      expiresIn: 600,
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(response.cookie.mock.calls).toEqual([
      [
        'hicas_google_oauth_state',
        STATE,
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth/google/callback',
          maxAge: 600_000,
        },
      ],
    ]);
    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
  });

  it('requires trusted origin and matching browser state before issuing a session', async () => {
    google.callback.mockResolvedValue({
      kind: 'session',
      accessToken: 'access-token',
      accessTokenExpiresIn: 900,
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: new Date('2026-08-06T12:00:00.000Z'),
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        fullName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    const request = createRequest({ hicas_google_oauth_state: STATE });
    const response = createResponse();

    await expect(
      controller.callback({ code: 'authorization-code', state: STATE }, request, response.value),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      user: { id: 'user-id' },
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(google.callback.mock.calls).toEqual([
      [
        'authorization-code',
        STATE,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Jest',
        },
      ],
    ]);
    expect(response.clearCookie.mock.calls[0]?.[0]).toBe('hicas_google_oauth_state');
    expect(response.cookie.mock.calls[0]?.[0]).toBe('hicas_refresh_token');
  });

  it('clears a mismatched state cookie without claiming the database transaction', async () => {
    const request = createRequest({ hicas_google_oauth_state: 'x'.repeat(43) });
    const response = createResponse();

    await expect(
      controller.callback({ code: 'authorization-code', state: STATE }, request, response.value),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'OAUTH_STATE_COOKIE_MISMATCH' },
    });

    expect(google.callback.mock.calls).toHaveLength(0);
    expect(response.clearCookie.mock.calls).toEqual([
      [
        'hicas_google_oauth_state',
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth/google/callback',
        },
      ],
    ]);
  });

  it('rejects a missing state cookie before claiming the database transaction', async () => {
    const request = createRequest();
    const response = createResponse();

    await expect(
      controller.callback({ code: 'authorization-code', state: STATE }, request, response.value),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'OAUTH_STATE_COOKIE_MISMATCH' },
    });

    expect(google.callback.mock.calls).toHaveLength(0);
    expect(response.clearCookie.mock.calls[0]?.[0]).toBe('hicas_google_oauth_state');
  });
});

function createRequest(cookies: Record<string, string> = {}): Request {
  return {
    cookies,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn((name: string) => (name.toLowerCase() === 'user-agent' ? 'Jest' : undefined)),
  } as unknown as Request;
}

function createResponse(): {
  value: Response;
  cookie: jest.Mock<void, [string, string, CookieOptions]>;
  clearCookie: jest.Mock<void, [string, CookieOptions]>;
  setHeader: jest.Mock<void, [string, string]>;
} {
  const cookie = jest.fn<void, [string, string, CookieOptions]>();
  const clearCookie = jest.fn<void, [string, CookieOptions]>();
  const setHeader = jest.fn<void, [string, string]>();

  return {
    value: {
      cookie,
      clearCookie,
      setHeader,
    } as unknown as Response,
    cookie,
    clearCookie,
    setHeader,
  };
}
