import { ConfigService } from '@nestjs/config';

import { OauthTransactionCipher, OauthTransactionCipherError } from './oauth-transaction-cipher';

const STATE_HASH = 'a'.repeat(64);
const PKCE_VERIFIER = 'pkce-verifier-with-sufficient-entropy-for-an-oauth-transaction';

function createCipher(keyByte = 1): OauthTransactionCipher {
  return new OauthTransactionCipher(
    new ConfigService({
      OAUTH_TRANSACTION_ENCRYPTION_KEY: Buffer.alloc(32, keyByte).toString('base64'),
    }),
  );
}

function encodedSegment(bytes: number, fill = 1): string {
  return Buffer.alloc(bytes, fill).toString('base64url');
}

describe(OauthTransactionCipher.name, () => {
  it('round-trips a PKCE verifier with a versioned AES-256-GCM payload', () => {
    const cipher = createCipher();

    const encrypted = cipher.encrypt(PKCE_VERIFIER, STATE_HASH);

    expect(encrypted).toMatch(/^v1\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+$/);
    expect(encrypted).not.toContain(PKCE_VERIFIER);
    expect(cipher.decrypt(encrypted, STATE_HASH)).toBe(PKCE_VERIFIER);
  });

  it('uses a fresh 12-byte IV for every encryption', () => {
    const cipher = createCipher();

    const first = cipher.encrypt(PKCE_VERIFIER, STATE_HASH);
    const second = cipher.encrypt(PKCE_VERIFIER, STATE_HASH);
    const firstIv = first.split('.')[1];
    const secondIv = second.split('.')[1];

    expect(first).not.toBe(second);
    expect(firstIv).toBeDefined();
    expect(secondIv).toBeDefined();
    expect(Buffer.from(firstIv ?? '', 'base64url')).toHaveLength(12);
    expect(Buffer.from(secondIv ?? '', 'base64url')).toHaveLength(12);
    expect(firstIv).not.toBe(secondIv);
  });

  it('binds the ciphertext to the OAuth transaction state hash through AAD', () => {
    const cipher = createCipher();
    const encrypted = cipher.encrypt(PKCE_VERIFIER, STATE_HASH);

    expect(() => cipher.decrypt(encrypted, 'b'.repeat(64))).toThrow(OauthTransactionCipherError);
  });

  it('rejects ciphertext or authentication-tag tampering and the wrong key', () => {
    const cipher = createCipher();
    const encrypted = cipher.encrypt(PKCE_VERIFIER, STATE_HASH);
    const segments = encrypted.split('.');
    const encodedCiphertext = segments[2];
    const encodedAuthTag = segments[3];
    if (encodedCiphertext === undefined || encodedAuthTag === undefined) {
      throw new Error('Expected a complete encrypted payload');
    }

    const tamperedCiphertext = Buffer.from(encodedCiphertext, 'base64url');
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
    segments[2] = tamperedCiphertext.toString('base64url');
    expect(() => cipher.decrypt(segments.join('.'), STATE_HASH)).toThrow(
      OauthTransactionCipherError,
    );

    const tagSegments = encrypted.split('.');
    const tamperedAuthTag = Buffer.from(encodedAuthTag, 'base64url');
    tamperedAuthTag[0] = (tamperedAuthTag[0] ?? 0) ^ 1;
    tagSegments[3] = tamperedAuthTag.toString('base64url');
    expect(() => cipher.decrypt(tagSegments.join('.'), STATE_HASH)).toThrow(
      OauthTransactionCipherError,
    );

    expect(() => createCipher(2).decrypt(encrypted, STATE_HASH)).toThrow(
      OauthTransactionCipherError,
    );
  });

  it.each([
    '',
    'v1.only-two-segments',
    `v2.${encodedSegment(12)}.${encodedSegment(32)}.${encodedSegment(16)}`,
    `v1.***.${encodedSegment(32)}.${encodedSegment(16)}`,
    `v1.${encodedSegment(11)}.${encodedSegment(32)}.${encodedSegment(16)}`,
    `v1.${encodedSegment(12)}..${encodedSegment(16)}`,
    `v1.${encodedSegment(12)}.${encodedSegment(32)}.${encodedSegment(15)}`,
    `v1.${encodedSegment(12)}.${encodedSegment(32)}.${encodedSegment(16)}.extra`,
  ])('rejects malformed payload %p', (payload) => {
    expect(() => createCipher().decrypt(payload, STATE_HASH)).toThrow(OauthTransactionCipherError);
  });

  it('rejects empty encryption inputs and invalid key configuration', () => {
    const cipher = createCipher();

    expect(() => cipher.encrypt('', STATE_HASH)).toThrow(
      'PKCE verifier and state hash must not be empty.',
    );
    expect(() => cipher.encrypt(PKCE_VERIFIER, '')).toThrow(
      'PKCE verifier and state hash must not be empty.',
    );
    expect(
      () =>
        new OauthTransactionCipher(
          new ConfigService({ OAUTH_TRANSACTION_ENCRYPTION_KEY: 'invalid' }),
        ),
    ).toThrow('Encryption key must be 32 bytes');
  });
});
