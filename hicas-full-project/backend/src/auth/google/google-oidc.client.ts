import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

export interface GoogleIdTokenClaims {
  issuer: string;
  audience: string;
  authorizedParty?: string;
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
  issuedAt: number;
  expiresAt: number;
}

export interface GooglePkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

@Injectable()
export class GoogleOidcClient {
  private readonly client: OAuth2Client;
  private readonly clientId: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    this.clientId = config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.redirectUri = config.getOrThrow<string>('GOOGLE_REDIRECT_URI');
    this.client = new OAuth2Client({
      clientId: this.clientId,
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      redirectUri: this.redirectUri,
      transporterOptions: {
        timeout: 10_000,
      },
    });
  }

  async createPkcePair(): Promise<GooglePkcePair> {
    const result = await this.client.generateCodeVerifierAsync();
    if (!result.codeChallenge) {
      throw new Error('Google Auth Library did not generate a PKCE challenge.');
    }

    return {
      codeVerifier: result.codeVerifier,
      codeChallenge: result.codeChallenge,
    };
  }

  createAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string {
    const authorizationUrl = new URL(
      this.client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    );
    // google-auth-library does not currently expose nonce in GenerateAuthUrlOpts,
    // but Google OIDC accepts it on the authorization endpoint.
    authorizationUrl.searchParams.set('nonce', input.nonce);
    return authorizationUrl.toString();
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<string> {
    const response = await this.client.getToken({
      code,
      codeVerifier,
      redirect_uri: this.redirectUri,
    });
    const idToken = response.tokens.id_token;
    if (typeof idToken !== 'string' || idToken.length === 0) {
      throw new Error('Google token response did not contain an ID token.');
    }

    return idToken;
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Google ID token did not contain a payload.');
    }

    return {
      issuer: payload.iss,
      audience: payload.aud,
      ...(payload.azp ? { authorizedParty: payload.azp } : {}),
      subject: payload.sub,
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.email_verified === undefined ? {} : { emailVerified: payload.email_verified }),
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.picture ? { picture: payload.picture } : {}),
      ...(payload.nonce ? { nonce: payload.nonce } : {}),
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }
}
