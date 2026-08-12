import { IsIn } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateUserStatusDto {
  @IsIn([UserStatus.ACTIVE, UserStatus.BLOCKED])
  status!: UserStatus;
}
