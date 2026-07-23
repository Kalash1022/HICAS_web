import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus, type UserRole } from '@prisma/client';

import { AccessTokenService } from '../../auth/services/access-token.service';
import { DatabaseService } from '../../database/database.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ApplicationException } from '../exceptions/application.exception';
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokenService: AccessTokenService,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    const claims = await this.accessTokenService.verify(token);
    const session = await this.databaseService.session.findUnique({
      where: { id: claims.sid },
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
          },
        },
      },
    });

    if (session === null || session.userId !== claims.sub) {
      throw this.invalidSession();
    }

    if (session.user.status === UserStatus.BLOCKED) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_ACCOUNT_BLOCKED',
        'This account is blocked',
      );
    }

    if (session.user.status === UserStatus.PENDING || session.user.emailVerifiedAt === null) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_EMAIL_NOT_VERIFIED',
        'Email verification is required',
      );
    }

    if (
      session.user.status !== UserStatus.ACTIVE ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw this.invalidSession();
    }

    const authenticatedUser: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      role: session.user.role,
      sessionId: session.id,
    };

    request.user = authenticatedUser;
    this.assertRequiredRole(context, authenticatedUser.role);

    return true;
  }

  private extractBearerToken(request: AuthenticatedRequest): string {
    const authorization = request.headers.authorization;

    if (typeof authorization !== 'string') {
      throw this.invalidAccessToken();
    }

    const parts = authorization.trim().split(/\s+/);

    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
      throw this.invalidAccessToken();
    }

    return parts[1];
  }

  private assertRequiredRole(context: ExecutionContext, currentRole: UserRole): void {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles !== undefined && !requiredRoles.includes(currentRole)) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to access this resource',
      );
    }
  }

  private invalidAccessToken(): ApplicationException {
    return new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'AUTH_ACCESS_TOKEN_INVALID',
      'A valid Bearer access token is required',
    );
  }

  private invalidSession(): ApplicationException {
    return new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'AUTH_SESSION_INVALID',
      'The authenticated session is no longer valid',
    );
  }
}
