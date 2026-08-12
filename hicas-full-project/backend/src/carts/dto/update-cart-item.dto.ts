import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    minimum: 1,
    example: 2,
    description: 'The new absolute quantity for the cart item.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number;
}
