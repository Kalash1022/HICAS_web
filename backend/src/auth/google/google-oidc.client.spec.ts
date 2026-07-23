import { ConfigService } from '@nestjs/config';

import { GoogleOidcClient } from './google-oidc.client';

describe(GoogleOidcClient.name, () => {
  it('builds the fixed Google authorization request without offline access', () => {
    const client = new GoogleOidcClient(
      new ConfigService({
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
        GOOGLE_REDIRECT_URI: 'https://shop.example.com/auth/google/callback',
      }),
    );

    const result = new URL(
      client.createAuthorizationUrl({
        state: 'state-value',
        nonce: 'nonce-value',
        codeChallenge: 'pkce-code-challenge',
      }),
    );

    expect(result.origin + result.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(result.searchParams.get('client_id')).toBe('google-client-id');
    expect(result.searchParams.get('redirect_uri')).toBe(
      'https://shop.example.com/auth/google/callback',
    );
    expect(result.searchParams.get('response_type')).toBe('code');
    expect(result.searchParams.get('scope')).toBe('openid email profile');
    expect(result.searchParams.get('state')).toBe('state-value');
    expect(result.searchParams.get('nonce')).toBe('nonce-value');
    expect(result.searchParams.get('code_challenge')).toBe('pkce-code-challenge');
    expect(result.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.searchParams.has('access_type')).toBe(false);
    expect(result.searchParams.has('prompt')).toBe(false);
  });
});
