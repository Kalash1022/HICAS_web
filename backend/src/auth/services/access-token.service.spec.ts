import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

import { AccessTokenService } from './access-token.service';

describe(AccessTokenService.name, () => {
  let jwt: jest.Mocked<JwtService>;
  let service: AccessTokenService;

  beforeEach(() => {
    jwt = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    service = new AccessTokenService(
      jwt,
      new ConfigService({
        JWT_ACCESS_TTL: '15m',
      }),
    );
  });

  it('pins HS256 when signing access tokens', async () => {
    jwt.signAsync.mockResolvedValue('signed-token');

    await service.sign({
      userId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      role: UserRole.CUSTOMER,
    });

    expect(jwt.signAsync.mock.calls[0]?.[1]).toMatchObject({
      algorithm: 'HS256',
      audience: 'hicas-api',
      issuer: 'hicas-commerce',
      expiresIn: 900,
    });
  });

  it('accepts only HS256 when verifying access tokens', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: '11111111-1111-4111-8111-111111111111',
      sid: '22222222-2222-4222-8222-222222222222',
      role: UserRole.CUSTOMER,
      type: 'access',
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });

    await service.verify('signed-token');

    expect(jwt.verifyAsync.mock.calls).toEqual([
      [
        'signed-token',
        {
          algorithms: ['HS256'],
          audience: 'hicas-api',
          issuer: 'hicas-commerce',
        },
      ],
    ]);
  });
});
