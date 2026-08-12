import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

import {
  MONEY_PATTERN,
  normalizeMoney,
  normalizeSlug,
  SLUG_PATTERN,
  trimString,
} from './product-dto.utils';

export class CreateProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  categoryId!: string;

  @ApiProperty({ example: 'Áo thun cotton cổ tròn' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'ao-thun-cotton-co-tron' })
  @Transform(({ value }: { value: unknown }) => normalizeSlug(value))
  @IsString()
  @Matches(SLUG_PATTERN, {
    message: 'slug must contain lowercase letters, numbers, and single hyphens only',
  })
  @MaxLength(200)
  slug!: string;

  @ApiProperty({ example: 'TSHIRT-COTTON-001' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'sku must not be blank' })
  @MaxLength(100)
  sku!: string;

  @ApiPropertyOptional({ example: 'Áo cotton dành cho mặc hằng ngày.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @ApiProperty({
    example: '199000',
    description: 'Non-negative VND amount with up to two decimals',
  })
  @Transform(({ value }: { value: unknown }) => normalizeMoney(value))
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'price must be a non-negative amount with up to two decimals',
  })
  price!: string;

  @ApiPropertyOptional({ example: '249000', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeMoney(value))
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'compareAtPrice must be a non-negative amount with up to two decimals',
  })
  compareAtPrice?: string | null;
}
