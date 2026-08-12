import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(500)
  note?: string;
}
