import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UploadProductImageDto {
  @ApiPropertyOptional({ example: 'Mặt trước áo thun cotton' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  altText?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
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
  isPrimary?: boolean;
}
