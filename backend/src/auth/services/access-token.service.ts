import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

import { ApplicationException } from '../../common/exceptions/application.exception';
import type { AccessTokenClaims } from '../auth.types';
import { parseDurationSeconds } from '../utilities/auth-crypto';

const TOKEN_ISSUER = 'hicas-commerce';
const TOKEN_AUDIENCE = 'hicas-api';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && Object.values(UserRole).includes(value as UserRole);
}

@Injectable()
export class AccessTokenService {
  readonly expiresInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.expiresInSeconds = parseDurationSeconds(config.getOrThrow<string>('JWT_ACCESS_TTL'));
  }

  async sign(input: { userId: string; sessionId: string; role: UserRole }): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: input.userId,
        sid: input.sessionId,
        role: input.role,
        type: 'access',
      },
      {
        algorithm: 'HS256',
        audience: TOKEN_AUDIENCE,
        issuer: TOKEN_ISSUER,
        expiresIn: this.expiresInSeconds,
      },
    );
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const payload: unknown = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        audience: TOKEN_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });

      if (
        !isRecord(payload) ||
        typeof payload.sub !== 'string' ||
        !UUID_PATTERN.test(payload.sub) ||
        typeof payload.sid !== 'string' ||
        !UUID_PATTERN.test(payload.sid) ||
        !isUserRole(payload.role) ||
        payload.type !== 'access' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid access token claims');
      }

      return {
        sub: payload.sub,
        sid: payload.sid,
        role: payload.role,
        type: 'access',
        iat: payload.iat,
        exp: payload.exp,
      };
    } catch {
      throw new ApplicationException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_ACCESS_TOKEN_INVALID',
        'The access token is invalid or expired.',
      );
    }
  }
}
