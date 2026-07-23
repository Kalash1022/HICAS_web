import { HttpStatus } from '@nestjs/common';

import { ApplicationException } from '../../common/exceptions/application.exception';
import { extractMfaEnrollmentBearerToken } from './bearer-token';

const TOKEN = 'A'.repeat(43);

describe(extractMfaEnrollmentBearerToken.name, () => {
  it.each(['Bearer', 'bearer', 'BEARER'])('extracts one valid token with %s scheme', (scheme) => {
    expect(extractMfaEnrollmentBearerToken(`${scheme} ${TOKEN}`)).toBe(TOKEN);
  });

  it.each([
    undefined,
    '',
    `Basic ${TOKEN}`,
    'Bearer',
    'Bearer ',
    ` Bearer ${TOKEN}`,
    `Bearer  ${TOKEN}`,
    `Bearer ${TOKEN} `,
    `Bearer ${TOKEN},Bearer ${TOKEN}`,
    `Bearer ${TOKEN} second-token`,
    `Bearer ${'A'.repeat(42)}`,
    `Bearer ${'A'.repeat(257)}`,
    `Bearer ${'A'.repeat(42)}+`,
  ])('rejects a missing or malformed header (%p)', (authorizationHeader) => {
    expect.assertions(3);

    try {
      extractMfaEnrollmentBearerToken(authorizationHeader);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationException);
      const exception = error as ApplicationException;
      expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(exception.getResponse()).toMatchObject({
        code: 'MFA_ENROLLMENT_TOKEN_INVALID',
      });
    }
  });
});
