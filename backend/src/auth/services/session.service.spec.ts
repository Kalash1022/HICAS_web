import { ConfigService } from '@nestjs/config';
import { PrimaryAuthMethod, UserRole, UserStatus } from '@prisma/client';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { AuthRepository } from '../auth.repository';
import { AccessTokenService } from './access-token.service';
import { SessionService } from './session.service';

describe(SessionService.name, () => {
  let repository: jest.Mocked<AuthRepository>;
  let accessTokens: jest.Mocked<AccessTokenService>;
  let service: SessionService;

  beforeEach(() => {
    repository = {
      beginPrimaryAuthentication: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;
    accessTokens = {
      expiresInSeconds: 900,
      sign: jest.fn().mockResolvedValue('signed-access-token'),
    } as unknown as jest.Mocked<AccessTokenService>;
    service = new SessionService(
      repository,
      accessTokens,
      new ConfigService({
        REFRESH_TOKEN_TTL_DAYS: 14,
        MFA_CHALLENGE_TTL_SECONDS: 300,
      }),
    );
  });

  it('does not issue an application session when staff enrollment is required', async () => {
    repository.beginPrimaryAuthentication.mockResolvedValue({
      kind: 'mfa-enrollment',
      enrollmentToken: 'single-purpose-token',
      expiresIn: 600,
    });

    await expect(
      service.beginPasswordAuthentication('user-id', 'password-hash', {}),
    ).resolves.toEqual({
      kind: 'mfa-enrollment',
      mfaEnrollmentRequired: true,
      enrollmentToken: 'single-purpose-token',
      expiresIn: 600,
    });
    expect(accessTokens.sign.mock.calls).toHaveLength(0);
  });

  it('signs an access token only after the refresh session transaction succeeds', async () => {
    const refreshTokenExpiresAt = new Date('2026-01-15T00:00:00.000Z');
    repository.beginPrimaryAuthentication.mockResolvedValue({
      kind: 'session',
      sessionId: 'session-id',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt,
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        fullName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });

    await expect(
      service.beginPasswordAuthentication('user-id', 'password-hash', {}),
    ).resolves.toMatchObject({
      kind: 'session',
      accessToken: 'signed-access-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt,
    });
    expect(accessTokens.sign.mock.calls).toEqual([
      [
        {
          userId: 'user-id',
          sessionId: 'session-id',
          role: UserRole.CUSTOMER,
        },
      ],
    ]);
  });

  it('rejects blocked users without signing a token', async () => {
    repository.beginPrimaryAuthentication.mockResolvedValue({
      kind: 'status-rejected',
      status: UserStatus.BLOCKED,
    });

    await expect(
      service.beginPasswordAuthentication('user-id', 'password-hash', {}),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(accessTokens.sign.mock.calls).toHaveLength(0);
  });

  it('rechecks Google identity ownership with GOOGLE as the primary method', async () => {
    repository.beginPrimaryAuthentication.mockResolvedValue({
      kind: 'mfa-enrollment',
      enrollmentToken: 'google-enrollment-token',
      expiresIn: 600,
    });

    await service.beginGoogleAuthentication('user-id', 'google-subject', {
      ipAddress: '127.0.0.1',
    });

    expect(repository.beginPrimaryAuthentication.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user-id',
      proof: {
        method: PrimaryAuthMethod.GOOGLE,
        providerAccountId: 'google-subject',
      },
    });
  });

  it('surfaces reuse detection only after the repository revokes the family', async () => {
    repository.rotateRefreshToken.mockResolvedValue({ kind: 'reuse' });

    await expect(service.refresh('reused-token', {})).rejects.toBeInstanceOf(ApplicationException);
    expect(accessTokens.sign.mock.calls).toHaveLength(0);
  });
});
