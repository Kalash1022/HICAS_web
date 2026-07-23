import Joi, { type CustomHelpers } from 'joi';

import { decodeEncryptionKey } from './encryption-key';

const DURATION_PATTERN = /^\d+[smhd]$/;

function validateEncryptionKey(value: string, helpers: CustomHelpers): string {
  try {
    decodeEncryptionKey(value);
    return value;
  } catch {
    return helpers.error('string.encryptionKey') as unknown as string;
  }
}

function validateOrigins(value: string, helpers: CustomHelpers): string {
  const origins = value.split(',').map((origin) => origin.trim());

  if (origins.some((origin) => origin.length === 0)) {
    return helpers.error('string.origins') as unknown as string;
  }

  try {
    for (const origin of origins) {
      const parsed = new URL(origin);
      const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const isExactOrigin = parsed.origin === origin && parsed.pathname === '/';

      if (!isHttp || !isExactOrigin || parsed.search || parsed.hash) {
        return helpers.error('string.origins') as unknown as string;
      }
    }
  } catch {
    return helpers.error('string.origins') as unknown as string;
  }

  return value;
}

function validateEnvironmentRelationships(
  value: Record<string, unknown>,
  helpers: CustomHelpers,
): Record<string, unknown> {
  const smtpUser = typeof value.SMTP_USER === 'string' ? value.SMTP_USER : '';
  const smtpPassword = typeof value.SMTP_PASSWORD === 'string' ? value.SMTP_PASSWORD : '';
  if (smtpUser.length > 0 !== smtpPassword.length > 0) {
    return helpers.message({
      custom: 'SMTP_USER and SMTP_PASSWORD must either both be set or both be empty',
    }) as unknown as Record<string, unknown>;
  }

  const frontendOrigins =
    typeof value.FRONTEND_ORIGIN === 'string'
      ? value.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim())
      : [];
  let googleRedirectUrl: URL;
  try {
    if (typeof value.GOOGLE_REDIRECT_URI !== 'string') {
      throw new TypeError('Missing Google redirect URI');
    }
    googleRedirectUrl = new URL(value.GOOGLE_REDIRECT_URI);
  } catch {
    return helpers.message({
      custom: 'GOOGLE_REDIRECT_URI must be a valid HTTP(S) URL',
    }) as unknown as Record<string, unknown>;
  }

  if (!frontendOrigins.includes(googleRedirectUrl.origin)) {
    return helpers.message({
      custom: 'GOOGLE_REDIRECT_URI origin must match one configured FRONTEND_ORIGIN',
    }) as unknown as Record<string, unknown>;
  }

  if (value.NODE_ENV !== 'production') {
    return value;
  }

  if (value.COOKIE_SECURE !== true) {
    return helpers.message({
      custom: 'COOKIE_SECURE must be true when NODE_ENV is production',
    }) as unknown as Record<string, unknown>;
  }

  if (frontendOrigins.some((origin) => new URL(origin).protocol !== 'https:')) {
    return helpers.message({
      custom: 'FRONTEND_ORIGIN must contain only HTTPS origins in production',
    }) as unknown as Record<string, unknown>;
  }

  if (googleRedirectUrl.protocol !== 'https:') {
    return helpers.message({
      custom: 'GOOGLE_REDIRECT_URI must use HTTPS in production',
    }) as unknown as Record<string, unknown>;
  }

  return value;
}

const encryptionKey = Joi.string().custom(validateEncryptionKey).required().messages({
  'string.encryptionKey':
    '{{#label}} must encode exactly 32 bytes as base64, base64url, or 64-character hex',
});

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().min(1).max(65_535).default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  DATABASE_URL: Joi.string()
    .pattern(/^postgres(?:ql)?:\/\//)
    .required(),
  DIRECT_URL: Joi.string()
    .pattern(/^postgres(?:ql)?:\/\//)
    .required(),
  FRONTEND_ORIGIN: Joi.string().custom(validateOrigins).required().messages({
    'string.origins': '{{#label}} must contain comma-separated exact http(s) origins without paths',
  }),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),

  GOOGLE_CLIENT_ID: Joi.string().trim().min(1).required(),
  GOOGLE_CLIENT_SECRET: Joi.string().min(1).required(),
  GOOGLE_REDIRECT_URI: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  OAUTH_TRANSACTION_ENCRYPTION_KEY: encryptionKey,

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().pattern(DURATION_PATTERN).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().positive().default(14),
  COOKIE_SECURE: Joi.boolean().default(false),

  MFA_CHALLENGE_TTL_SECONDS: Joi.number().integer().positive().default(300),
  MFA_ISSUER: Joi.string().trim().min(1).max(64).default('HICAS Commerce'),
  MFA_ENCRYPTION_KEY: encryptionKey.invalid(Joi.ref('OAUTH_TRANSACTION_ENCRYPTION_KEY')),

  MAIL_PROVIDER: Joi.string().valid('smtp').default('smtp'),
  MAIL_FROM: Joi.string().email().required(),
  SMTP_HOST: Joi.string().trim().min(1).required(),
  SMTP_PORT: Joi.number().integer().min(1).max(65_535).default(587),
  SMTP_USER: Joi.string().trim().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),

  RATE_LIMIT_STORE: Joi.string().valid('memory').default('memory'),
  DEFAULT_SHIPPING_FEE_VND: Joi.number().integer().min(0).default(30_000),

  STORAGE_PROVIDER: Joi.string().valid('s3').default('s3'),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  S3_BUCKET: Joi.string().trim().min(1).required(),
  S3_ACCESS_KEY: Joi.string().min(1).required(),
  S3_SECRET_KEY: Joi.string().min(1).required(),
})
  .custom(validateEnvironmentRelationships)
  .required();
