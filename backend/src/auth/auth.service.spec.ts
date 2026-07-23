import { UserRole, UserStatus } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import { MailDeliveryError, type MailService } from '../notifications/mail.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthRateLimiterService } from './services/auth-rate-limiter.service';
import { SessionService } from './services/session.service';
import * as authCrypto from './utilities/auth-crypto';

describe(AuthService.name, () => {
  let repository: jest.Mocked<AuthRepository>;
  let sessions: jest.Mocked<SessionService>;
  let rateLimiter: jest.Mocked<AuthRateLimiterService>;
  let mail: jest.Mocked<MailService>;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      createPendingUser: jest.fn(),
      consumeEmailVerification: jest.fn(),
      rotateEmailVerificationToken: jest.fn(),
      createPasswordResetToken: jest.fn(),
      findPasswordResetEligibility: jest.fn(),
      resetPassword: jest.fn(),
      findPasswordLogin: jest.fn(),
      findRefreshTokenFamilyId: jest.fn(),
      recordLoginFailure: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;
    sessions = {
      beginPrimaryAuthentication: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;
    rateLimiter = {
      consumeRegister: jest.fn(),
      consumeLogin: jest.fn(),
      consumeResend: jest.fn(),
      consumeForgotPassword: jest.fn(),
      consumeResetPasswordPreflight: jest.fn(),
      consumeResetPasswordAccount: jest.fn(),
      consumeRefreshPreflight: jest.fn(),
      consumeRefreshFamily: jest.fn(),
    } as unknown as jest.Mocked<AuthRateLimiterService>;
    mail = {
      sendEmailVerification: jest.fn(),
      sendPasswordReset: jest.fn(),
    };
    service = new AuthService(repository, sessions, rateLimiter, mail);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps registration committed when the SMTP delivery boundary fails', async () => {
    repository.createPendingUser.mockResolvedValue({
      id: 'user-id',
      email: 'customer@example.com',
      fullName: 'Customer',
      token: 'raw-token',
    });
    mail.sendEmailVerification.mockRejectedValue(
      new MailDeliveryError('smtp', 'EMAIL_VERIFICATION'),
    );

    await expect(
      service.register(
        {
          email: 'customer@example.com',
          fullName: 'Customer',
          password: 'password123',
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).resolves.toEqual({
      userId: 'user-id',
      status: 'PENDING',
      verificationRequired: true,
    });
    expect(rateLimiter.consumeRegister.mock.calls).toEqual([['customer@example.com', '127.0.0.1']]);
  });

  it('returns the same resend result when no account is eligible', async () => {
    repository.rotateEmailVerificationToken.mockResolvedValue(null);

    await expect(
      service.resendVerification({ email: 'unknown@example.com' }, { ipAddress: '127.0.0.1' }),
    ).resolves.toEqual({ accepted: true });
    expect(mail.sendEmailVerification.mock.calls).toHaveLength(0);
  });

  it('rejects an anomalous unverified ACTIVE account after a valid password', async () => {
    repository.findPasswordLogin.mockResolvedValue({
      id: 'user-id',
      email: 'customer@example.com',
      emailNormalized: 'customer@example.com',
      fullName: 'Customer',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
      passwordHash: await authCrypto.hashPassword('password123'),
    });

    await expect(
      service.login(
        { email: 'customer@example.com', password: 'password123' },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toBeInstanceOf(ApplicationException);
    expect(sessions.beginPrimaryAuthentication.mock.calls).toHaveLength(0);
  });

  it('rejects an ineligible reset token before hashing the replacement password', async () => {
    repository.findPasswordResetEligibility.mockResolvedValue(null);
    const hashPassword = jest.spyOn(authCrypto, 'hashPassword');

    await expect(
      service.resetPassword(
        {
          token: 'invalid-reset-token-that-is-long-enough',
          newPassword: 'replacement-password',
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID' },
    });

    expect(hashPassword).not.toHaveBeenCalled();
    expect(repository.resetPassword.mock.calls).toHaveLength(0);
  });

  it('limits refresh by IP/global before resolving and consuming the stable family', async () => {
    repository.findRefreshTokenFamilyId.mockResolvedValue('family-id');
    sessions.refresh.mockResolvedValue({
      kind: 'session',
      accessToken: 'access-token',
      accessTokenExpiresIn: 900,
      refreshToken: 'replacement-token',
      refreshTokenExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        fullName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });

    await service.refresh('current-refresh-token', { ipAddress: '127.0.0.8' });

    expect(rateLimiter.consumeRefreshPreflight.mock.calls).toEqual([['127.0.0.8']]);
    expect(repository.findRefreshTokenFamilyId.mock.calls).toEqual([
      [authCrypto.hashOpaqueToken('current-refresh-token')],
    ]);
    expect(rateLimiter.consumeRefreshFamily.mock.calls).toEqual([['family-id']]);
  });
});
