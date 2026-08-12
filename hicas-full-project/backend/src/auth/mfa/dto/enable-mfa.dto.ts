import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class EnableMfaDto {
  @ApiProperty({
    description: 'Current six-digit code from the configured authenticator application',
    example: '123456',
    minLength: 6,
    maxLength: 6,
    pattern: '^[0-9]{6}$',
    writeOnly: true,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/)
  code!: string;
}
