import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { CookieOptions, Request, Response } from 'express';

import { ApplicationException } from '../../common/exceptions/application.exception';
import type { SessionAuthenticationResult } from '../auth.types';
import { AuthenticationResponseService } from '../services/authentication-response.service';
import { CookieOriginService } from '../services/cookie-origin.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';

const ENROLLMENT_TOKEN = 'E'.repeat(43);

describe(MfaController.name, () => {
  let mfa: jest.Mocked<MfaService>;
  let cookieOrigins: jest.Mocked<CookieOriginService>;
  let controller: MfaController;

  beforeEach(() => {
    mfa = {
      setup: jest.fn(),
      enable: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<MfaService>;
    cookieOrigins = {
      assertTrusted: jest.fn(),
    } as unknown as jest.Mocked<CookieOriginService>;
    controller = new MfaController(
      mfa,
      cookieOrigins,
      new AuthenticationResponseService(new ConfigService({ COOKIE_SECURE: false })),
    );
  });

  it('checks origin and bearer token, disables caching, and returns setup data without a cookie', async () => {
    mfa.setup.mockResolvedValue({
      otpauthUri: 'otpauth://totp/HICAS',
      qrCodeDataUrl: 'data:image/png;base64,redacted',
      manualKey: 'BASE32MANUALKEY',
      expiresIn: 600,
    });
    const request = createRequest(`Bearer ${ENROLLMENT_TOKEN}`);
    const response = createResponse();

    await expect(controller.setup({}, request, response.value)).resolves.toEqual({
      otpauthUri: 'otpauth://totp/HICAS',
      qrCodeDataUrl: 'data:image/png;base64,redacted',
      manualKey: 'BASE32MANUALKEY',
      expiresIn: 600,
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
    expect(mfa.setup.mock.calls).toEqual([
      [
        ENROLLMENT_TOKEN,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Jest',
        },
      ],
    ]);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rejects an invalid enrollment bearer after marking the sensitive response no-store', async () => {
    const request = createRequest(`Bearer ${ENROLLMENT_TOKEN} second-token`);
    const response = createResponse();

    await expect(controller.setup({}, request, response.value)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'MFA_ENROLLMENT_TOKEN_INVALID' },
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'no-store'],
      ['Pragma', 'no-cache'],
    ]);
    expect(mfa.setup.mock.calls).toHaveLength(0);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('stops before bearer parsing, cache headers, and service work when origin is rejected', async () => {
    const originError = new ApplicationException(
      HttpStatus.FORBIDDEN,
      'AUTH_ORIGIN_FORBIDDEN',
      'The request origin is not allowed.',
    );
    cookieOrigins.assertTrusted.mockImplementation(() => {
      throw originError;
    });
    const request = createRequest(`Bearer ${ENROLLMENT_TOKEN}`);
    const response = createResponse();

    await expect(controller.setup({}, request, response.value)).rejects.toBe(originError);

    expect(response.setHeader).not.toHaveBeenCalled();
    expect(mfa.setup.mock.calls).toHaveLength(0);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('writes the refresh cookie only after enable succeeds and returns recovery codes once', async () => {
    mfa.enable.mockResolvedValue({
      session: sessionResult(),
      recoveryCodes: ['2345-6789-ABCD-EFGH-JKLM'],
    });
    const request = createRequest(`Bearer ${ENROLLMENT_TOKEN}`);
    const response = createResponse();

    await expect(controller.enable({ code: '123456' }, request, response.value)).resolves.toEqual({
      accessToken: 'access-token',
      expiresIn: 900,
      user: sessionResult().user,
      recoveryCodes: ['2345-6789-ABCD-EFGH-JKLM'],
    });

    expect(response.cookie.mock.calls).toEqual([
      [
        'hicas_refresh_token',
        'refresh-token',
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth',
          expires: new Date('2026-08-06T12:00:00.000Z'),
        },
      ],
    ]);
    expect(mfa.enable.mock.calls[0]?.[0]).toBe(ENROLLMENT_TOKEN);
  });

  it('does not write a refresh cookie when enable fails with an invalid OTP', async () => {
    mfa.enable.mockRejectedValue(
      new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'MFA_CODE_INVALID',
        'The authenticator or recovery code is invalid.',
      ),
    );
    const request = createRequest(`Bearer ${ENROLLMENT_TOKEN}`);
    const response = createResponse();

    await expect(
      controller.enable({ code: '000000' }, request, response.value),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'MFA_CODE_INVALID' },
    });

    expect(response.setHeader.mock.calls).toHaveLength(2);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('finishes a verified TOTP or recovery challenge through the shared cookie presenter', async () => {
    mfa.verify.mockResolvedValue(sessionResult());
    const request = createRequest();
    const response = createResponse();

    await expect(
      controller.verify(
        {
          mfaToken: 'M'.repeat(43),
          recoveryCode: '23456789ABCDEFGHJKLM',
        },
        request,
        response.value,
      ),
    ).resolves.toEqual({
      accessToken: 'access-token',
      expiresIn: 900,
      user: sessionResult().user,
    });

    expect(cookieOrigins.assertTrusted.mock.calls).toEqual([[request]]);
    expect(response.cookie.mock.calls[0]?.[0]).toBe('hicas_refresh_token');
  });
});

function createRequest(authorization?: string): Request {
  return {
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn((name: string) => (name.toLowerCase() === 'user-agent' ? 'Jest' : undefined)),
  } as unknown as Request;
}

function createResponse(): {
  value: Response;
  cookie: jest.Mock<void, [string, string, CookieOptions]>;
  setHeader: jest.Mock<void, [string, string]>;
} {
  const cookie = jest.fn<void, [string, string, CookieOptions]>();
  const setHeader = jest.fn<void, [string, string]>();

  return {
    value: {
      cookie,
      setHeader,
    } as unknown as Response,
    cookie,
    setHeader,
  };
}

function sessionResult(): SessionAuthenticationResult {
  return {
    kind: 'session',
    accessToken: 'access-token',
    accessTokenExpiresIn: 900,
    refreshToken: 'refresh-token',
    refreshTokenExpiresAt: new Date('2026-08-06T12:00:00.000Z'),
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'staff@example.com',
      fullName: 'Staff User',
      role: UserRole.STAFF,
    },
  };
}
