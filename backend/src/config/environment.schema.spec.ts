import { environmentSchema } from './environment.schema';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://hicas:hicas@localhost:5432/hicas',
  DIRECT_URL: 'postgresql://hicas:hicas@localhost:5432/hicas',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:5173/auth/google/callback',
  OAUTH_TRANSACTION_ENCRYPTION_KEY: `${'A'.repeat(43)}=`,
  JWT_ACCESS_SECRET: 'jwt-test-secret-that-is-at-least-32-characters',
  MFA_ENCRYPTION_KEY: `${'B'.repeat(43)}=`,
  MAIL_FROM: 'no-reply@example.com',
  SMTP_HOST: 'localhost',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'hicas',
  S3_ACCESS_KEY: 'test-access-key',
  S3_SECRET_KEY: 'test-secret-key',
};

describe('environmentSchema', () => {
  it('accepts a complete Lean MVP configuration', () => {
    const result = environmentSchema.validate(validEnvironment, { abortEarly: false });
    const value = result.value as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(value.DEFAULT_SHIPPING_FEE_VND).toBe(30_000);
    expect(value.MFA_ISSUER).toBe('HICAS Commerce');
    expect(value.RATE_LIMIT_STORE).toBe('memory');
    expect(value.TRUST_PROXY_HOPS).toBe(0);
    expect(value.CLEANUP_INTERVAL_SECONDS).toBe(3_600);
    expect(value.CLEANUP_BATCH_SIZE).toBe(100);
    expect(value.ORPHAN_IMAGE_GRACE_PERIOD_SECONDS).toBe(3_600);
  });

  it('accepts a bounded reverse-proxy hop count and converts it to a number', () => {
    const result = environmentSchema.validate(
      { ...validEnvironment, TRUST_PROXY_HOPS: '1' },
      { abortEarly: false },
    );
    const value = result.value as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(value.TRUST_PROXY_HOPS).toBe(1);
  });

  it.each([-1, 1.5, 11])('rejects invalid reverse-proxy hop count %s', (hopCount) => {
    const result = environmentSchema.validate(
      { ...validEnvironment, TRUST_PROXY_HOPS: hopCount },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('TRUST_PROXY_HOPS');
  });

  it('rejects encryption keys that do not encode 32 bytes', () => {
    const result = environmentSchema.validate(
      { ...validEnvironment, MFA_ENCRYPTION_KEY: 'too-short' },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('MFA_ENCRYPTION_KEY');
  });

  it('requires independent OAuth and MFA encryption keys', () => {
    const result = environmentSchema.validate(
      {
        ...validEnvironment,
        MFA_ENCRYPTION_KEY: validEnvironment.OAUTH_TRANSACTION_ENCRYPTION_KEY,
      },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('MFA_ENCRYPTION_KEY');
  });

  it.each([-1, 1.5])('rejects invalid shipping fee %s', (shippingFee) => {
    const result = environmentSchema.validate(
      { ...validEnvironment, DEFAULT_SHIPPING_FEE_VND: shippingFee },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('DEFAULT_SHIPPING_FEE_VND');
  });

  it('requires the direct migration database URL', () => {
    const withoutDirectUrl: Record<string, unknown> = { ...validEnvironment };
    delete withoutDirectUrl.DIRECT_URL;
    const result = environmentSchema.validate(withoutDirectUrl, { abortEarly: false });

    expect(result.error?.message).toContain('DIRECT_URL');
  });

  it('requires the Google callback to return to a configured frontend origin', () => {
    const result = environmentSchema.validate(
      {
        ...validEnvironment,
        GOOGLE_REDIRECT_URI: 'http://untrusted.example.com/auth/google/callback',
      },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('GOOGLE_REDIRECT_URI');
    expect(result.error?.message).toContain('FRONTEND_ORIGIN');
  });

  it('reports a malformed Google callback URI without throwing', () => {
    expect(() =>
      environmentSchema.validate(
        {
          ...validEnvironment,
          GOOGLE_REDIRECT_URI: 'not-a-url',
        },
        { abortEarly: false },
      ),
    ).not.toThrow();

    const result = environmentSchema.validate(
      {
        ...validEnvironment,
        GOOGLE_REDIRECT_URI: 'not-a-url',
      },
      { abortEarly: false },
    );
    expect(result.error?.message).toContain('GOOGLE_REDIRECT_URI');
  });

  it.each([
    {
      name: 'an insecure cookie',
      override: {
        COOKIE_SECURE: false,
        FRONTEND_ORIGIN: 'https://shop.example.com',
        GOOGLE_REDIRECT_URI: 'https://shop.example.com/auth/google/callback',
      },
      expected: 'COOKIE_SECURE',
    },
    {
      name: 'an HTTP frontend origin',
      override: {
        COOKIE_SECURE: true,
        FRONTEND_ORIGIN: 'http://shop.example.com',
        GOOGLE_REDIRECT_URI: 'https://shop.example.com/auth/google/callback',
      },
      expected: 'FRONTEND_ORIGIN',
    },
    {
      name: 'an HTTP Google redirect',
      override: {
        COOKIE_SECURE: true,
        FRONTEND_ORIGIN: 'https://shop.example.com',
        GOOGLE_REDIRECT_URI: 'http://shop.example.com/auth/google/callback',
      },
      expected: 'GOOGLE_REDIRECT_URI',
    },
  ])('rejects $name in production', ({ override, expected }) => {
    const result = environmentSchema.validate(
      { ...validEnvironment, ...override, NODE_ENV: 'production' },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain(expected);
  });

  it('requires SMTP username and password to be configured together', () => {
    const result = environmentSchema.validate(
      { ...validEnvironment, SMTP_USER: 'mailer', SMTP_PASSWORD: '' },
      { abortEarly: false },
    );

    expect(result.error?.message).toContain('SMTP_USER');
    expect(result.error?.message).toContain('SMTP_PASSWORD');
  });
});
