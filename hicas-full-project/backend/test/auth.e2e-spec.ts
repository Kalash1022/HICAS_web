import {
  Controller,
  Get,
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  MfaTotpStatus,
  PrimaryAuthMethod,
  SecurityEventType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { shouldRunDatabaseE2e } from './database-e2e';
import { GOOGLE_OAUTH_STATE_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/auth.constants';
import { GoogleOidcClient } from '../src/auth/google/google-oidc.client';
import { TotpService } from '../src/auth/mfa/totp.service';
import { AccessTokenService } from '../src/auth/services/access-token.service';
import { AuthRateLimiterService } from '../src/auth/services/auth-rate-limiter.service';
import { CurrentUser } from '../src/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';
import { DatabaseService } from '../src/database/database.service';
import {
  MAIL_SERVICE,
  type EmailVerificationMail,
  type MailService,
  type PasswordResetMail,
} from '../src/notifications/mail.service';

const runDatabaseE2e = shouldRunDatabaseE2e();
const describeDatabase = runDatabaseE2e ? describe : describe.skip;

const DATA_API_PRIVATE_TABLES = [
  '_prisma_migrations',
  'users',
  'password_credentials',
  'auth_identities',
  'oauth_transactions',
  'sessions',
  'mfa_totp_methods',
  'mfa_challenges',
  'mfa_enrollment_grants',
  'mfa_recovery_codes',
  'verification_tokens',
  'security_events',
  'audit_logs',
  'addresses',
  'categories',
  'products',
  'product_images',
  'inventory',
  'inventory_transactions',
  'carts',
  'cart_items',
  'orders',
  'order_items',
  'order_status_history',
] as const;

interface TableSecurityRow {
  tableName: string;
  rlsEnabled: boolean;
}

interface DataApiGrantRow {
  grantee: string;
  tableName: string;
  privilegeType: string;
}

function setE2eConfigDefault(name: string, value: string): void {
  if (runDatabaseE2e && !process.env[name]?.trim()) {
    process.env[name] = value;
  }
}

setE2eConfigDefault('NODE_ENV', 'test');
setE2eConfigDefault('LOG_LEVEL', 'silent');
setE2eConfigDefault('FRONTEND_ORIGIN', 'http://localhost:5173');
setE2eConfigDefault('GOOGLE_CLIENT_ID', 'auth-e2e-google-client');
setE2eConfigDefault('GOOGLE_CLIENT_SECRET', 'auth-e2e-google-secret');
setE2eConfigDefault('GOOGLE_REDIRECT_URI', 'http://localhost:5173/auth/google/callback');
setE2eConfigDefault('OAUTH_TRANSACTION_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
setE2eConfigDefault(
  'JWT_ACCESS_SECRET',
  'auth-e2e-only-jwt-access-secret-with-at-least-32-characters',
);
setE2eConfigDefault('MFA_ENCRYPTION_KEY', Buffer.alloc(32, 2).toString('base64'));
setE2eConfigDefault('MAIL_FROM', 'auth-e2e@example.com');
setE2eConfigDefault('SMTP_HOST', 'localhost');
setE2eConfigDefault('S3_ENDPOINT', 'http://localhost:9000');
setE2eConfigDefault('S3_BUCKET', 'auth-e2e');
setE2eConfigDefault('S3_ACCESS_KEY', 'auth-e2e-access-key');
setE2eConfigDefault('S3_SECRET_KEY', 'auth-e2e-secret-key');

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }

  return value as Record<string, unknown>;
}

function responseData(response: request.Response): Record<string, unknown> {
  return asRecord(asRecord(response.body as unknown, 'response body').data, 'response data');
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }

  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item: unknown): item is string => typeof item === 'string' && item.length > 0)
  ) {
    throw new Error(`Expected ${key} to be a non-empty string array`);
  }

  return value;
}

function expectErrorCode(response: request.Response, expectedCode: string): void {
  const body = asRecord(response.body as unknown, 'error response body');
  const error = asRecord(body.error, 'error response');
  expect(error.code).toBe(expectedCode);
}

function setCookieHeaders(response: request.Response): string[] {
  const value: unknown = response.headers['set-cookie'];
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value) && value.every((header) => typeof header === 'string')) {
    return value;
  }

  return [];
}

function refreshCookie(response: request.Response): string {
  const prefix = `${REFRESH_TOKEN_COOKIE}=`;
  const header = setCookieHeaders(response).find((candidate) => candidate.startsWith(prefix));
  if (!header) {
    throw new Error(`Expected ${REFRESH_TOKEN_COOKIE} Set-Cookie header`);
  }

  const cookie = header.split(';', 1)[0];
  if (!cookie || cookie.length <= prefix.length) {
    throw new Error(`Expected ${REFRESH_TOKEN_COOKIE} cookie value`);
  }

  return cookie;
}

@Controller('auth-e2e')
class AuthE2eController {
  @Get('protected')
  protectedRoute(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

describeDatabase('email/password authentication against PostgreSQL (e2e)', () => {
  jest.setTimeout(120_000);

  const email = `auth-e2e-${randomUUID()}@example.test`;
  const googleEmail = `google-auth-e2e-${randomUUID()}@example.test`;
  const googleSubject = `google-subject-${randomUUID()}`;
  const staffEmail = `staff-auth-e2e-${randomUUID()}@example.test`;
  const fullName = 'Auth E2E Customer';
  const staffFullName = 'Auth E2E Staff';
  const originalPassword = 'Correct-Horse-42';
  const replacementPassword = 'Battery-Staple-84';
  const staffPassword = 'Staff-Correct-Horse-42';
  const verificationMessages: EmailVerificationMail[] = [];
  const passwordResetMessages: PasswordResetMail[] = [];
  const sendEmailVerification = jest.fn((message: EmailVerificationMail): Promise<void> => {
    verificationMessages.push(message);
    return Promise.resolve();
  });
  const sendPasswordReset = jest.fn((message: PasswordResetMail): Promise<void> => {
    passwordResetMessages.push(message);
    return Promise.resolve();
  });
  const mailService: MailService = {
    sendEmailVerification,
    sendPasswordReset,
  };
  let currentGoogleEmail = googleEmail;
  let currentGoogleSubject = googleSubject;
  let latestGoogleNonce = '';
  const googleOidcClient = {
    createPkcePair: jest.fn().mockResolvedValue({
      codeVerifier: 'auth-e2e-pkce-verifier',
      codeChallenge: 'auth-e2e-pkce-challenge',
    }),
    createAuthorizationUrl: jest.fn(
      (input: { state: string; nonce: string; codeChallenge: string }): string => {
        latestGoogleNonce = input.nonce;
        const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authorizationUrl.searchParams.set('state', input.state);
        authorizationUrl.searchParams.set('nonce', input.nonce);
        authorizationUrl.searchParams.set('code_challenge', input.codeChallenge);
        return authorizationUrl.toString();
      },
    ),
    exchangeAuthorizationCode: jest.fn().mockResolvedValue('auth-e2e-id-token'),
    verifyIdToken: jest.fn(() =>
      Promise.resolve({
        issuer: 'https://accounts.google.com',
        audience: 'auth-e2e-google-client',
        subject: currentGoogleSubject,
        email: currentGoogleEmail,
        emailVerified: true,
        name: 'Google Auth E2E Customer',
        nonce: latestGoogleNonce,
        issuedAt: Math.floor(Date.now() / 1_000) - 60,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      }),
    ),
  } as unknown as jest.Mocked<GoogleOidcClient>;

  let app: INestApplication | undefined;
  let database: DatabaseService | undefined;
  let httpServer: Server;
  let userId: string | undefined;
  let googleUserId: string | undefined;
  let staffUserId: string | undefined;
  let trustedOrigin: string;

  beforeAll(async () => {
    // Defer AppModule import until after opt-in test defaults are applied. Its
    // ConfigModule validates the environment while the module is imported.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthE2eController],
    })
      .overrideProvider(MAIL_SERVICE)
      .useValue(mailService)
      .overrideProvider(GoogleOidcClient)
      .useValue(googleOidcClient)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();

    const connectedDatabase = app.get(DatabaseService);
    await connectedDatabase.ping();
    database = connectedDatabase;
    httpServer = app.getHttpServer() as Server;

    const configuredOrigins = app.get(ConfigService).getOrThrow<string>('FRONTEND_ORIGIN');
    const firstOrigin = configuredOrigins
      .split(',')
      .map((origin) => origin.trim())
      .find((origin) => origin.length > 0);
    if (!firstOrigin) {
      throw new Error('Expected at least one configured frontend origin');
    }
    trustedOrigin = firstOrigin;
  });

  afterAll(async () => {
    try {
      if (database) {
        const passwordUserId =
          userId ??
          (
            await database.user.findUnique({
              where: { emailNormalized: email.toLowerCase() },
              select: { id: true },
            })
          )?.id;
        const googleAccountId =
          googleUserId ??
          (
            await database.user.findUnique({
              where: { emailNormalized: googleEmail.toLowerCase() },
              select: { id: true },
            })
          )?.id;
        const staffAccountId =
          staffUserId ??
          (
            await database.user.findUnique({
              where: { emailNormalized: staffEmail.toLowerCase() },
              select: { id: true },
            })
          )?.id;
        const cleanupUserIds = [passwordUserId, googleAccountId, staffAccountId].filter(
          (candidate): candidate is string => typeof candidate === 'string',
        );
        if (cleanupUserIds.length === 0) {
          return;
        }

        await database.$transaction(async (transaction) => {
          await transaction.securityEvent.deleteMany({
            where: { userId: { in: cleanupUserIds } },
          });
          await transaction.user.deleteMany({
            where: {
              id: { in: cleanupUserIds },
            },
          });
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('keeps every backend table private from Supabase Data API roles', async () => {
    if (!database) {
      throw new Error('Expected a connected database');
    }

    const tableSecurity = await database.$queryRaw<TableSecurityRow[]>`
      SELECT
        table_record.relname AS "tableName",
        table_record.relrowsecurity AS "rlsEnabled"
      FROM pg_class AS table_record
      INNER JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = 'public'
        AND table_record.relkind = 'r'
    `;
    const rlsByTable = new Map(
      tableSecurity.map((table) => [table.tableName, table.rlsEnabled] as const),
    );

    for (const tableName of DATA_API_PRIVATE_TABLES) {
      expect(rlsByTable.get(tableName)).toBe(true);
    }

    const dataApiGrants = await database.$queryRaw<DataApiGrantRow[]>`
      SELECT
        COALESCE(role_record.rolname, 'PUBLIC') AS grantee,
        table_record.relname AS "tableName",
        grant_record.privilege_type AS "privilegeType"
      FROM pg_class AS table_record
      INNER JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(table_record.relacl, acldefault('r', table_record.relowner))
      ) AS grant_record
      LEFT JOIN pg_roles AS role_record
        ON role_record.oid = grant_record.grantee
      WHERE schema_record.nspname = 'public'
        AND table_record.relkind = 'r'
        AND (
          grant_record.grantee = 0
          OR role_record.rolname IN ('anon', 'authenticated', 'service_role')
        )
    `;
    const privateTableNames = new Set<string>(DATA_API_PRIVATE_TABLES);
    expect(dataApiGrants.filter((grant) => privateTableNames.has(grant.tableName))).toEqual([]);
  });

  it('enforces verification, token rotation/reuse detection, reset revocation, and logout', async () => {
    const registerResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: originalPassword,
        fullName,
      })
      .expect(201);
    const registerData = responseData(registerResponse);
    userId = requiredString(registerData, 'userId');
    expect(registerData).toMatchObject({
      status: 'PENDING',
      verificationRequired: true,
    });
    expect(sendEmailVerification).toHaveBeenCalledTimes(1);
    expect(verificationMessages).toHaveLength(1);
    expect(verificationMessages[0]).toMatchObject({ to: email, fullName });

    const pendingUser = await database?.user.findUnique({
      where: { id: userId },
      select: { status: true, emailVerifiedAt: true },
    });
    expect(pendingUser).toEqual({
      status: 'PENDING',
      emailVerifiedAt: null,
    });

    const verificationToken = verificationMessages[0]?.token;
    if (!verificationToken) {
      throw new Error('Expected the mocked verification email to contain a token');
    }

    const pendingLoginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email, password: originalPassword })
      .expect(403);
    expectErrorCode(pendingLoginResponse, 'AUTH_EMAIL_NOT_VERIFIED');

    const concurrentVerificationResponses = await Promise.all([
      request(httpServer).post('/api/v1/auth/verify-email').send({ token: verificationToken }),
      request(httpServer).post('/api/v1/auth/verify-email').send({ token: verificationToken }),
    ]);
    const successfulVerification = concurrentVerificationResponses.find(
      (response) => response.status === 200,
    );
    const rejectedVerification = concurrentVerificationResponses.find(
      (response) => response.status === 400,
    );
    expect(successfulVerification).toBeDefined();
    expect(rejectedVerification).toBeDefined();
    if (!successfulVerification || !rejectedVerification) {
      throw new Error('Expected exactly one concurrent email verification to succeed');
    }
    expect(responseData(successfulVerification)).toEqual({ verified: true });
    expectErrorCode(rejectedVerification, 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID');

    const missingOriginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(403);
    expectErrorCode(missingOriginResponse, 'AUTH_ORIGIN_FORBIDDEN');

    const untrustedOriginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example.test')
      .send({ email, password: originalPassword })
      .expect(403);
    expectErrorCode(untrustedOriginResponse, 'AUTH_ORIGIN_FORBIDDEN');

    const loginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email, password: originalPassword })
      .expect(200);
    const loginData = responseData(loginResponse);
    const initialAccessToken = requiredString(loginData, 'accessToken');
    const initialRefreshCookie = refreshCookie(loginResponse);
    const initialSetCookie = setCookieHeaders(loginResponse).join('; ');
    expect(loginResponse.headers['cache-control']).toBe('no-store');
    expect(initialSetCookie).toContain('HttpOnly');
    expect(initialSetCookie).toContain('SameSite=Lax');
    expect(initialSetCookie).toContain('Path=/api/v1/auth');
    expect(asRecord(loginData.user, 'authenticated user')).toMatchObject({
      id: userId,
      email,
      fullName,
      role: 'CUSTOMER',
    });

    const initialClaims = await app?.get(AccessTokenService).verify(initialAccessToken);
    if (!initialClaims) {
      throw new Error('Expected initial access-token claims');
    }

    const protectedResponse = await request(httpServer)
      .get('/api/v1/auth-e2e/protected')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(200);
    expect(responseData(protectedResponse)).toMatchObject({
      id: userId,
      email,
      fullName,
      role: 'CUSTOMER',
      sessionId: initialClaims.sid,
    });

    const refreshResponse = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', initialRefreshCookie)
      .expect(200);
    const refreshData = responseData(refreshResponse);
    const rotatedAccessToken = requiredString(refreshData, 'accessToken');
    const rotatedRefreshCookie = refreshCookie(refreshResponse);
    expect(rotatedRefreshCookie).not.toBe(initialRefreshCookie);

    const rotatedClaims = await app?.get(AccessTokenService).verify(rotatedAccessToken);
    if (!rotatedClaims) {
      throw new Error('Expected rotated access-token claims');
    }
    expect(rotatedClaims.sid).not.toBe(initialClaims.sid);

    const reuseResponse = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', initialRefreshCookie)
      .expect(401);
    expectErrorCode(reuseResponse, 'AUTH_REFRESH_TOKEN_REUSED');

    const revokedReplacement = await database?.session.findUnique({
      where: { id: rotatedClaims.sid },
      select: { revokedAt: true },
    });
    expect(revokedReplacement?.revokedAt).toBeInstanceOf(Date);

    const rejectedRotatedAccess = await request(httpServer)
      .get('/api/v1/auth-e2e/protected')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(401);
    expectErrorCode(rejectedRotatedAccess, 'AUTH_SESSION_INVALID');

    const preResetLoginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email, password: originalPassword })
      .expect(200);
    const preResetData = responseData(preResetLoginResponse);
    const preResetAccessToken = requiredString(preResetData, 'accessToken');
    const preResetClaims = await app?.get(AccessTokenService).verify(preResetAccessToken);
    if (!preResetClaims) {
      throw new Error('Expected pre-reset access-token claims');
    }

    const forgotResponse = await request(httpServer)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(202);
    expect(responseData(forgotResponse)).toEqual({ accepted: true });
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(passwordResetMessages).toHaveLength(1);
    expect(passwordResetMessages[0]).toMatchObject({ to: email, fullName });

    const passwordResetToken = passwordResetMessages[0]?.token;
    if (!passwordResetToken) {
      throw new Error('Expected the mocked password-reset email to contain a token');
    }

    const resetResponse = await request(httpServer)
      .post('/api/v1/auth/reset-password')
      .send({
        token: passwordResetToken,
        newPassword: replacementPassword,
      })
      .expect(200);
    expect(responseData(resetResponse)).toEqual({ reset: true });

    const resetRevokedSession = await database?.session.findUnique({
      where: { id: preResetClaims.sid },
      select: { revokedAt: true },
    });
    expect(resetRevokedSession?.revokedAt).toBeInstanceOf(Date);

    const rejectedPreResetAccess = await request(httpServer)
      .get('/api/v1/auth-e2e/protected')
      .set('Authorization', `Bearer ${preResetAccessToken}`)
      .expect(401);
    expectErrorCode(rejectedPreResetAccess, 'AUTH_SESSION_INVALID');

    const oldPasswordResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email, password: originalPassword })
      .expect(401);
    expectErrorCode(oldPasswordResponse, 'AUTH_INVALID_CREDENTIALS');

    const replacementLoginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email, password: replacementPassword })
      .expect(200);
    const replacementLoginData = responseData(replacementLoginResponse);
    const replacementAccessToken = requiredString(replacementLoginData, 'accessToken');
    const replacementRefreshCookie = refreshCookie(replacementLoginResponse);
    const replacementClaims = await app?.get(AccessTokenService).verify(replacementAccessToken);
    if (!replacementClaims) {
      throw new Error('Expected replacement access-token claims');
    }

    const logoutResponse = await request(httpServer)
      .post('/api/v1/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Cookie', replacementRefreshCookie)
      .expect(200);
    expect(responseData(logoutResponse)).toEqual({ loggedOut: true });
    expect(setCookieHeaders(logoutResponse).join('; ')).toContain(`${REFRESH_TOKEN_COOKIE}=`);

    const loggedOutSession = await database?.session.findUnique({
      where: { id: replacementClaims.sid },
      select: { revokedAt: true },
    });
    expect(loggedOutSession?.revokedAt).toBeInstanceOf(Date);

    const rejectedLoggedOutAccess = await request(httpServer)
      .get('/api/v1/auth-e2e/protected')
      .set('Authorization', `Bearer ${replacementAccessToken}`)
      .expect(401);
    expectErrorCode(rejectedLoggedOutAccess, 'AUTH_SESSION_INVALID');
  });

  it('enrolls Staff TOTP and enforces authenticator and recovery-code replay protection', async () => {
    if (!app || !database) {
      throw new Error('Expected an initialized application and database');
    }

    // The preceding password scenario intentionally fills the per-IP login bucket.
    // This scenario validates MFA rather than rate limiting, so give it an isolated bucket state.
    const rateLimiter = app.get<{
      attempts: Map<string, unknown>;
    }>(AuthRateLimiterService);
    rateLimiter.attempts.clear();

    const verificationMessageOffset = verificationMessages.length;
    const registerResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: staffEmail,
        password: staffPassword,
        fullName: staffFullName,
      })
      .expect(201);
    staffUserId = requiredString(responseData(registerResponse), 'userId');

    const verificationMessage = verificationMessages[verificationMessageOffset];
    if (!verificationMessage || verificationMessage.to !== staffEmail) {
      throw new Error('Expected a verification message for the Staff test user');
    }
    await request(httpServer)
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationMessage.token })
      .expect(200);

    await database.user.update({
      where: { id: staffUserId },
      data: { role: UserRole.STAFF },
    });

    const enrollmentLoginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ email: staffEmail, password: staffPassword })
      .expect(200);
    const enrollmentLoginData = responseData(enrollmentLoginResponse);
    const enrollmentToken = requiredString(enrollmentLoginData, 'enrollmentToken');
    expect(enrollmentLoginData).toMatchObject({
      mfaEnrollmentRequired: true,
      expiresIn: 600,
    });
    expect(enrollmentLoginData).not.toHaveProperty('accessToken');
    expect(
      setCookieHeaders(enrollmentLoginResponse).some((header) =>
        header.startsWith(`${REFRESH_TOKEN_COOKIE}=`),
      ),
    ).toBe(false);

    const missingOriginResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send({})
      .expect(403);
    expectErrorCode(missingOriginResponse, 'AUTH_ORIGIN_FORBIDDEN');

    const setupResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/setup')
      .set('Origin', trustedOrigin)
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send({})
      .expect(200);
    const setupData = responseData(setupResponse);
    const manualKey = requiredString(setupData, 'manualKey');
    const otpauthUri = requiredString(setupData, 'otpauthUri');
    const qrCodeDataUrl = requiredString(setupData, 'qrCodeDataUrl');
    expect(manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(new URL(otpauthUri).searchParams.get('secret')).toBe(manualKey);
    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setupData.expiresIn).toEqual(expect.any(Number));
    expect(setupResponse.headers['cache-control']).toBe('no-store');

    const totp = app.get(TotpService);
    const enrollmentCode = totp.generateCode(manualKey);
    const enableResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/enable')
      .set('Origin', trustedOrigin)
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send({ code: enrollmentCode })
      .expect(200);
    const enableData = responseData(enableResponse);
    const recoveryCodes = requiredStringArray(enableData, 'recoveryCodes');
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(
      recoveryCodes.every((code) => /^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){4}$/.test(code)),
    ).toBe(true);
    expect(requiredString(enableData, 'accessToken')).toBeTruthy();
    expect(refreshCookie(enableResponse)).toContain(`${REFRESH_TOKEN_COOKIE}=`);
    expect(asRecord(enableData.user, 'MFA enrollment user')).toMatchObject({
      id: staffUserId,
      email: staffEmail,
      role: UserRole.STAFF,
    });

    const enabledMethod = await database.mfaTotpMethod.findUnique({
      where: { userId: staffUserId },
      select: {
        status: true,
        setupExpiresAt: true,
        enabledAt: true,
        lastUsedTimeStep: true,
      },
    });
    expect(enabledMethod).toMatchObject({
      status: MfaTotpStatus.ENABLED,
      setupExpiresAt: null,
    });
    expect(enabledMethod?.enabledAt).toBeInstanceOf(Date);
    expect(typeof enabledMethod?.lastUsedTimeStep).toBe('bigint');
    expect(
      await database.mfaRecoveryCode.count({
        where: { userId: staffUserId },
      }),
    ).toBe(10);

    if (enabledMethod?.lastUsedTimeStep === null || enabledMethod?.lastUsedTimeStep === undefined) {
      throw new Error('Expected the enrollment TOTP time step to be recorded');
    }
    const nextTimeStep = enabledMethod.lastUsedTimeStep + 1n;
    const nextTimeStepDate = new Date(Number(nextTimeStep) * 30_000 + 1_000);
    const nextTimeStepCode = totp.generateCode(manualKey, nextTimeStepDate);

    const startMfaChallenge = async (): Promise<string> => {
      const loginResponse = await request(httpServer)
        .post('/api/v1/auth/login')
        .set('Origin', trustedOrigin)
        .send({ email: staffEmail, password: staffPassword })
        .expect(200);
      const loginData = responseData(loginResponse);
      expect(loginData).toMatchObject({
        mfaRequired: true,
        expiresIn: 300,
      });
      expect(loginData).not.toHaveProperty('accessToken');
      expect(
        setCookieHeaders(loginResponse).some((header) =>
          header.startsWith(`${REFRESH_TOKEN_COOKIE}=`),
        ),
      ).toBe(false);
      return requiredString(loginData, 'mfaToken');
    };

    const totpChallengeToken = await startMfaChallenge();
    const totpVerifyResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/verify')
      .set('Origin', trustedOrigin)
      .send({
        mfaToken: totpChallengeToken,
        code: nextTimeStepCode,
      })
      .expect(200);
    expect(requiredString(responseData(totpVerifyResponse), 'accessToken')).toBeTruthy();
    expect(refreshCookie(totpVerifyResponse)).toContain(`${REFRESH_TOKEN_COOKIE}=`);
    expect(
      await database.mfaTotpMethod.findUnique({
        where: { userId: staffUserId },
        select: { lastUsedTimeStep: true },
      }),
    ).toEqual({ lastUsedTimeStep: nextTimeStep });

    const replayChallengeToken = await startMfaChallenge();
    const replayedTimeStepResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/verify')
      .set('Origin', trustedOrigin)
      .send({
        mfaToken: replayChallengeToken,
        code: nextTimeStepCode,
      })
      .expect(401);
    expectErrorCode(replayedTimeStepResponse, 'MFA_CODE_INVALID');

    const recoveryCode = recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error('Expected at least one recovery code');
    }
    const recoveryVerifyResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/verify')
      .set('Origin', trustedOrigin)
      .send({
        mfaToken: replayChallengeToken,
        recoveryCode,
      })
      .expect(200);
    expect(requiredString(responseData(recoveryVerifyResponse), 'accessToken')).toBeTruthy();
    expect(refreshCookie(recoveryVerifyResponse)).toContain(`${REFRESH_TOKEN_COOKIE}=`);
    expect(
      await database.mfaRecoveryCode.count({
        where: { userId: staffUserId, usedAt: { not: null } },
      }),
    ).toBe(1);

    const recoveryReplayChallengeToken = await startMfaChallenge();
    const replayedRecoveryResponse = await request(httpServer)
      .post('/api/v1/auth/mfa/verify')
      .set('Origin', trustedOrigin)
      .send({
        mfaToken: recoveryReplayChallengeToken,
        recoveryCode,
      })
      .expect(401);
    expectErrorCode(replayedRecoveryResponse, 'MFA_CODE_INVALID');
    expect(
      await database.mfaRecoveryCode.count({
        where: { userId: staffUserId, usedAt: { not: null } },
      }),
    ).toBe(1);

    const recoveryEvents = await database.securityEvent.findMany({
      where: {
        userId: staffUserId,
        type: SecurityEventType.MFA_RECOVERY_CODE_USED,
      },
      select: { metadata: true },
    });
    expect(recoveryEvents).toHaveLength(1);
    const recoveryEventMetadata = JSON.stringify(recoveryEvents[0]?.metadata);
    expect(recoveryEventMetadata).not.toContain(recoveryCode);
    expect(recoveryEventMetadata).not.toContain(recoveryCode.replaceAll('-', ''));
  });

  it('lets an Administrator manage user status, role, and another account MFA atomically', async () => {
    if (!app || !database || !staffUserId || !userId) {
      throw new Error('Expected initialized Staff/Admin and Customer test users');
    }

    await database.user.update({
      where: { id: staffUserId },
      data: { role: UserRole.ADMIN },
    });
    const adminSession = await database.session.findFirst({
      where: { userId: staffUserId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!adminSession) {
      throw new Error('Expected a live Staff session to exercise administration endpoints');
    }
    const adminAccessToken = await app.get(AccessTokenService).sign({
      userId: staffUserId,
      sessionId: adminSession.id,
      role: UserRole.ADMIN,
    });

    const listResponse = await request(httpServer)
      .get('/api/v1/admin/users?page=1&limit=5&search=auth-e2e')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);
    const listBody = asRecord(listResponse.body as unknown, 'list response');
    expect(Array.isArray(listBody.data)).toBe(true);
    expect(listBody.pagination).toMatchObject({
      page: 1,
      limit: 5,
    });

    const blockResponse = await request(httpServer)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: UserStatus.BLOCKED })
      .expect(200);
    expect(responseData(blockResponse)).toMatchObject({ id: userId, status: UserStatus.BLOCKED });
    expect(await database.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(
      await database.auditLog.count({
        where: { actorId: staffUserId, entityId: userId, action: AuditAction.USER_BLOCKED },
      }),
    ).toBe(1);

    const unblockResponse = await request(httpServer)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: UserStatus.ACTIVE })
      .expect(200);
    expect(responseData(unblockResponse)).toMatchObject({ id: userId, status: UserStatus.ACTIVE });

    const roleResponse = await request(httpServer)
      .patch(`/api/v1/admin/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: UserRole.STAFF })
      .expect(200);
    expect(responseData(roleResponse)).toMatchObject({ id: userId, role: UserRole.STAFF });

    await database.mfaTotpMethod.create({
      data: {
        userId,
        secretEncrypted: 'test-only-encrypted-secret',
        status: MfaTotpStatus.ENABLED,
        enabledAt: new Date(),
      },
    });
    await database.mfaRecoveryCode.create({ data: { userId, codeHash: `test-${randomUUID()}` } });
    await database.mfaEnrollmentGrant.create({
      data: {
        userId,
        tokenHash: `test-${randomUUID()}`,
        primaryMethod: PrimaryAuthMethod.PASSWORD,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await database.mfaChallenge.create({
      data: {
        userId,
        tokenHash: `test-${randomUUID()}`,
        primaryMethod: PrimaryAuthMethod.PASSWORD,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await database.session.create({
      data: {
        userId,
        refreshTokenHash: `test-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const resetResponse = await request(httpServer)
      .post(`/api/v1/admin/users/${userId}/mfa/reset`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({})
      .expect(200);
    expect(responseData(resetResponse)).toMatchObject({ id: userId, mfaStatus: 'NONE' });
    expect(await database.mfaTotpMethod.findUnique({ where: { userId } })).toBeNull();
    expect(await database.mfaRecoveryCode.count({ where: { userId } })).toBe(0);
    expect(await database.mfaChallenge.count({ where: { userId, consumedAt: null } })).toBe(0);
    expect(
      await database.mfaEnrollmentGrant.count({
        where: { userId, consumedAt: null, revokedAt: null },
      }),
    ).toBe(0);
    expect(await database.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(
      await database.securityEvent.count({
        where: { userId, type: SecurityEventType.MFA_RESET_BY_ADMIN },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: { actorId: staffUserId, entityId: userId, action: AuditAction.USER_MFA_RESET },
      }),
    ).toBe(1);

    const selfResetResponse = await request(httpServer)
      .post(`/api/v1/admin/users/${staffUserId}/mfa/reset`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({})
      .expect(403);
    expectErrorCode(selfResetResponse, 'MFA_RESET_SELF_FORBIDDEN');

    const demoteLastAdmin = await request(httpServer)
      .patch(`/api/v1/admin/users/${staffUserId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: UserRole.STAFF })
      .expect(409);
    expectErrorCode(demoteLastAdmin, 'LAST_ACTIVE_ADMIN_REQUIRED');
  });

  it('creates a Google-only user, binds state to the browser, and rejects replay', async () => {
    currentGoogleEmail = googleEmail;
    currentGoogleSubject = googleSubject;
    const missingOriginResponse = await request(httpServer)
      .get('/api/v1/auth/google/url')
      .expect(403);
    expectErrorCode(missingOriginResponse, 'AUTH_ORIGIN_FORBIDDEN');

    const browser = request.agent(httpServer);
    const authorizationResponse = await browser
      .get('/api/v1/auth/google/url')
      .set('Origin', trustedOrigin)
      .expect(200);
    const authorizationData = responseData(authorizationResponse);
    const authorizationUrl = new URL(requiredString(authorizationData, 'authorizationUrl'));
    const state = authorizationUrl.searchParams.get('state');
    if (!state) {
      throw new Error('Expected the Google authorization URL to contain state');
    }
    expect(authorizationResponse.headers['cache-control']).toBe('no-store');
    expect(setCookieHeaders(authorizationResponse).join('; ')).toContain(
      `${GOOGLE_OAUTH_STATE_COOKIE}=`,
    );

    const exchangeCallsBefore = googleOidcClient.exchangeAuthorizationCode.mock.calls.length;
    const callbackResponse = await browser
      .post('/api/v1/auth/google/callback')
      .set('Origin', trustedOrigin)
      .send({ code: 'auth-e2e-google-code', state })
      .expect(200);
    const callbackData = responseData(callbackResponse);
    googleUserId = requiredString(asRecord(callbackData.user, 'Google authenticated user'), 'id');
    expect(requiredString(callbackData, 'accessToken')).toBeTruthy();
    expect(refreshCookie(callbackResponse)).toContain(`${REFRESH_TOKEN_COOKIE}=`);
    expect(googleOidcClient.exchangeAuthorizationCode.mock.calls).toHaveLength(
      exchangeCallsBefore + 1,
    );

    const googleUser = await database?.user.findUnique({
      where: { id: googleUserId },
      select: {
        status: true,
        emailVerifiedAt: true,
        passwordCredential: { select: { id: true } },
        authIdentities: {
          select: {
            provider: true,
            providerAccountId: true,
          },
        },
      },
    });
    expect(googleUser).toMatchObject({
      status: 'ACTIVE',
      passwordCredential: null,
      authIdentities: [
        {
          provider: 'GOOGLE',
          providerAccountId: googleSubject,
        },
      ],
    });
    expect(googleUser?.emailVerifiedAt).toBeInstanceOf(Date);

    const replayResponse = await request(httpServer)
      .post('/api/v1/auth/google/callback')
      .set('Origin', trustedOrigin)
      .set('Cookie', `${GOOGLE_OAUTH_STATE_COOKIE}=${state}`)
      .send({ code: 'auth-e2e-google-code', state })
      .expect(409);
    expectErrorCode(replayResponse, 'OAUTH_TRANSACTION_ALREADY_USED');
    expect(googleOidcClient.exchangeAuthorizationCode.mock.calls).toHaveLength(
      exchangeCallsBefore + 1,
    );
  });

  it('does not auto-link a different Google subject to an existing password email', async () => {
    currentGoogleEmail = email;
    currentGoogleSubject = `different-google-subject-${randomUUID()}`;
    const browser = request.agent(httpServer);
    const authorizationResponse = await browser
      .get('/api/v1/auth/google/url')
      .set('Origin', trustedOrigin)
      .expect(200);
    const authorizationUrl = new URL(
      requiredString(responseData(authorizationResponse), 'authorizationUrl'),
    );
    const state = authorizationUrl.searchParams.get('state');
    if (!state) {
      throw new Error('Expected the Google authorization URL to contain state');
    }

    const callbackResponse = await browser
      .post('/api/v1/auth/google/callback')
      .set('Origin', trustedOrigin)
      .send({ code: 'auth-e2e-account-link-code', state })
      .expect(409);
    expectErrorCode(callbackResponse, 'OAUTH_ACCOUNT_LINK_REQUIRED');

    const unexpectedIdentity = await database?.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: currentGoogleSubject,
        },
      },
      select: { id: true },
    });
    expect(unexpectedIdentity).toBeNull();
  });
});
