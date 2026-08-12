import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeSlug(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'Áo thun' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ao-thun' })
  @Transform(({ value }: { value: unknown }) => normalizeSlug(value))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must contain lowercase letters, numbers, and single hyphens only',
  })
  @MaxLength(160)
  slug!: string;

  @ApiPropertyOptional({ example: 'Các mẫu áo thun cơ bản.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(5_000)
  description?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
