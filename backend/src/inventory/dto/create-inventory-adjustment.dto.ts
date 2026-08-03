import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, MaxLength, Min, NotEquals } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateInventoryAdjustmentDto {
  @ApiProperty({
    description: 'Signed quantity change. Negative values remove available stock.',
    example: 25,
  })
  @Type(() => Number)
  @IsInt()
  @Min(-2_147_483_648)
  @Max(2_147_483_647)
  @NotEquals(0)
  quantityDelta!: number;

  @ApiProperty({
    description: 'Inventory version read by the administrator before making this adjustment.',
    example: 3,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @ApiProperty({ example: 'Received stock from the July supplier delivery.' })
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason!: string;
}
