import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, DatabaseModule, UploadsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
})
export class UsersModule {}
