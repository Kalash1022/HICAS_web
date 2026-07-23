import { HttpStatus } from '@nestjs/common';

import { ApplicationException } from '../../common/exceptions/application.exception';

const ENROLLMENT_TOKEN_PATTERN = /^Bearer ([A-Za-z0-9_-]{43,256})$/i;

export function extractMfaEnrollmentBearerToken(authorizationHeader: string | undefined): string {
  const match =
    authorizationHeader === undefined ? null : ENROLLMENT_TOKEN_PATTERN.exec(authorizationHeader);
  const token = match?.[1];

  if (token === undefined) {
    throw new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      'MFA_ENROLLMENT_TOKEN_INVALID',
      'The MFA enrollment token is invalid or missing.',
    );
  }

  return token;
}
