import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(500)
  note?: string;
}
