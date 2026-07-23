import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';

import { GoogleAuthRepository } from './google-auth.repository';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOidcClient } from './google-oidc.client';
import { OauthTransactionCipher } from './oauth-transaction-cipher';
import { AuthRateLimiterService } from '../services/auth-rate-limiter.service';
import { SessionService } from '../services/session.service';
import { hashOpaqueToken } from '../utilities/auth-crypto';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const STATE = 's'.repeat(43);
const NONCE = 'n'.repeat(43);
const STATE_HASH = hashOpaqueToken(STATE);
const NONCE_HASH = hashOpaqueToken(NONCE);

describe(GoogleAuthService.name, () => {
  let repository: jest.Mocked<GoogleAuthRepository>;
  let cipher: jest.Mocked<OauthTransactionCipher>;
  let oidc: jest.Mocked<GoogleOidcClient>;
  let sessions: jest.Mocked<SessionService>;
  let rateLimiter: jest.Mocked<AuthRateLimiterService>;
  let service: GoogleAuthService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    repository = {
      createOauthTransaction: jest.fn(),
      claimOauthTransaction: jest.fn(),
      resolveGoogleIdentity: jest.fn(),
    } as unknown as jest.Mocked<GoogleAuthRepository>;
    cipher = {
      encrypt: jest.fn().mockReturnValue('encrypted-pkce-verifier'),
      decrypt: jest.fn().mockReturnValue('plain-pkce-verifier'),
    } as unknown as jest.Mocked<OauthTransactionCipher>;
    oidc = {
      createPkcePair: jest.fn().mockResolvedValue({
        codeVerifier: 'plain-pkce-verifier',
        codeChallenge: 'pkce-challenge',
      }),
      createAuthorizationUrl: jest
        .fn()
        .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?request=1'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue('google-id-token'),
      verifyIdToken: jest.fn(),
    } as unknown as jest.Mocked<GoogleOidcClient>;
    sessions = {
      beginGoogleAuthentication: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;
    rateLimiter = {
      consumeGoogleAuthorization: jest.fn(),
      consumeGoogleCallback: jest.fn(),
    } as unknown as jest.Mocked<AuthRateLimiterService>;
    service = new GoogleAuthService(
      repository,
      cipher,
      oidc,
      sessions,
      rateLimiter,
      new ConfigService({
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_REDIRECT_URI: 'https://shop.example.com/auth/google/callback',
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists only hashes and an encrypted PKCE verifier before returning the URL', async () => {
    await expect(service.createAuthorizationUrl({ ipAddress: '127.0.0.1' })).resolves.toMatchObject(
      {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?request=1',
        expiresIn: 600,
      },
    );

    const authorizationInput = oidc.createAuthorizationUrl.mock.calls[0]?.[0];
    const createInput = repository.createOauthTransaction.mock.calls[0]?.[0];
    expect(authorizationInput?.state).toHaveLength(43);
    expect(authorizationInput?.nonce).toHaveLength(43);
    expect(authorizationInput?.state).not.toBe(authorizationInput?.nonce);
    expect(createInput).toEqual({
      stateHash: hashOpaqueToken(authorizationInput?.state ?? ''),
      nonceHash: hashOpaqueToken(authorizationInput?.nonce ?? ''),
      pkceVerifierEncrypted: 'encrypted-pkce-verifier',
      redirectUri: 'https://shop.example.com/auth/google/callback',
      expiresAt: new Date('2026-07-23T12:10:00.000Z'),
    });
    expect(createInput?.stateHash).not.toContain(authorizationInput?.state ?? '');
    expect(createInput?.nonceHash).not.toContain(authorizationInput?.nonce ?? '');
    expect(createInput?.pkceVerifierEncrypted).not.toContain('plain-pkce-verifier');
    expect(rateLimiter.consumeGoogleAuthorization.mock.calls).toEqual([['127.0.0.1']]);
  });

  it('claims state before exchanging code and resolves identity by verified subject', async () => {
    repository.claimOauthTransaction.mockResolvedValue({
      kind: 'claimed',
      transactionId: 'transaction-id',
      nonceHash: NONCE_HASH,
      pkceVerifierEncrypted: 'encrypted-pkce-verifier',
      redirectUri: 'https://shop.example.com/auth/google/callback',
    });
    oidc.verifyIdToken.mockResolvedValue(validClaims());
    repository.resolveGoogleIdentity.mockResolvedValue({
      kind: 'resolved',
      created: true,
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        fullName: 'Customer',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: NOW,
      },
    });
    sessions.beginGoogleAuthentication.mockResolvedValue({
      kind: 'mfa-enrollment',
      mfaEnrollmentRequired: true,
      enrollmentToken: 'enrollment-token',
      expiresIn: 600,
    });

    await expect(
      service.callback('authorization-code', STATE, { ipAddress: '127.0.0.2' }),
    ).resolves.toMatchObject({
      kind: 'mfa-enrollment',
      enrollmentToken: 'enrollment-token',
    });

    expect(repository.claimOauthTransaction.mock.calls).toEqual([[STATE_HASH, NOW]]);
    expect(repository.claimOauthTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      oidc.exchangeAuthorizationCode.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(oidc.exchangeAuthorizationCode.mock.calls).toEqual([
      ['authorization-code', 'plain-pkce-verifier'],
    ]);
    expect(repository.resolveGoogleIdentity.mock.calls[0]?.[0]).toMatchObject({
      providerAccountId: 'google-subject',
      providerEmail: 'customer@example.com',
      emailNormalized: 'customer@example.com',
      fullName: 'Customer',
      avatarUrl: 'https://images.example.com/avatar.png',
    });
    expect(sessions.beginGoogleAuthentication.mock.calls).toEqual([
      ['user-id', 'google-subject', { ipAddress: '127.0.0.2' }],
    ]);
    expect(rateLimiter.consumeGoogleCallback.mock.calls).toEqual([['127.0.0.2']]);
  });

  it.each([
    ['not-found', 400, 'OAUTH_TRANSACTION_INVALID'],
    ['expired', 400, 'OAUTH_TRANSACTION_INVALID'],
    ['already-used', 409, 'OAUTH_TRANSACTION_ALREADY_USED'],
  ] as const)('rejects %s state before any provider call', async (kind, status, code) => {
    repository.claimOauthTransaction.mockResolvedValue({ kind });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status,
      response: { code },
    });
    expect(oidc.exchangeAuthorizationCode.mock.calls).toHaveLength(0);
  });

  it('consumes the transaction even when Google code exchange fails', async () => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.exchangeAuthorizationCode.mockRejectedValue(new Error('invalid_grant'));

    await expect(service.callback('bad-code', STATE, {})).rejects.toMatchObject({
      status: 401,
      response: { code: 'OAUTH_CODE_EXCHANGE_FAILED' },
    });
    expect(repository.claimOauthTransaction.mock.calls).toHaveLength(1);
    expect(repository.resolveGoogleIdentity.mock.calls).toHaveLength(0);
  });

  it('maps provider outages without exposing the provider error', async () => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.exchangeAuthorizationCode.mockRejectedValue({
      code: 'ETIMEDOUT',
      response: { status: 503, data: { id_token: 'must-not-leak' } },
    });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'OAUTH_PROVIDER_UNAVAILABLE',
        message: 'Google sign-in is temporarily unavailable. Try again.',
      },
    });
  });

  it('rejects an unverified Google email before identity resolution', async () => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.verifyIdToken.mockResolvedValue({
      ...validClaims(),
      emailVerified: false,
    });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status: 403,
      response: { code: 'OAUTH_EMAIL_NOT_VERIFIED' },
    });
    expect(repository.resolveGoogleIdentity.mock.calls).toHaveLength(0);
  });

  it('rejects a missing or mismatched nonce with the required error code', async () => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.verifyIdToken.mockResolvedValue({
      ...validClaims(),
      nonce: 'different-nonce',
    });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status: 401,
      response: { code: 'OAUTH_NONCE_INVALID' },
    });
    expect(repository.resolveGoogleIdentity.mock.calls).toHaveLength(0);
  });

  it.each([
    ['issuer', { issuer: 'https://attacker.example.com' }],
    ['audience', { audience: 'another-client-id' }],
    ['authorized party', { authorizedParty: 'another-client-id' }],
    ['issued-at time', { issuedAt: Math.floor(NOW.getTime() / 1_000) + 60 }],
    ['expiration time', { expiresAt: Math.floor(NOW.getTime() / 1_000) }],
  ])('rejects an ID token with an invalid %s claim', async (_claimName, override) => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.verifyIdToken.mockResolvedValue({
      ...validClaims(),
      ...override,
    });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status: 401,
      response: { code: 'OAUTH_ID_TOKEN_INVALID' },
    });
    expect(repository.resolveGoogleIdentity.mock.calls).toHaveLength(0);
  });

  it('refuses email-based auto-linking', async () => {
    repository.claimOauthTransaction.mockResolvedValue(claimedTransaction());
    oidc.verifyIdToken.mockResolvedValue(validClaims());
    repository.resolveGoogleIdentity.mockResolvedValue({
      kind: 'account-link-required',
    });

    await expect(service.callback('authorization-code', STATE, {})).rejects.toMatchObject({
      status: 409,
      response: { code: 'OAUTH_ACCOUNT_LINK_REQUIRED' },
    });
    expect(sessions.beginGoogleAuthentication.mock.calls).toHaveLength(0);
  });
});

function claimedTransaction() {
  return {
    kind: 'claimed' as const,
    transactionId: 'transaction-id',
    nonceHash: NONCE_HASH,
    pkceVerifierEncrypted: 'encrypted-pkce-verifier',
    redirectUri: 'https://shop.example.com/auth/google/callback',
  };
}

function validClaims() {
  return {
    issuer: 'https://accounts.google.com',
    audience: 'google-client-id',
    subject: 'google-subject',
    email: 'customer@example.com',
    emailVerified: true,
    name: 'Customer',
    picture: 'https://images.example.com/avatar.png',
    nonce: NONCE,
    issuedAt: Math.floor(NOW.getTime() / 1_000) - 60,
    expiresAt: Math.floor(NOW.getTime() / 1_000) + 3_600,
  };
}
