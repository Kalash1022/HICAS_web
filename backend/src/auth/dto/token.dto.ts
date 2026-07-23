import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class TokenDto {
  @ApiProperty({
    description: 'Single-use opaque token received by email',
    minLength: 32,
    maxLength: 256,
  })
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}
