import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { parseAllowedOrigins } from '../../config/origins';

@Injectable()
export class CookieOriginService {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      parseAllowedOrigins(config.getOrThrow<string>('FRONTEND_ORIGIN')),
    );
  }

  assertTrusted(request: Request): void {
    const originHeader = request.get('origin');
    if (originHeader) {
      this.assertAllowed(originHeader);
      return;
    }

    const referer = request.get('referer');
    if (referer) {
      try {
        this.assertAllowed(new URL(referer).origin);
        return;
      } catch (error) {
        if (error instanceof ApplicationException) {
          throw error;
        }
      }
    }

    this.reject();
  }

  private assertAllowed(origin: string): void {
    if (!this.allowedOrigins.has(origin)) {
      this.reject();
    }
  }

  private reject(): never {
    throw new ApplicationException(
      HttpStatus.FORBIDDEN,
      'AUTH_ORIGIN_FORBIDDEN',
      'The request origin is not allowed.',
    );
  }
}
