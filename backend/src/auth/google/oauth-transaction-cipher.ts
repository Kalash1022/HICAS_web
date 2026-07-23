import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { decodeEncryptionKey } from '../../config/encryption-key';

const ALGORITHM = 'aes-256-gcm';
const CIPHERTEXT_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const AAD_CONTEXT = 'hicas:oauth-transaction:pkce-verifier';
const BASE64URL_PATTERN = /^[A-Za-z\d_-]+$/;

export class OauthTransactionCipherError extends Error {
  constructor() {
    super('OAuth transaction ciphertext is invalid.');
    this.name = OauthTransactionCipherError.name;
  }
}

@Injectable()
export class OauthTransactionCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = decodeEncryptionKey(config.getOrThrow<string>('OAUTH_TRANSACTION_ENCRYPTION_KEY'));
  }

  encrypt(pkceVerifier: string, stateHash: string): string {
    this.assertEncryptionInput(pkceVerifier, stateHash);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(this.buildAdditionalAuthenticatedData(stateHash));

    const ciphertext = Buffer.concat([cipher.update(pkceVerifier, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      CIPHERTEXT_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      authTag.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, stateHash: string): string {
    try {
      if (stateHash.length === 0) {
        throw new OauthTransactionCipherError();
      }

      const segments = payload.split('.');
      if (segments.length !== 4) {
        throw new OauthTransactionCipherError();
      }

      const [version, encodedIv, encodedCiphertext, encodedAuthTag] = segments;
      if (
        version !== CIPHERTEXT_VERSION ||
        encodedIv === undefined ||
        encodedCiphertext === undefined ||
        encodedAuthTag === undefined
      ) {
        throw new OauthTransactionCipherError();
      }

      const iv = this.decodeSegment(encodedIv, IV_BYTES);
      const ciphertext = this.decodeSegment(encodedCiphertext);
      const authTag = this.decodeSegment(encodedAuthTag, AUTH_TAG_BYTES);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(this.buildAdditionalAuthenticatedData(stateHash));
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new OauthTransactionCipherError();
    }
  }

  private assertEncryptionInput(pkceVerifier: string, stateHash: string): void {
    if (pkceVerifier.length === 0 || stateHash.length === 0) {
      throw new Error('PKCE verifier and state hash must not be empty.');
    }
  }

  private buildAdditionalAuthenticatedData(stateHash: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        context: AAD_CONTEXT,
        version: CIPHERTEXT_VERSION,
        stateHash,
      }),
      'utf8',
    );
  }

  private decodeSegment(value: string, expectedBytes?: number): Buffer {
    if (!BASE64URL_PATTERN.test(value)) {
      throw new OauthTransactionCipherError();
    }

    const decoded = Buffer.from(value, 'base64url');
    if (
      decoded.length === 0 ||
      decoded.toString('base64url') !== value ||
      (expectedBytes !== undefined && decoded.length !== expectedBytes)
    ) {
      throw new OauthTransactionCipherError();
    }

    return decoded;
  }
}
