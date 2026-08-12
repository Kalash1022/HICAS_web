import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateIf,
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const MFA_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const RECOVERY_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{20}$/;

@ValidatorConstraint({ name: 'exactlyOneMfaCredential', async: false })
class ExactlyOneMfaCredentialConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, arguments_: ValidationArguments): boolean {
    const request = arguments_.object as Partial<VerifyMfaDto>;
    const suppliedCredentials = [request.code, request.recoveryCode].filter(
      (value) => value !== undefined,
    );

    return suppliedCredentials.length === 1;
  }

  defaultMessage(): string {
    return 'Exactly one of code or recoveryCode must be provided.';
  }
}

function ExactlyOneMfaCredential(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'exactlyOneMfaCredential',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: ExactlyOneMfaCredentialConstraint,
    });
  };
}

export class VerifyMfaDto {
  @ApiProperty({
    description: 'Single-purpose opaque MFA challenge token returned after primary authentication',
    minLength: 43,
    maxLength: 256,
    pattern: '^[A-Za-z0-9_-]+$',
    writeOnly: true,
  })
  @ExactlyOneMfaCredential()
  @IsString()
  @MinLength(43)
  @MaxLength(256)
  @Matches(MFA_TOKEN_PATTERN)
  mfaToken!: string;

  @ApiPropertyOptional({
    description: 'Current six-digit authenticator code; mutually exclusive with recoveryCode',
    example: '123456',
    minLength: 6,
    maxLength: 6,
    pattern: '^[0-9]{6}$',
    writeOnly: true,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/)
  code?: string;

  @ApiPropertyOptional({
    description: 'Single-use recovery code; mutually exclusive with code',
    minLength: 20,
    maxLength: 29,
    pattern: '^[2-9A-HJ-NP-Za-hj-np-z -]+$',
    writeOnly: true,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase().replace(/[ -]/g, '') : value,
  )
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsString()
  @Length(20, 20)
  @Matches(RECOVERY_CODE_PATTERN)
  recoveryCode?: string;
}
