import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { CookieOptions, Request, Response } from 'express';

import { ApplicationException } from '../common/exceptions/application.exception';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationResponseService } from './services/authentication-response.service';
import { CookieOriginService } from './services/cookie-origin.service';

describe(AuthController.name, () => {
  let auth: jest.Mocked<AuthService>;
  let cookieOrigins: jest.Mocked<CookieOriginService>;
  let controller: AuthController;

  beforeEach(() => {
    auth = {
      register: jest.fn(),
      verifyEmail: jest.fn(),
      resendVerification: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    cookieOrigins = {
      assertTrusted: jest.fn(),
    } as unknown as jest.Mocked<CookieOriginService>;
    const config = new ConfigService({ COOKIE_SECURE: false });
    controller = new AuthController(auth, cookieOrigins, new AuthenticationResponseService(config));
  });

  it('validates login origin and prevents caching of enrollment credentials', async () => {
    auth.login.mockResolvedValue({
      kind: 'mfa-enrollment',
      mfaEnrollmentRequired: true,
      enrollmentToken: 'enrollment-token',
      expiresIn: 600,
    });
    const request = createRequest();
    const response = createResponse();

    await expect(
      controller.login(
        { email: 'staff@example.com', password: 'password123' },
        request,
        response.value,
      ),
    ).resolves.toEqual({
      mfaEnrollmentRequired: true,
      enrollmentToken: 'enrollment-token',
      expiresIn: 600,
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
  });

  it('sets no-store headers when issuing access and refresh credentials', async () => {
    auth.login.mockResolvedValue({
      kind: 'session',
      accessToken: 'access-token',
      accessTokenExpiresIn: 900,
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        fullName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    const request = createRequest();
    const response = createResponse();

    await controller.login(
      { email: 'customer@example.com', password: 'password123' },
      request,
      response.value,
    );

    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
    expect(response.cookie.mock.calls[0]?.[0]).toBe('hicas_refresh_token');
  });

  it('clears a stale refresh cookie after a trusted 401 refresh failure', async () => {
    auth.refresh.mockRejectedValue(
      new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REFRESH_TOKEN_INVALID',
        'Invalid refresh token',
      ),
    );
    const request = createRequest({ hicas_refresh_token: 'stale-token' });
    const response = createResponse();

    await expect(controller.refresh(request, response.value)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });

    expect(response.clearCookie.mock.calls).toEqual([
      [
        'hicas_refresh_token',
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth',
        },
      ],
    ]);
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
