import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AdministrationController } from './administration.controller';
import { AdministrationRepository } from './administration.repository';
import { AdministrationService } from './administration.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AdministrationController],
  providers: [AdministrationRepository, AdministrationService],
})
export class AdministrationModule {}
