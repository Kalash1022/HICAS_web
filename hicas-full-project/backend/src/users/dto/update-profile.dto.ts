import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120, example: 'Nguyen Van A' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 32,
    example: '0901234567',
    description: 'Use null to clear the saved phone number.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    example: '1990-01-31',
    description: 'Calendar date in YYYY-MM-DD format. Use null to clear it.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string | null;
}
