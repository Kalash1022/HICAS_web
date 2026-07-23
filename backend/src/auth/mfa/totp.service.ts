import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_SECRET_PATTERN = /^[A-Z2-7]{32}$/;
const TOTP_CODE_PATTERN = /^\d{6}$/;
const SECRET_BYTES = 20;
const TIME_STEP_SECONDS = 30;
const WINDOW_STEPS = 1;
const OTP_MODULUS = 1_000_000;

@Injectable()
export class TotpService {
  generateSecret(): string {
    return this.encodeBase32(randomBytes(SECRET_BYTES));
  }

  createOtpAuthUri(secret: string, accountName: string, issuer = 'HICAS'): string {
    this.decodeSecret(secret);

    const normalizedAccountName = accountName.trim();
    const normalizedIssuer = issuer.trim();
    if (normalizedAccountName.length === 0 || normalizedIssuer.length === 0) {
      throw new Error('TOTP account name and issuer must not be empty.');
    }

    const label = encodeURIComponent(`${normalizedIssuer}:${normalizedAccountName}`);
    const parameters = new URLSearchParams({
      secret,
      issuer: normalizedIssuer,
      algorithm: 'SHA1',
      digits: '6',
      period: String(TIME_STEP_SECONDS),
    });

    return `otpauth://totp/${label}?${parameters.toString()}`;
  }

  generateCode(secret: string, at: Date = new Date()): string {
    return this.codeForTimeStep(this.decodeSecret(secret), this.timeStep(at));
  }

  verifyCode(secret: string, code: string, at: Date = new Date()): bigint | null {
    if (!TOTP_CODE_PATTERN.test(code)) {
      return null;
    }

    let secretBytes: Buffer;
    let currentTimeStep: bigint;
    try {
      secretBytes = this.decodeSecret(secret);
      currentTimeStep = this.timeStep(at);
    } catch {
      return null;
    }

    let matchedTimeStep: bigint | null = null;
    for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
      const candidateTimeStep = currentTimeStep + BigInt(offset);
      if (candidateTimeStep < 0n) {
        continue;
      }

      const expectedCode = this.codeForTimeStep(secretBytes, candidateTimeStep);
      if (
        timingSafeEqual(Buffer.from(expectedCode, 'ascii'), Buffer.from(code, 'ascii')) &&
        (matchedTimeStep === null || candidateTimeStep > matchedTimeStep)
      ) {
        matchedTimeStep = candidateTimeStep;
      }
    }

    return matchedTimeStep;
  }

  private timeStep(at: Date): bigint {
    const timestampMilliseconds = at.getTime();
    if (!Number.isFinite(timestampMilliseconds) || timestampMilliseconds < 0) {
      throw new Error('TOTP timestamp is invalid.');
    }

    return BigInt(Math.floor(timestampMilliseconds / 1_000 / TIME_STEP_SECONDS));
  }

  private codeForTimeStep(secret: Buffer, timeStep: bigint): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(timeStep);

    const digest = createHmac('sha1', secret).update(counter).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const binaryCode =
      (((digest[offset]! & 0x7f) << 24) |
        (digest[offset + 1]! << 16) |
        (digest[offset + 2]! << 8) |
        digest[offset + 3]!) >>>
      0;

    return String(binaryCode % OTP_MODULUS).padStart(6, '0');
  }

  private encodeBase32(value: Buffer): string {
    let accumulator = 0;
    let availableBits = 0;
    let result = '';

    for (const byte of value) {
      accumulator = (accumulator << 8) | byte;
      availableBits += 8;

      while (availableBits >= 5) {
        availableBits -= 5;
        result += BASE32_ALPHABET[(accumulator >>> availableBits) & 0x1f];
      }
    }

    if (availableBits > 0) {
      result += BASE32_ALPHABET[(accumulator << (5 - availableBits)) & 0x1f];
    }

    return result;
  }

  private decodeSecret(secret: string): Buffer {
    if (!BASE32_SECRET_PATTERN.test(secret)) {
      throw new Error('TOTP secret must be a canonical 20-byte base32 value.');
    }

    let accumulator = 0;
    let availableBits = 0;
    const decoded: number[] = [];

    for (const character of secret) {
      const value = BASE32_ALPHABET.indexOf(character);
      accumulator = (accumulator << 5) | value;
      availableBits += 5;

      if (availableBits >= 8) {
        availableBits -= 8;
        decoded.push((accumulator >>> availableBits) & 0xff);
      }
    }

    const result = Buffer.from(decoded);
    if (result.byteLength !== SECRET_BYTES || this.encodeBase32(result) !== secret) {
      throw new Error('TOTP secret must encode exactly 20 bytes.');
    }

    return result;
  }
}
