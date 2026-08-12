import { HttpStatus, Injectable } from '@nestjs/common';

import { ApplicationException } from '../common/exceptions/application.exception';

interface CheckoutRateLimitBucket {
  timestamps: number[];
  expiresAt: number;
}

const CHECKOUT_WINDOW_MS = 10 * 60 * 1_000;
const CHECKOUT_LIMIT = 10;
const PRUNE_INTERVAL = 128;
export const CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS = 10_000;

@Injectable()
export class CheckoutRateLimiterService {
  private readonly attempts = new Map<string, CheckoutRateLimitBucket>();
  private operationsSincePrune = 0;

  consume(userId: string, ipAddress?: string): void {
    const now = Date.now();
    this.operationsSincePrune += 1;
    if (
      this.operationsSincePrune >= PRUNE_INTERVAL ||
      this.attempts.size >= CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS
    ) {
      this.pruneExpired(now);
      this.operationsSincePrune = 0;
    }

    const keys = [`checkout:user:${userId}`, `checkout:ip:${ipAddress ?? 'unknown'}`];
    const activeAttempts = keys.map((key) => ({
      key,
      timestamps: (this.attempts.get(key)?.timestamps ?? []).filter(
        (timestamp) => timestamp > now - CHECKOUT_WINDOW_MS,
      ),
    }));
    if (activeAttempts.some(({ timestamps }) => timestamps.length >= CHECKOUT_LIMIT)) {
      throw new ApplicationException(
        HttpStatus.TOO_MANY_REQUESTS,
        'CHECKOUT_RATE_LIMITED',
        'Too many checkout attempts. Please try again later.',
      );
    }

    for (const { key, timestamps } of activeAttempts) {
      timestamps.push(now);
      this.attempts.delete(key);
      this.attempts.set(key, { timestamps, expiresAt: now + CHECKOUT_WINDOW_MS });
    }
    this.trimToMaximum(new Set(keys));
  }

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.attempts) {
      if (bucket.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }

  private trimToMaximum(protectedKeys: ReadonlySet<string>): void {
    if (this.attempts.size <= CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS) {
      return;
    }

    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS) {
        return;
      }
      if (!protectedKeys.has(key)) {
        this.attempts.delete(key);
      }
    }
  }
}
