import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { decodeEncryptionKey } from '../../config/encryption-key';

const ALGORITHM = 'aes-256-gcm';
const CIPHERTEXT_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const AAD_CONTEXT = 'hicas:mfa:totp-secret';
const BASE64URL_PATTERN = /^[A-Za-z\d_-]+$/;
const TOTP_SECRET_PATTERN = /^[A-Z2-7]{32}$/;

export class MfaSecretCipherError extends Error {
  constructor() {
    super('MFA secret ciphertext is invalid.');
    this.name = MfaSecretCipherError.name;
  }
}

@Injectable()
export class MfaSecretCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = decodeEncryptionKey(config.getOrThrow<string>('MFA_ENCRYPTION_KEY'));
  }

  encrypt(secret: string, userId: string): string {
    this.assertEncryptionInput(secret, userId);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(this.buildAdditionalAuthenticatedData(userId));

    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      CIPHERTEXT_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      authTag.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, userId: string): string {
    try {
      if (userId.length === 0) {
        throw new MfaSecretCipherError();
      }

      const segments = payload.split('.');
      if (segments.length !== 4) {
        throw new MfaSecretCipherError();
      }

      const [version, encodedIv, encodedCiphertext, encodedAuthTag] = segments;
      if (
        version !== CIPHERTEXT_VERSION ||
        encodedIv === undefined ||
        encodedCiphertext === undefined ||
        encodedAuthTag === undefined
      ) {
        throw new MfaSecretCipherError();
      }

      const iv = this.decodeSegment(encodedIv, IV_BYTES);
      const ciphertext = this.decodeSegment(encodedCiphertext);
      const authTag = this.decodeSegment(encodedAuthTag, AUTH_TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(this.buildAdditionalAuthenticatedData(userId));
      decipher.setAuthTag(authTag);

      const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
      if (!TOTP_SECRET_PATTERN.test(secret)) {
        throw new MfaSecretCipherError();
      }

      return secret;
    } catch {
      throw new MfaSecretCipherError();
    }
  }

  private assertEncryptionInput(secret: string, userId: string): void {
    if (!TOTP_SECRET_PATTERN.test(secret) || userId.length === 0) {
      throw new Error('A canonical TOTP secret and user ID are required.');
    }
  }

  private buildAdditionalAuthenticatedData(userId: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        context: AAD_CONTEXT,
        version: CIPHERTEXT_VERSION,
        userId,
      }),
      'utf8',
    );
  }

  private decodeSegment(value: string, expectedBytes?: number): Buffer {
    if (!BASE64URL_PATTERN.test(value)) {
      throw new MfaSecretCipherError();
    }

    const decoded = Buffer.from(value, 'base64url');
    if (
      decoded.length === 0 ||
      decoded.toString('base64url') !== value ||
      (expectedBytes !== undefined && decoded.length !== expectedBytes)
    ) {
      throw new MfaSecretCipherError();
    }

    return decoded;
  }
}
