import { HttpStatus, Injectable } from '@nestjs/common';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { hashOpaqueToken } from '../utilities/auth-crypto';

interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitBucket {
  timestamps: number[];
  expiresAt: number;
}

interface RateLimitError {
  code: string;
  message: string;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const PRUNE_INTERVAL = 128;
const AUTH_RATE_LIMIT_ERROR: RateLimitError = {
  code: 'AUTH_RATE_LIMITED',
  message: 'Too many authentication attempts. Please try again later.',
};

export const AUTH_RATE_LIMIT_MAX_TRACKED_KEYS = 10_000;

@Injectable()
export class AuthRateLimiterService {
  private readonly attempts = new Map<string, RateLimitBucket>();
  private operationsSincePrune = 0;

  consumeRegister(emailNormalized: string, ipAddress: string): void {
    this.consume([
      {
        key: `register:email:${hashOpaqueToken(emailNormalized)}`,
        limit: 3,
        windowMs: ONE_HOUR_MS,
      },
      { key: `register:ip:${ipAddress}`, limit: 20, windowMs: ONE_HOUR_MS },
      { key: 'register:global', limit: 1_000, windowMs: ONE_HOUR_MS },
    ]);
  }

  consumeLogin(emailNormalized: string, ipAddress: string): void {
    this.consume([
      {
        key: `login:account:${hashOpaqueToken(emailNormalized)}`,
        limit: 5,
        windowMs: FIFTEEN_MINUTES_MS,
      },
      { key: `login:ip:${ipAddress}`, limit: 5, windowMs: FIFTEEN_MINUTES_MS },
    ]);
  }

  consumeResend(emailNormalized: string, ipAddress: string): void {
    this.consume([
      {
        key: `resend:email:${hashOpaqueToken(emailNormalized)}`,
        limit: 3,
        windowMs: ONE_HOUR_MS,
      },
      { key: `resend:ip:${ipAddress}`, limit: 10, windowMs: ONE_HOUR_MS },
    ]);
  }

  consumeForgotPassword(emailNormalized: string, ipAddress: string): void {
    this.consume([
      {
        key: `forgot:email:${hashOpaqueToken(emailNormalized)}`,
        limit: 3,
        windowMs: ONE_HOUR_MS,
      },
      { key: `forgot:ip:${ipAddress}`, limit: 10, windowMs: ONE_HOUR_MS },
    ]);
  }

  consumeResetPasswordPreflight(tokenHash: string, ipAddress: string): void {
    this.consume([
      {
        key: `reset:token:${tokenHash}`,
        limit: 5,
        windowMs: FIFTEEN_MINUTES_MS,
      },
      { key: `reset:ip:${ipAddress}`, limit: 20, windowMs: FIFTEEN_MINUTES_MS },
      { key: 'reset:global', limit: 1_000, windowMs: FIFTEEN_MINUTES_MS },
    ]);
  }

  consumeResetPasswordAccount(emailNormalized: string): void {
    this.consume([
      {
        key: `reset:account:${hashOpaqueToken(emailNormalized)}`,
        limit: 5,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    ]);
  }

  consumeGoogleAuthorization(ipAddress: string): void {
    this.consume([
      {
        key: `google-authorization:ip:${ipAddress}`,
        limit: 20,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    ]);
  }

  consumeGoogleCallback(ipAddress: string): void {
    this.consume([
      {
        key: `google-callback:ip:${ipAddress}`,
        limit: 10,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    ]);
  }

  consumeMfaSetup(userId: string): void {
    this.consume([
      {
        key: `mfa-setup:user:${userId}`,
        limit: 5,
        windowMs: ONE_HOUR_MS,
      },
    ]);
  }

  consumeMfaEnable(tokenHash: string): void {
    this.consume([
      {
        key: `mfa-enable:token:${tokenHash}`,
        limit: 5,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    ]);
  }

  consumeRefreshPreflight(ipAddress: string): void {
    this.consume([
      { key: `refresh:ip:${ipAddress}`, limit: 60, windowMs: FIFTEEN_MINUTES_MS },
      { key: 'refresh:global', limit: 5_000, windowMs: FIFTEEN_MINUTES_MS },
    ]);
  }

  consumeRefreshFamily(tokenFamilyId: string): void {
    this.consume([
      {
        key: `refresh:family:${tokenFamilyId}`,
        limit: 30,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    ]);
  }

  consumeAvatarUpload(userId: string, ipAddress?: string): void {
    this.consume(
      [
        {
          key: `avatar-upload:user:${hashOpaqueToken(userId)}`,
          limit: 5,
          windowMs: FIFTEEN_MINUTES_MS,
        },
        {
          key: `avatar-upload:ip:${ipAddress ?? 'unknown'}`,
          limit: 15,
          windowMs: FIFTEEN_MINUTES_MS,
        },
      ],
      {
        code: 'IMAGE_UPLOAD_RATE_LIMITED',
        message: 'Too many avatar uploads. Please try again later.',
      },
    );
  }

  private consume(rules: RateLimitRule[], error: RateLimitError = AUTH_RATE_LIMIT_ERROR): void {
    const now = Date.now();
    this.operationsSincePrune += 1;
    if (
      this.operationsSincePrune >= PRUNE_INTERVAL ||
      this.attempts.size >= AUTH_RATE_LIMIT_MAX_TRACKED_KEYS
    ) {
      this.pruneExpired(now);
      this.operationsSincePrune = 0;
    }

    const activeAttempts = rules.map((rule) => {
      const cutoff = now - rule.windowMs;
      const active = (this.attempts.get(rule.key)?.timestamps ?? []).filter(
        (timestamp) => timestamp > cutoff,
      );
      return { rule, active };
    });

    if (activeAttempts.some(({ rule, active }) => active.length >= rule.limit)) {
      throw new ApplicationException(HttpStatus.TOO_MANY_REQUESTS, error.code, error.message);
    }

    for (const { rule, active } of activeAttempts) {
      active.push(now);
      // Refresh insertion order so trimming removes the least recently used buckets first.
      this.attempts.delete(rule.key);
      this.attempts.set(rule.key, {
        timestamps: active,
        expiresAt: now + rule.windowMs,
      });
    }

    this.trimToMaximum(new Set(rules.map((rule) => rule.key)));
  }

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.attempts) {
      if (bucket.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }

  private trimToMaximum(protectedKeys: ReadonlySet<string>): void {
    if (this.attempts.size <= AUTH_RATE_LIMIT_MAX_TRACKED_KEYS) {
      return;
    }

    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= AUTH_RATE_LIMIT_MAX_TRACKED_KEYS) {
        return;
      }
      if (!protectedKeys.has(key)) {
        this.attempts.delete(key);
      }
    }
  }
}
