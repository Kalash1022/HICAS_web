import {
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  parseDurationSeconds,
  verifyPassword,
} from './auth-crypto';

describe('auth crypto utilities', () => {
  it('normalizes email deterministically', () => {
    expect(normalizeEmail('  Customer@EXAMPLE.com ')).toBe('customer@example.com');
    expect(normalizeEmail('ｕｓｅｒ@example.com')).toBe('user@example.com');
  });

  it('creates high-entropy opaque tokens and stores only deterministic hashes', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).toHaveLength(43);
    expect(second).not.toBe(first);
    expect(hashOpaqueToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(first)).toBe(hashOpaqueToken(first));
    expect(hashOpaqueToken(first)).not.toContain(first);
  });

  it('compares opaque values without an early string comparison', () => {
    expect(constantTimeEqual('same-value', 'same-value')).toBe(true);
    expect(constantTimeEqual('same-value', 'different-value')).toBe(false);
    expect(constantTimeEqual('short', 'a-much-longer-value')).toBe(false);
  });

  it('hashes passwords with Argon2id', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toContain('$argon2id$');
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('parses supported access-token durations', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('2h')).toBe(7_200);
    expect(parseDurationSeconds('1d')).toBe(86_400);
    expect(() => parseDurationSeconds('15 minutes')).toThrow('Invalid duration');
  });
});
