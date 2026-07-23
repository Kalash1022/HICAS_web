import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import { MAIL_SERVICE, MailDeliveryError, type MailService } from '../notifications/mail.service';
import { AuthRepository } from './auth.repository';
import type {
  AuthenticationResult,
  RequestContext,
  SessionAuthenticationResult,
} from './auth.types';
import type { EmailDto } from './dto/email.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { TokenDto } from './dto/token.dto';
import { AuthRateLimiterService } from './services/auth-rate-limiter.service';
import { SessionService } from './services/session.service';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from './utilities/auth-crypto';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$V/VqJy5ipDvGvih2GGgxRA$kpzQn1UWXdq+fFpT95RdCIIa3KJI/Yskc1dCkes4ni4';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessions: SessionService,
    private readonly rateLimiter: AuthRateLimiterService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
  ) {}

  async register(
    dto: RegisterDto,
    context: RequestContext,
  ): Promise<{
    userId: string;
    status: 'PENDING';
    verificationRequired: true;
  }> {
    const emailNormalized = normalizeEmail(dto.email);
    this.rateLimiter.consumeRegister(emailNormalized, context.ipAddress ?? 'unknown');

    const now = new Date();
    const token = createOpaqueToken();
    const created = await this.repository.createPendingUser({
      email: dto.email.trim(),
      emailNormalized,
      fullName: dto.fullName.trim(),
      passwordHash: await hashPassword(dto.password),
      verificationToken: token,
      verificationTokenHash: hashOpaqueToken(token),
      now,
    });

    if (!created) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'AUTH_EMAIL_ALREADY_REGISTERED',
        'An account already exists for this email.',
      );
    }

    await this.sendMailSafely(() =>
      this.mail.sendEmailVerification({
        to: created.email,
        fullName: created.fullName,
        token: created.token,
      }),
    );

    return {
      userId: created.id,
      status: 'PENDING',
      verificationRequired: true,
    };
  }

  async verifyEmail(dto: TokenDto): Promise<{ verified: true }> {
    const verified = await this.repository.consumeEmailVerification(
      hashOpaqueToken(dto.token),
      new Date(),
    );
    if (!verified) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID',
        'The email verification token is invalid or expired.',
      );
    }

    return { verified: true };
  }

  async resendVerification(dto: EmailDto, context: RequestContext): Promise<{ accepted: true }> {
    const emailNormalized = normalizeEmail(dto.email);
    this.rateLimiter.consumeResend(emailNormalized, context.ipAddress ?? 'unknown');

    const token = createOpaqueToken();
    const recipient = await this.repository.rotateEmailVerificationToken({
      emailNormalized,
      token,
      tokenHash: hashOpaqueToken(token),
      now: new Date(),
    });
    if (recipient) {
      await this.sendMailSafely(() =>
        this.mail.sendEmailVerification({
          to: recipient.email,
          fullName: recipient.fullName,
          token: recipient.token,
        }),
      );
    }

    return { accepted: true };
  }

  async forgotPassword(dto: EmailDto, context: RequestContext): Promise<{ accepted: true }> {
    const emailNormalized = normalizeEmail(dto.email);
    this.rateLimiter.consumeForgotPassword(emailNormalized, context.ipAddress ?? 'unknown');

    const token = createOpaqueToken();
    const recipient = await this.repository.createPasswordResetToken({
      emailNormalized,
      token,
      tokenHash: hashOpaqueToken(token),
      now: new Date(),
    });
    if (recipient) {
      await this.sendMailSafely(() =>
        this.mail.sendPasswordReset({
          to: recipient.email,
          fullName: recipient.fullName,
          token: recipient.token,
        }),
      );
    }

    return { accepted: true };
  }

  async resetPassword(dto: ResetPasswordDto, context: RequestContext): Promise<{ reset: true }> {
    const tokenHash = hashOpaqueToken(dto.token);
    this.rateLimiter.consumeResetPasswordPreflight(tokenHash, context.ipAddress ?? 'unknown');

    const eligibility = await this.repository.findPasswordResetEligibility(tokenHash, new Date());
    if (!eligibility) {
      this.throwInvalidPasswordResetToken();
    }
    this.rateLimiter.consumeResetPasswordAccount(eligibility.emailNormalized);

    const passwordHash = await hashPassword(dto.newPassword);
    const reset = await this.repository.resetPassword({
      tokenHash,
      passwordHash,
      // Re-evaluate expiry after Argon2 work and any lock wait.
      now: new Date(),
    });
    if (!reset) {
      this.throwInvalidPasswordResetToken();
    }

    return { reset: true };
  }

  async login(dto: LoginDto, context: RequestContext): Promise<AuthenticationResult> {
    const emailNormalized = normalizeEmail(dto.email);
    this.rateLimiter.consumeLogin(emailNormalized, context.ipAddress ?? 'unknown');

    const user = await this.repository.findPasswordLogin(emailNormalized);
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );
    if (!user || !user.passwordHash || !passwordMatches) {
      await this.repository.recordLoginFailure(user?.id ?? null, context);
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_INVALID_CREDENTIALS',
        'Email or password is incorrect.',
      );
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_ACCOUNT_BLOCKED',
        'This account has been blocked.',
      );
    }
    if (user.status === UserStatus.PENDING || user.emailVerifiedAt === null) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_EMAIL_NOT_VERIFIED',
        'Verify your email before signing in.',
      );
    }

    return this.sessions.beginPrimaryAuthentication(user.id, user.passwordHash, context);
  }

  async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<SessionAuthenticationResult> {
    const refreshTokenHash = hashOpaqueToken(refreshToken);
    this.rateLimiter.consumeRefreshPreflight(context.ipAddress ?? 'unknown');
    const tokenFamilyId = await this.repository.findRefreshTokenFamilyId(refreshTokenHash);
    if (tokenFamilyId !== null) {
      this.rateLimiter.consumeRefreshFamily(tokenFamilyId);
    }

    return this.sessions.refresh(refreshToken, context);
  }

  async logout(refreshToken: string | undefined): Promise<{ loggedOut: true }> {
    await this.sessions.logout(refreshToken);
    return { loggedOut: true };
  }

  private async sendMailSafely(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        return;
      }
      throw error;
    }
  }

  private throwInvalidPasswordResetToken(): never {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'AUTH_PASSWORD_RESET_TOKEN_INVALID',
      'The password reset token is invalid or expired.',
    );
  }
}
