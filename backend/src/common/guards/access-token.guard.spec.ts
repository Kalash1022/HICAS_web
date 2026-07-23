import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfaTotpStatus, UserRole, UserStatus } from '@prisma/client';

import { AccessTokenService } from '../../auth/services/access-token.service';
import type { DatabaseService } from '../../database/database.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-user';
import { AccessTokenGuard } from './access-token.guard';

interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    status: UserStatus;
    emailVerifiedAt: Date | null;
    mfaTotpMethod: {
      status: MfaTotpStatus;
    } | null;
  };
}

describe('AccessTokenGuard', () => {
  const verify = jest.fn<
    ReturnType<AccessTokenService['verify']>,
    Parameters<AccessTokenService['verify']>
  >();
  const findUnique = jest.fn<Promise<SessionRecord | null>, [unknown]>();
  let isPublic: boolean | undefined;
  let requiredRoles: UserRole[] | undefined;

  const getAllAndOverride = jest.fn((metadataKey: string): unknown => {
    if (metadataKey === IS_PUBLIC_KEY) {
      return isPublic;
    }

    if (metadataKey === ROLES_KEY) {
      return requiredRoles;
    }

    return undefined;
  });

  const reflector = { getAllAndOverride } as unknown as Reflector;
  const accessTokenService = { verify } as unknown as AccessTokenService;
  const databaseService = {
    session: { findUnique },
  } as unknown as DatabaseService;
  const guard = new AccessTokenGuard(reflector, accessTokenService, databaseService);

  const validClaims = {
    sub: 'user-1',
    sid: 'session-1',
    role: UserRole.CUSTOMER,
    type: 'access' as const,
    iat: 1_700_000_000,
    exp: 1_700_000_900,
  };

  beforeEach(() => {
    isPublic = undefined;
    requiredRoles = undefined;
    getAllAndOverride.mockClear();
    verify.mockReset();
    findUnique.mockReset();
    verify.mockResolvedValue(validClaims);
    findUnique.mockResolvedValue(createSession());
  });

  it('allows public handlers without reading a token or the database', async () => {
    isPublic = true;
    const { context } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer token extra'])(
    'rejects a missing or malformed Authorization header (%s)',
    async (authorization) => {
      const { context } = createContext(authorization);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
        response: { code: 'AUTH_ACCESS_TOKEN_INVALID' },
      });
      expect(verify).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('verifies the access token and attaches current database identity and role', async () => {
    const { context, request } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(verify).toHaveBeenCalledWith('signed-token');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            mfaTotpMethod: {
              select: { status: true },
            },
          },
        },
      },
    });
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      fullName: 'Admin User',
      role: UserRole.ADMIN,
      sessionId: 'session-1',
    });
  });

  it.each([
    [UserStatus.BLOCKED, 'AUTH_ACCOUNT_BLOCKED'],
    [UserStatus.PENDING, 'AUTH_EMAIL_NOT_VERIFIED'],
  ])('rejects a %s user with %s', async (status, code) => {
    findUnique.mockResolvedValue(createSession({}, { status }));
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code },
    });
  });

  it('rejects an anomalous ACTIVE user whose email is not verified', async () => {
    findUnique.mockResolvedValue(createSession({}, { emailVerifiedAt: null }));
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'AUTH_EMAIL_NOT_VERIFIED' },
    });
  });

  it.each([UserRole.STAFF, UserRole.ADMIN])(
    'rejects a %s session when TOTP enrollment is missing',
    async (role) => {
      findUnique.mockResolvedValue(createSession({}, { role, mfaTotpMethod: null }));
      const { context } = createContext('Bearer signed-token');

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'MFA_ENROLLMENT_REQUIRED' },
      });
    },
  );

  it('rejects a privileged session while TOTP enrollment is still pending', async () => {
    findUnique.mockResolvedValue(
      createSession({}, { mfaTotpMethod: { status: MfaTotpStatus.PENDING } }),
    );
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'MFA_ENROLLMENT_REQUIRED' },
    });
  });

  it('does not require MFA enrollment for a customer session', async () => {
    findUnique.mockResolvedValue(
      createSession({}, { role: UserRole.CUSTOMER, mfaTotpMethod: null }),
    );
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['missing', null],
    ['wrong subject', createSession({ userId: 'different-user' })],
    ['revoked', createSession({ revokedAt: new Date() })],
    ['expired', createSession({ expiresAt: new Date(Date.now() - 1) })],
  ])('rejects a %s session', async (_scenario, session) => {
    findUnique.mockResolvedValue(session);
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'AUTH_SESSION_INVALID' },
    });
  });

  it('authorizes required roles using the current database role', async () => {
    requiredRoles = [UserRole.ADMIN];
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('does not trust a privileged role claim when the current database role lacks access', async () => {
    requiredRoles = [UserRole.ADMIN];
    verify.mockResolvedValue({ ...validClaims, role: UserRole.ADMIN });
    findUnique.mockResolvedValue(createSession({}, { role: UserRole.CUSTOMER }));
    const { context } = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'AUTH_FORBIDDEN' },
    });
  });
});

function createSession(
  sessionOverrides: Partial<Omit<SessionRecord, 'user'>> = {},
  userOverrides: Partial<SessionRecord['user']> = {},
): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ...sessionOverrides,
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      fullName: 'Admin User',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      mfaTotpMethod: { status: MfaTotpStatus.ENABLED },
      ...userOverrides,
    },
  };
}

function createContext(authorization?: string): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as AuthenticatedRequest;
  const handler = (): void => undefined;
  class TestController {}

  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}
