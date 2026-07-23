import { ConfigService } from '@nestjs/config';

import { MfaSecretCipher, MfaSecretCipherError } from './mfa-secret-cipher';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function createCipher(fill: number): MfaSecretCipher {
  return new MfaSecretCipher(
    new ConfigService({
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, fill).toString('base64'),
    }),
  );
}

describe(MfaSecretCipher.name, () => {
  it('round-trips a TOTP secret and uses a fresh IV for every encryption', () => {
    const cipher = createCipher(3);
    const first = cipher.encrypt(SECRET, 'user-id');
    const second = cipher.encrypt(SECRET, 'user-id');

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first, 'user-id')).toBe(SECRET);
    expect(cipher.decrypt(second, 'user-id')).toBe(SECRET);
  });

  it('binds ciphertext authentication to the owning user ID', () => {
    const cipher = createCipher(3);
    const encrypted = cipher.encrypt(SECRET, 'user-a');

    expect(() => cipher.decrypt(encrypted, 'user-b')).toThrow(MfaSecretCipherError);
  });

  it('rejects ciphertext created with another encryption key', () => {
    const encrypted = createCipher(3).encrypt(SECRET, 'user-id');

    expect(() => createCipher(4).decrypt(encrypted, 'user-id')).toThrow(MfaSecretCipherError);
  });

  it('returns one typed corruption error for tampered and malformed payloads', () => {
    const cipher = createCipher(3);
    const encrypted = cipher.encrypt(SECRET, 'user-id');
    const segments = encrypted.split('.');
    const ciphertext = segments[2]!;
    segments[2] = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;

    expect(() => cipher.decrypt(segments.join('.'), 'user-id')).toThrow(MfaSecretCipherError);
    expect(() => cipher.decrypt('not-a-ciphertext', 'user-id')).toThrow(MfaSecretCipherError);
  });

  it('rejects invalid encryption inputs before writing ciphertext', () => {
    const cipher = createCipher(3);

    expect(() => cipher.encrypt('not-a-secret', 'user-id')).toThrow();
    expect(() => cipher.encrypt(SECRET, '')).toThrow();
  });
});
