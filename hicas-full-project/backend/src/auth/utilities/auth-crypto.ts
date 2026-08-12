import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import * as argon2 from 'argon2';

import { OPAQUE_TOKEN_BYTES, PASSWORD_HASH_OPTIONS } from '../auth.constants';

export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}

export function createOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    ...PASSWORD_HASH_OPTIONS,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMilliseconds(date, seconds * 1_000);
}

export function addDays(date: Date, days: number): Date {
  return addMilliseconds(date, days * 24 * 60 * 60 * 1_000);
}

export function parseDurationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error('Invalid duration');
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * (unit === undefined ? 0 : (multipliers[unit] ?? 0));
}
