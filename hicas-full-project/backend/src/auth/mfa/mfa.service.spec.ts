import { ConfigService } from '@nestjs/config';
import { MfaTotpStatus, UserRole, UserStatus } from '@prisma/client';
import QRCode from 'qrcode';

import type { SessionAuthenticationResult } from '../auth.types';
import { AuthRateLimiterService } from '../services/auth-rate-limiter.service';
import { SessionService } from '../services/session.service';
import { hashOpaqueToken } from '../utilities/auth-crypto';
import {
  type MfaChallengeContext,
  type MfaEnrollmentContext,
  MfaRepository,
} from './mfa.repository';
import { MfaSecretCipher } from './mfa-secret-cipher';
import { RecoveryCodeService } from './recovery-code.service';
import { MfaService } from './mfa.service';
import { TotpService } from './totp.service';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn(),
  },
}));

const NOW = new Date('2026-07-23T12:00:00.000Z');
const ENROLLMENT_TOKEN = 'E'.repeat(43);
const MFA_TOKEN = 'M'.repeat(43);
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SECRET_ENCRYPTED = 'v1.encrypted-secret';
const OTPAUTH_URI = 'otpauth://totp/HICAS%3Astaff%40example.com?secret=redacted';
const QR_DATA_URL = 'data:image/png;base64,redacted';
const CONTEXT = { ipAddress: '127.0.0.1', userAgent: 'Jest' };
const RECOVERY_CODES = Array.from(
  { length: 10 },
  (_value, index) => `2345-6789-ABCD-EFGH-${String(index).padStart(4, '2')}`,
);
const RECOVERY_CODE_HASHES = Array.from({ length: 10 }, (_value, index) => `hash-${index}`);

const qrCodeToDataUrl = QRCode.toDataURL as unknown as jest.Mock<
  Promise<string>,
  [string, Record<string, unknown>]
>;

describe(MfaService.name, () => {
  let repository: jest.Mocked<MfaRepository>;
  let cipher: jest.Mocked<MfaSecretCipher>;
  let totp: jest.Mocked<TotpService>;
  let recoveryCodes: jest.Mocked<RecoveryCodeService>;
  let sessions: jest.Mocked<SessionService>;
  let rateLimiter: jest.Mocked<AuthRateLimiterService>;
  let service: MfaService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    repository = {
      findEnrollmentContext: jest.fn(),
      savePendingSetup: jest.fn(),
      completeEnrollment: jest.fn(),
      findChallengeContext: jest.fn(),
      completeChallenge: jest.fn(),
    } as unknown as jest.Mocked<MfaRepository>;
    cipher = {
      encrypt: jest.fn().mockReturnValue(SECRET_ENCRYPTED),
      decrypt: jest.fn().mockReturnValue(SECRET),
    } as unknown as jest.Mocked<MfaSecretCipher>;
    totp = {
      generateSecret: jest.fn().mockReturnValue(SECRET),
      createOtpAuthUri: jest.fn().mockReturnValue(OTPAUTH_URI),
      verifyCode: jest.fn(),
    } as unknown as jest.Mocked<TotpService>;
    recoveryCodes = {
      generateBatch: jest.fn().mockReturnValue({
        codes: RECOVERY_CODES,
        hashes: RECOVERY_CODE_HASHES,
      }),
      hashCode: jest.fn(),
    } as unknown as jest.Mocked<RecoveryCodeService>;
    sessions = {
      completeAuthentication: jest.fn().mockResolvedValue(sessionResult()),
    } as unknown as jest.Mocked<SessionService>;
    rateLimiter = {
      consumeMfaSetup: jest.fn(),
      consumeMfaEnable: jest.fn(),
    } as unknown as jest.Mocked<AuthRateLimiterService>;
    qrCodeToDataUrl.mockReset().mockResolvedValue(QR_DATA_URL);
    service = new MfaService(
      repository,
      cipher,
      totp,
      recoveryCodes,
      sessions,
      rateLimiter,
      new ConfigService({
        MFA_ISSUER: 'HICAS',
        REFRESH_TOKEN_TTL_DAYS: 14,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates, encrypts and persists a pending setup before returning QR and manual data', async () => {
    const setupExpiresAt = new Date('2026-07-23T12:08:00.000Z');
    repository.findEnrollmentContext.mockResolvedValue(
      enrollmentContext({ grantExpiresAt: setupExpiresAt }),
    );
    repository.savePendingSetup.mockResolvedValue({
      kind: 'saved',
      email: 'staff@example.com',
      setupExpiresAt,
    });

    await expect(service.setup(ENROLLMENT_TOKEN, CONTEXT)).resolves.toEqual({
      otpauthUri: OTPAUTH_URI,
      qrCodeDataUrl: QR_DATA_URL,
      manualKey: SECRET,
      expiresIn: 480,
    });

    const enrollmentTokenHash = hashOpaqueToken(ENROLLMENT_TOKEN);
    expect(repository.findEnrollmentContext.mock.calls).toEqual([[enrollmentTokenHash]]);
    expect(rateLimiter.consumeMfaSetup.mock.calls).toEqual([[USER_ID]]);
    expect(cipher.encrypt.mock.calls).toEqual([[SECRET, USER_ID]]);
    expect(totp.createOtpAuthUri.mock.calls).toEqual([[SECRET, 'staff@example.com', 'HICAS']]);
    expect(qrCodeToDataUrl.mock.calls).toEqual([
      [
        OTPAUTH_URI,
        {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
          type: 'image/png',
        },
      ],
    ]);
    expect(repository.savePendingSetup.mock.calls).toEqual([
      [
        {
          userId: USER_ID,
          enrollmentTokenHash,
          secretEncrypted: SECRET_ENCRYPTED,
          setupExpiresAt,
          now: NOW,
        },
      ],
    ]);
    expect(JSON.stringify(repository.savePendingSetup.mock.calls[0]?.[0])).not.toContain(SECRET);
  });

  it('enables MFA atomically and maps the committed session plus one-time recovery codes', async () => {
    repository.findEnrollmentContext.mockResolvedValue(pendingEnrollmentContext());
    totp.verifyCode.mockReturnValue(1_234n);
    repository.completeEnrollment.mockResolvedValue(completedDatabaseSession());

    await expect(service.enable(ENROLLMENT_TOKEN, { code: '123456' }, CONTEXT)).resolves.toEqual({
      session: sessionResult(),
      recoveryCodes: RECOVERY_CODES,
    });

    const enrollmentTokenHash = hashOpaqueToken(ENROLLMENT_TOKEN);
    expect(rateLimiter.consumeMfaEnable.mock.calls).toEqual([[enrollmentTokenHash]]);
    expect(cipher.decrypt.mock.calls).toEqual([[SECRET_ENCRYPTED, USER_ID]]);
    expect(totp.verifyCode.mock.calls).toEqual([[SECRET, '123456', NOW]]);
    expect(repository.completeEnrollment.mock.calls).toEqual([
      [
        {
          userId: USER_ID,
          enrollmentTokenHash,
          expectedSecretEncrypted: SECRET_ENCRYPTED,
          candidateTimeStep: 1_234n,
          recoveryCodeHashes: RECOVERY_CODE_HASHES,
          refreshTtlDays: 14,
          context: CONTEXT,
          now: NOW,
        },
      ],
    ]);
    expect(sessions.completeAuthentication.mock.calls).toEqual([[completedDatabaseSession()]]);
  });

  it('rejects an invalid first OTP before generating recovery codes or committing enrollment', async () => {
    repository.findEnrollmentContext.mockResolvedValue(pendingEnrollmentContext());
    totp.verifyCode.mockReturnValue(null);

    await expect(
      service.enable(ENROLLMENT_TOKEN, { code: '000000' }, CONTEXT),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'MFA_CODE_INVALID' },
    });

    expect(recoveryCodes.generateBatch.mock.calls).toHaveLength(0);
    expect(repository.completeEnrollment.mock.calls).toHaveLength(0);
    expect(sessions.completeAuthentication.mock.calls).toHaveLength(0);
  });

  it('maps a TOTP challenge to the encrypted method and matched time step', async () => {
    repository.findChallengeContext.mockResolvedValue(challengeContext());
    totp.verifyCode.mockReturnValue(2_468n);
    repository.completeChallenge.mockResolvedValue(completedDatabaseSession());

    await expect(service.verify({ mfaToken: MFA_TOKEN, code: '654321' }, CONTEXT)).resolves.toEqual(
      sessionResult(),
    );

    expect(repository.completeChallenge.mock.calls).toEqual([
      [
        {
          userId: USER_ID,
          challengeTokenHash: hashOpaqueToken(MFA_TOKEN),
          credential: {
            kind: 'totp',
            expectedSecretEncrypted: SECRET_ENCRYPTED,
            candidateTimeStep: 2_468n,
          },
          refreshTtlDays: 14,
          context: CONTEXT,
          now: NOW,
        },
      ],
    ]);
  });

  it('maps a recovery-code challenge without decrypting or verifying the TOTP secret', async () => {
    repository.findChallengeContext.mockResolvedValue(challengeContext());
    recoveryCodes.hashCode.mockReturnValue('recovery-code-hash');
    repository.completeChallenge.mockResolvedValue(completedDatabaseSession());

    await expect(
      service.verify(
        {
          mfaToken: MFA_TOKEN,
          recoveryCode: '23456789ABCDEFGHJKLM',
        },
        CONTEXT,
      ),
    ).resolves.toEqual(sessionResult());

    expect(recoveryCodes.hashCode.mock.calls).toEqual([['23456789ABCDEFGHJKLM']]);
    expect(cipher.decrypt.mock.calls).toHaveLength(0);
    expect(totp.verifyCode.mock.calls).toHaveLength(0);
    expect(repository.completeChallenge.mock.calls[0]?.[0]).toMatchObject({
      challengeTokenHash: hashOpaqueToken(MFA_TOKEN),
      credential: {
        kind: 'recovery',
        recoveryCodeHash: 'recovery-code-hash',
      },
    });
  });

  it('maps the invalid fifth attempt committed by the repository to challenge exhaustion', async () => {
    repository.findChallengeContext.mockResolvedValue(
      challengeContext({ attemptCount: 4, maxAttempts: 5 }),
    );
    totp.verifyCode.mockReturnValue(null);
    repository.completeChallenge.mockResolvedValue({ kind: 'attempts-exhausted' });

    await expect(
      service.verify({ mfaToken: MFA_TOKEN, code: '000000' }, CONTEXT),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'MFA_CHALLENGE_EXHAUSTED' },
    });
    expect(sessions.completeAuthentication.mock.calls).toHaveLength(0);
  });

  it.each([
    ['missing', null],
    [
      'expired',
      challengeContext({
        expiresAt: NOW,
      }),
    ],
    [
      'consumed',
      challengeContext({
        consumedAt: NOW,
      }),
    ],
    [
      'method missing',
      challengeContext({
        method: null,
      }),
    ],
  ])('rejects a %s challenge before attempting verification', async (_caseName, challenge) => {
    repository.findChallengeContext.mockResolvedValue(challenge);

    await expect(
      service.verify({ mfaToken: MFA_TOKEN, code: '123456' }, CONTEXT),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'MFA_CHALLENGE_INVALID' },
    });
    expect(repository.completeChallenge.mock.calls).toHaveLength(0);
  });

  it.each([
    [
      'blocked account',
      enrollmentContext({ status: UserStatus.BLOCKED }),
      403,
      'AUTH_ACCOUNT_BLOCKED',
    ],
    [
      'unverified account',
      enrollmentContext({ status: UserStatus.PENDING, emailVerifiedAt: null }),
      403,
      'AUTH_EMAIL_NOT_VERIFIED',
    ],
    ['Customer role', enrollmentContext({ role: UserRole.CUSTOMER }), 403, 'MFA_NOT_AVAILABLE'],
  ] as const)(
    'maps %s setup state to its stable error',
    async (_name, enrollment, status, code) => {
      repository.findEnrollmentContext.mockResolvedValue(enrollment);

      await expect(service.setup(ENROLLMENT_TOKEN, CONTEXT)).rejects.toMatchObject({
        status,
        response: { code },
      });
      expect(repository.savePendingSetup.mock.calls).toHaveLength(0);
    },
  );

  it('rejects a missing enrollment grant with the stable token error', async () => {
    repository.findEnrollmentContext.mockResolvedValue(null);

    await expect(service.setup(ENROLLMENT_TOKEN, CONTEXT)).rejects.toMatchObject({
      status: 401,
      response: { code: 'MFA_ENROLLMENT_TOKEN_INVALID' },
    });
    expect(rateLimiter.consumeMfaSetup.mock.calls).toHaveLength(0);
  });

  it('requires an unexpired pending setup before enable', async () => {
    repository.findEnrollmentContext.mockResolvedValue(
      enrollmentContext({
        method: {
          status: MfaTotpStatus.PENDING,
          secretEncrypted: SECRET_ENCRYPTED,
          setupExpiresAt: NOW,
        },
      }),
    );

    await expect(
      service.enable(ENROLLMENT_TOKEN, { code: '123456' }, CONTEXT),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'MFA_SETUP_REQUIRED' },
    });
    expect(repository.completeEnrollment.mock.calls).toHaveLength(0);
  });

  it('maps a status change detected during challenge completion before creating a session', async () => {
    repository.findChallengeContext.mockResolvedValue(challengeContext());
    totp.verifyCode.mockReturnValue(3_579n);
    repository.completeChallenge.mockResolvedValue({
      kind: 'status-rejected',
      status: UserStatus.BLOCKED,
    });

    await expect(
      service.verify({ mfaToken: MFA_TOKEN, code: '123456' }, CONTEXT),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'AUTH_ACCOUNT_BLOCKED' },
    });
    expect(sessions.completeAuthentication.mock.calls).toHaveLength(0);
  });
});

function enrollmentContext(overrides: Partial<MfaEnrollmentContext> = {}): MfaEnrollmentContext {
  return {
    userId: USER_ID,
    email: 'staff@example.com',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    grantExpiresAt: new Date('2026-07-23T12:10:00.000Z'),
    grantConsumedAt: null,
    grantRevokedAt: null,
    method: null,
    ...overrides,
  };
}

function pendingEnrollmentContext(): MfaEnrollmentContext {
  return enrollmentContext({
    method: {
      status: MfaTotpStatus.PENDING,
      secretEncrypted: SECRET_ENCRYPTED,
      setupExpiresAt: new Date('2026-07-23T12:09:00.000Z'),
    },
  });
}

function challengeContext(overrides: Partial<MfaChallengeContext> = {}): MfaChallengeContext {
  return {
    userId: USER_ID,
    expiresAt: new Date('2026-07-23T12:05:00.000Z'),
    consumedAt: null,
    attemptCount: 0,
    maxAttempts: 5,
    method: {
      status: MfaTotpStatus.ENABLED,
      secretEncrypted: SECRET_ENCRYPTED,
    },
    ...overrides,
  };
}

function completedDatabaseSession() {
  return {
    kind: 'completed' as const,
    sessionId: 'session-id',
    refreshToken: 'refresh-token',
    refreshTokenExpiresAt: new Date('2026-08-06T12:00:00.000Z'),
    user: {
      id: USER_ID,
      email: 'staff@example.com',
      fullName: 'Staff User',
      role: UserRole.STAFF,
    },
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
      id: USER_ID,
      email: 'staff@example.com',
      fullName: 'Staff User',
      role: UserRole.STAFF,
    },
  };
}
