import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Nguyen Van A' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'recipientName must not be blank' })
  @MaxLength(160)
  recipientName!: string;

  @ApiProperty({ example: '0901234567' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'phone must not be blank' })
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: 'Ho Chi Minh City' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'province must not be blank' })
  @MaxLength(120)
  province!: string;

  @ApiProperty({ example: 'District 1' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'district must not be blank' })
  @MaxLength(120)
  district!: string;

  @ApiProperty({ example: 'Ben Nghe Ward' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'ward must not be blank' })
  @MaxLength(120)
  ward!: string;

  @ApiProperty({ example: '12 Nguyen Hue Street' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'street must not be blank' })
  @MaxLength(500)
  street!: string;

  @ApiPropertyOptional({ example: '700000', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'postalCode must not be blank' })
  @MaxLength(32)
  postalCode?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeBoolean(value))
  @IsBoolean()
  isDefault?: boolean;
}
