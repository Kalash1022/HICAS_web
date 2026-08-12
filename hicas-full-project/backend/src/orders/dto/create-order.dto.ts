import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { CreateOrderItemDto } from './create-order-item.dto';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsUUID('4')
  addressId!: string;

  @ApiProperty({ type: () => [CreateOrderItemDto], minItems: 1 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiPropertyOptional({ maxLength: 1_000, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(1_000)
  customerNote?: string;
}
