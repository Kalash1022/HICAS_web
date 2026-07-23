import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS } from '../auth.constants';
import type { AuthenticationResult, RequestContext } from '../auth.types';
import { AuthRateLimiterService } from '../services/auth-rate-limiter.service';
import { SessionService } from '../services/session.service';
import {
  addSeconds,
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
} from '../utilities/auth-crypto';
import { GoogleAuthRepository } from './google-auth.repository';
import { type GoogleIdTokenClaims, GoogleOidcClient } from './google-oidc.client';
import { OauthTransactionCipher, OauthTransactionCipherError } from './oauth-transaction-cipher';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const PROVIDER_UNAVAILABLE_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

export interface GoogleAuthorizationStart {
  authorizationUrl: string;
  browserState: string;
  expiresIn: number;
}

@Injectable()
export class GoogleAuthService {
  private readonly clientId: string;
  private readonly redirectUri: string;

  constructor(
    private readonly repository: GoogleAuthRepository,
    private readonly cipher: OauthTransactionCipher,
    private readonly oidc: GoogleOidcClient,
    private readonly sessions: SessionService,
    private readonly rateLimiter: AuthRateLimiterService,
    config: ConfigService,
  ) {
    this.clientId = config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.redirectUri = config.getOrThrow<string>('GOOGLE_REDIRECT_URI');
  }

  async createAuthorizationUrl(context: RequestContext): Promise<GoogleAuthorizationStart> {
    this.rateLimiter.consumeGoogleAuthorization(context.ipAddress ?? 'unknown');

    const state = createOpaqueToken();
    const nonce = createOpaqueToken();
    const pkce = await this.oidc.createPkcePair();
    const stateHash = hashOpaqueToken(state);
    const nonceHash = hashOpaqueToken(nonce);
    const authorizationUrl = this.oidc.createAuthorizationUrl({
      state,
      nonce,
      codeChallenge: pkce.codeChallenge,
    });
    const pkceVerifierEncrypted = this.cipher.encrypt(pkce.codeVerifier, stateHash);
    const now = new Date();

    await this.repository.createOauthTransaction({
      stateHash,
      nonceHash,
      pkceVerifierEncrypted,
      redirectUri: this.redirectUri,
      expiresAt: addSeconds(now, GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS),
    });

    return {
      authorizationUrl,
      browserState: state,
      expiresIn: GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS,
    };
  }

  async callback(
    code: string,
    state: string,
    context: RequestContext,
  ): Promise<AuthenticationResult> {
    this.rateLimiter.consumeGoogleCallback(context.ipAddress ?? 'unknown');

    const stateHash = hashOpaqueToken(state);
    const transaction = await this.repository.claimOauthTransaction(stateHash, new Date());
    if (transaction.kind === 'already-used') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'OAUTH_TRANSACTION_ALREADY_USED',
        'This Google sign-in attempt has already been used. Start again.',
      );
    }
    if (transaction.kind === 'not-found' || transaction.kind === 'expired') {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'OAUTH_TRANSACTION_INVALID',
        'This Google sign-in attempt is invalid or expired. Start again.',
      );
    }
    if (transaction.redirectUri !== this.redirectUri) {
      throw new ApplicationException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'OAUTH_TRANSACTION_CORRUPTED',
        'The Google sign-in attempt could not be completed.',
      );
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.cipher.decrypt(transaction.pkceVerifierEncrypted, stateHash);
    } catch (error) {
      if (error instanceof OauthTransactionCipherError) {
        throw new ApplicationException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'OAUTH_TRANSACTION_CORRUPTED',
          'The Google sign-in attempt could not be completed.',
        );
      }
      throw error;
    }

    const idToken = await this.exchangeCode(code, codeVerifier);
    const claims = await this.verifyIdToken(idToken);
    const identity = this.validateClaims(claims, transaction.nonceHash);
    const resolved = await this.repository.resolveGoogleIdentity({
      providerAccountId: identity.subject,
      providerEmail: identity.email,
      emailNormalized: identity.emailNormalized,
      fullName: identity.fullName,
      ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
      now: new Date(),
    });
    if (resolved.kind === 'account-link-required') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'OAUTH_ACCOUNT_LINK_REQUIRED',
        'An account already exists for this email. Sign in with its existing method.',
      );
    }

    return this.sessions.beginGoogleAuthentication(resolved.user.id, identity.subject, context);
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    try {
      return await this.oidc.exchangeAuthorizationCode(code, codeVerifier);
    } catch (error) {
      this.throwGoogleProviderError(
        error,
        'OAUTH_CODE_EXCHANGE_FAILED',
        'The Google authorization code is invalid or expired. Start again.',
      );
    }
  }

  private async verifyIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
    try {
      return await this.oidc.verifyIdToken(idToken);
    } catch (error) {
      this.throwGoogleProviderError(
        error,
        'OAUTH_ID_TOKEN_INVALID',
        'Google could not verify this sign-in. Start again.',
      );
    }
  }

  private validateClaims(
    claims: GoogleIdTokenClaims,
    expectedNonceHash: string,
  ): {
    subject: string;
    email: string;
    emailNormalized: string;
    fullName: string;
    avatarUrl?: string;
  } {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const emailClaim = claims.email;
    if (typeof emailClaim !== 'string') {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'OAUTH_ID_TOKEN_INVALID',
        'Google could not verify this sign-in. Start again.',
      );
    }

    const coreClaimsAreValid =
      GOOGLE_ISSUERS.has(claims.issuer) &&
      claims.audience === this.clientId &&
      (claims.authorizedParty === undefined || claims.authorizedParty === this.clientId) &&
      Number.isInteger(claims.issuedAt) &&
      Number.isInteger(claims.expiresAt) &&
      claims.issuedAt <= nowSeconds &&
      claims.expiresAt > nowSeconds &&
      typeof claims.subject === 'string' &&
      claims.subject.length > 0 &&
      claims.subject.length <= 255 &&
      emailClaim.length <= 254 &&
      isEmail(emailClaim);
    if (!coreClaimsAreValid) {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'OAUTH_ID_TOKEN_INVALID',
        'Google could not verify this sign-in. Start again.',
      );
    }
    if (claims.emailVerified !== true) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'OAUTH_EMAIL_NOT_VERIFIED',
        'Google has not verified this email address.',
      );
    }
    if (
      typeof claims.nonce !== 'string' ||
      !constantTimeEqual(hashOpaqueToken(claims.nonce), expectedNonceHash)
    ) {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'OAUTH_NONCE_INVALID',
        'The Google sign-in nonce is invalid. Start again.',
      );
    }

    const email = emailClaim.trim().normalize('NFKC');
    const emailNormalized = normalizeEmail(email);
    const fullName = this.googleFullName(claims.name, emailNormalized);
    const avatarUrl = this.googleAvatarUrl(claims.picture);

    return {
      subject: claims.subject,
      email,
      emailNormalized,
      fullName,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }

  private googleFullName(name: string | undefined, emailNormalized: string): string {
    const normalizedName = name?.trim().normalize('NFKC');
    if (normalizedName) {
      return normalizedName.slice(0, 120);
    }

    const emailLocalPart = emailNormalized.split('@')[0]?.trim();
    return (emailLocalPart || 'Google user').slice(0, 120);
  }

  private googleAvatarUrl(picture: string | undefined): string | undefined {
    if (!picture || picture.length > 2_048) {
      return undefined;
    }

    try {
      const parsed = new URL(picture);
      return parsed.protocol === 'https:' ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  private throwGoogleProviderError(error: unknown, code: string, message: string): never {
    if (this.isProviderUnavailable(error)) {
      throw new ApplicationException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'OAUTH_PROVIDER_UNAVAILABLE',
        'Google sign-in is temporarily unavailable. Try again.',
      );
    }

    throw new ApplicationException(HttpStatus.UNAUTHORIZED, code, message);
  }

  private isProviderUnavailable(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const candidate = error as {
      code?: unknown;
      response?: { status?: unknown };
    };
    return (
      (typeof candidate.code === 'string' && PROVIDER_UNAVAILABLE_CODES.has(candidate.code)) ||
      (typeof candidate.response?.status === 'number' && candidate.response.status >= 500)
    );
  }
}
