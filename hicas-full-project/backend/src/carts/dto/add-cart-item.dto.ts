import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number;
}
