export const REFRESH_TOKEN_COOKIE = 'hicas_refresh_token';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;
export const MFA_ENROLLMENT_TTL_SECONDS = 10 * 60;

export const OPAQUE_TOKEN_BYTES = 32;

export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
