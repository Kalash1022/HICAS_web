import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MfaTotpStatus, UserRole, UserStatus } from '@prisma/client';
import QRCode from 'qrcode';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { MFA_SETUP_TTL_SECONDS } from '../auth.constants';
import type { RequestContext, SessionAuthenticationResult } from '../auth.types';
import { AuthRateLimiterService } from '../services/auth-rate-limiter.service';
import { SessionService } from '../services/session.service';
import { addSeconds, hashOpaqueToken } from '../utilities/auth-crypto';
import type { EnableMfaDto } from './dto/enable-mfa.dto';
import type { VerifyMfaDto } from './dto/verify-mfa.dto';
import {
  type CompleteChallengeResult,
  type CompleteEnrollmentResult,
  type MfaChallengeContext,
  type MfaEnrollmentContext,
  MfaRepository,
  type SavePendingSetupResult,
} from './mfa.repository';
import { MfaSecretCipher, MfaSecretCipherError } from './mfa-secret-cipher';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';

export interface MfaSetupResult {
  otpauthUri: string;
  qrCodeDataUrl: string;
  manualKey: string;
  expiresIn: number;
}

export interface MfaEnableResult {
  session: SessionAuthenticationResult;
  recoveryCodes: string[];
}

@Injectable()
export class MfaService {
  private readonly issuer: string;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly repository: MfaRepository,
    private readonly cipher: MfaSecretCipher,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: AuthRateLimiterService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('MFA_ISSUER');
    this.refreshTtlDays = config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
  }

  async setup(enrollmentToken: string, context: RequestContext): Promise<MfaSetupResult> {
    void context;
    const now = new Date();
    const enrollmentTokenHash = hashOpaqueToken(enrollmentToken);
    const enrollment = await this.repository.findEnrollmentContext(enrollmentTokenHash);
    if (!enrollment) {
      this.throwEnrollmentTokenInvalid();
    }

    this.rateLimiter.consumeMfaSetup(enrollment.userId);
    this.assertEnrollmentContext(enrollment, now, false);

    const secret = this.totp.generateSecret();
    const secretEncrypted = this.cipher.encrypt(secret, enrollment.userId);
    const requestedSetupExpiry = addSeconds(now, MFA_SETUP_TTL_SECONDS);
    const setupExpiresAt =
      requestedSetupExpiry < enrollment.grantExpiresAt
        ? requestedSetupExpiry
        : enrollment.grantExpiresAt;
    const otpauthUri = this.totp.createOtpAuthUri(secret, enrollment.email, this.issuer);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      type: 'image/png',
    });
    const saved = await this.repository.savePendingSetup({
      userId: enrollment.userId,
      enrollmentTokenHash,
      secretEncrypted,
      setupExpiresAt,
      now,
    });
    this.assertSetupSaved(saved);

    return {
      otpauthUri,
      qrCodeDataUrl,
      manualKey: secret,
      expiresIn: Math.max(0, Math.floor((saved.setupExpiresAt.getTime() - now.getTime()) / 1_000)),
    };
  }

  async enable(
    enrollmentToken: string,
    dto: EnableMfaDto,
    context: RequestContext,
  ): Promise<MfaEnableResult> {
    const now = new Date();
    const enrollmentTokenHash = hashOpaqueToken(enrollmentToken);
    this.rateLimiter.consumeMfaEnable(enrollmentTokenHash);

    const enrollment = await this.repository.findEnrollmentContext(enrollmentTokenHash);
    if (!enrollment) {
      this.throwEnrollmentTokenInvalid();
    }
    this.assertEnrollmentContext(enrollment, now, true);

    const method = enrollment.method!;
    const secret = this.decryptSecret(method.secretEncrypted, enrollment.userId);
    const candidateTimeStep = this.totp.verifyCode(secret, dto.code, now);
    if (candidateTimeStep === null) {
      this.throwCodeInvalid();
    }

    const recoveryCodeBatch = this.recoveryCodes.generateBatch();
    const completed = await this.repository.completeEnrollment({
      userId: enrollment.userId,
      enrollmentTokenHash,
      expectedSecretEncrypted: method.secretEncrypted,
      candidateTimeStep,
      recoveryCodeHashes: recoveryCodeBatch.hashes,
      refreshTtlDays: this.refreshTtlDays,
      context,
      now,
    });
    this.assertEnrollmentCompleted(completed);

    return {
      session: await this.sessions.completeAuthentication(completed),
      recoveryCodes: recoveryCodeBatch.codes,
    };
  }

  async verify(dto: VerifyMfaDto, context: RequestContext): Promise<SessionAuthenticationResult> {
    const now = new Date();
    const challengeTokenHash = hashOpaqueToken(dto.mfaToken);
    const challenge = await this.repository.findChallengeContext(challengeTokenHash);
    this.assertChallengeContext(challenge, now);

    const credential =
      dto.code !== undefined
        ? {
            kind: 'totp' as const,
            expectedSecretEncrypted: challenge.method.secretEncrypted,
            candidateTimeStep: this.totp.verifyCode(
              this.decryptSecret(challenge.method.secretEncrypted, challenge.userId),
              dto.code,
              now,
            ),
          }
        : {
            kind: 'recovery' as const,
            recoveryCodeHash: this.recoveryCodes.hashCode(dto.recoveryCode ?? ''),
          };
    const completed = await this.repository.completeChallenge({
      userId: challenge.userId,
      challengeTokenHash,
      credential,
      refreshTtlDays: this.refreshTtlDays,
      context,
      now,
    });
    this.assertChallengeCompleted(completed);

    return this.sessions.completeAuthentication(completed);
  }

  private assertEnrollmentContext(
    enrollment: MfaEnrollmentContext,
    now: Date,
    setupRequired: boolean,
  ): void {
    if (
      enrollment.grantConsumedAt !== null ||
      enrollment.grantRevokedAt !== null ||
      enrollment.grantExpiresAt <= now
    ) {
      this.throwEnrollmentTokenInvalid();
    }
    this.throwForStatus(enrollment.status, enrollment.emailVerifiedAt);
    if (enrollment.role === UserRole.CUSTOMER) {
      this.throwRoleRejected();
    }
    if (enrollment.method?.status === MfaTotpStatus.ENABLED) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'MFA_ALREADY_ENABLED',
        'Multi-factor authentication is already enabled.',
      );
    }
    if (
      setupRequired &&
      (enrollment.method?.status !== MfaTotpStatus.PENDING ||
        enrollment.method.setupExpiresAt === null ||
        enrollment.method.setupExpiresAt <= now)
    ) {
      this.throwSetupRequired();
    }
  }

  private assertSetupSaved(
    result: SavePendingSetupResult,
  ): asserts result is Extract<SavePendingSetupResult, { kind: 'saved' }> {
    if (result.kind === 'saved') {
      return;
    }
    if (result.kind === 'status-rejected') {
      this.throwForStatus(result.status, result.status === UserStatus.ACTIVE ? new Date() : null);
    }
    if (result.kind === 'role-rejected') {
      this.throwRoleRejected();
    }
    if (result.kind === 'already-enabled') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'MFA_ALREADY_ENABLED',
        'Multi-factor authentication is already enabled.',
      );
    }
    this.throwEnrollmentTokenInvalid();
  }

  private assertEnrollmentCompleted(
    result: CompleteEnrollmentResult,
  ): asserts result is Extract<CompleteEnrollmentResult, { kind: 'completed' }> {
    if (result.kind === 'completed') {
      return;
    }
    if (result.kind === 'status-rejected') {
      this.throwForStatus(result.status, result.status === UserStatus.ACTIVE ? new Date() : null);
    }
    if (result.kind === 'role-rejected') {
      this.throwRoleRejected();
    }
    if (result.kind === 'setup-required') {
      this.throwSetupRequired();
    }
    this.throwEnrollmentTokenInvalid();
  }

  private assertChallengeContext(
    challenge: MfaChallengeContext | null,
    now: Date,
  ): asserts challenge is MfaChallengeContext & {
    method: NonNullable<MfaChallengeContext['method']>;
  } {
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.method?.status !== MfaTotpStatus.ENABLED
    ) {
      this.throwChallengeInvalid();
    }
    if (challenge.attemptCount >= challenge.maxAttempts) {
      this.throwChallengeExhausted();
    }
  }

  private assertChallengeCompleted(
    result: CompleteChallengeResult,
  ): asserts result is Extract<CompleteChallengeResult, { kind: 'completed' }> {
    if (result.kind === 'completed') {
      return;
    }
    if (result.kind === 'status-rejected') {
      this.throwForStatus(result.status, result.status === UserStatus.ACTIVE ? new Date() : null);
    }
    if (result.kind === 'role-rejected') {
      this.throwRoleRejected();
    }
    if (result.kind === 'attempts-exhausted') {
      this.throwChallengeExhausted();
    }
    if (result.kind === 'invalid-credential') {
      this.throwCodeInvalid();
    }
    this.throwChallengeInvalid();
  }

  private decryptSecret(secretEncrypted: string, userId: string): string {
    try {
      return this.cipher.decrypt(secretEncrypted, userId);
    } catch (error) {
      if (error instanceof MfaSecretCipherError) {
        throw new ApplicationException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'MFA_SECRET_CORRUPTED',
          'Multi-factor authentication could not be completed.',
        );
      }
      throw error;
    }
  }

  private throwForStatus(status: UserStatus, emailVerifiedAt: Date | null): void {
    if (status === UserStatus.BLOCKED) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_ACCOUNT_BLOCKED',
        'This account has been blocked.',
      );
    }
    if (status !== UserStatus.ACTIVE || emailVerifiedAt === null) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_EMAIL_NOT_VERIFIED',
        'Verify your email before signing in.',
      );
    }
  }

  private throwEnrollmentTokenInvalid(): never {
    throw new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'MFA_ENROLLMENT_TOKEN_INVALID',
      'The MFA enrollment token is invalid or expired.',
    );
  }

  private throwSetupRequired(): never {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'MFA_SETUP_REQUIRED',
      'Start MFA setup again before enabling it.',
    );
  }

  private throwChallengeInvalid(): never {
    throw new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'MFA_CHALLENGE_INVALID',
      'The MFA challenge is invalid or expired. Sign in again.',
    );
  }

  private throwChallengeExhausted(): never {
    throw new ApplicationException(
      HttpStatus.TOO_MANY_REQUESTS,
      'MFA_CHALLENGE_EXHAUSTED',
      'Too many invalid MFA attempts. Sign in again.',
    );
  }

  private throwCodeInvalid(): never {
    throw new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'MFA_CODE_INVALID',
      'The authenticator or recovery code is invalid.',
    );
  }

  private throwRoleRejected(): never {
    throw new ApplicationException(
      HttpStatus.FORBIDDEN,
      'MFA_NOT_AVAILABLE',
      'Multi-factor authentication is not available for this account.',
    );
  }
}
