import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class GoogleCallbackDto {
  @ApiProperty({
    description: 'Single-use authorization code returned by Google',
    minLength: 1,
    maxLength: 4_096,
    writeOnly: true,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4_096)
  code!: string;

  @ApiProperty({
    description: 'Opaque OAuth state returned unchanged by Google',
    minLength: 43,
    maxLength: 256,
    writeOnly: true,
  })
  @IsString()
  @MinLength(43)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/)
  state!: string;
}
