import {
  Controller,
  Get,
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { REFRESH_TOKEN_COOKIE } from '../src/auth/auth.constants';
import { AccessTokenService } from '../src/auth/services/access-token.service';
import { CurrentUser } from '../src/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';
import { DatabaseService } from '../src/database/database.service';
import {
  MAIL_SERVICE,
  type EmailVerificationMail,
  type MailService,
  type PasswordResetMail,
} from '../src/notifications/mail.service';

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === '1';
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
  const fullName = 'Auth E2E Customer';
  const originalPassword = 'Correct-Horse-42';
  const replacementPassword = 'Battery-Staple-84';
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

  let app: INestApplication | undefined;
  let database: DatabaseService | undefined;
  let httpServer: Server;
  let userId: string | undefined;
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
        const cleanupUserId =
          userId ??
          (
            await database.user.findUnique({
              where: { emailNormalized: email.toLowerCase() },
              select: { id: true },
            })
          )?.id;

        if (!cleanupUserId) {
          return;
        }

        await database.$transaction(async (transaction) => {
          await transaction.securityEvent.deleteMany({
            where: { userId: cleanupUserId },
          });
          await transaction.user.deleteMany({
            where: {
              id: cleanupUserId,
              emailNormalized: email.toLowerCase(),
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
});
