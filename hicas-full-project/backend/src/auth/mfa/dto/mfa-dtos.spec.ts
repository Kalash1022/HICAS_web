import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { EnableMfaDto } from './enable-mfa.dto';
import { MfaSetupDto } from './mfa-setup.dto';
import { VerifyMfaDto } from './verify-mfa.dto';

const MFA_TOKEN = 'M'.repeat(43);

describe('MFA request DTOs', () => {
  it('accepts and trims an exact six-digit enable code', async () => {
    const dto = plainToInstance(EnableMfaDto, { code: ' 123456 ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.code).toBe('123456');
  });

  it.each(['12345', '1234567', '12345a', 123456, null])(
    'rejects an invalid enable code (%p)',
    async (code) => {
      const dto = plainToInstance(EnableMfaDto, { code });

      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it.each([
    { mfaToken: MFA_TOKEN, code: '123456' },
    { mfaToken: MFA_TOKEN, recoveryCode: '2345-6789-ABCD-EFGH-JKLM' },
    { mfaToken: MFA_TOKEN, recoveryCode: '2345 6789 abcd efgh jklm' },
  ])('accepts exactly one valid MFA credential (%p)', async (input) => {
    const dto = plainToInstance(VerifyMfaDto, input);

    await expect(validate(dto)).resolves.toHaveLength(0);
    if (input.recoveryCode !== undefined) {
      expect(dto.recoveryCode).toBe('23456789ABCDEFGHJKLM');
    }
  });

  it.each([
    { mfaToken: MFA_TOKEN },
    { mfaToken: MFA_TOKEN, code: '123456', recoveryCode: '2345-6789-ABCD-EFGH-JKLM' },
    { mfaToken: MFA_TOKEN, code: null, recoveryCode: '2345-6789-ABCD-EFGH-JKLM' },
  ])('rejects requests that do not contain exactly one credential (%p)', async (input) => {
    const dto = plainToInstance(VerifyMfaDto, input);
    const errors = await validate(dto);

    expect(errors.some((error) => error.constraints?.exactlyOneMfaCredential !== undefined)).toBe(
      true,
    );
  });

  it('keeps the setup DTO empty so whitelist validation can reject all body fields', async () => {
    const dto = plainToInstance(MfaSetupDto, { unexpected: true });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('unexpected');
  });
});
