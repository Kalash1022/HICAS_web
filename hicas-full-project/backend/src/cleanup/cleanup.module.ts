import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CleanupRepository } from './cleanup.repository';
import { CleanupSchedulerService } from './cleanup-scheduler.service';
import { OrphanImageCleanupService } from './orphan-image-cleanup.service';

@Module({
  imports: [DatabaseModule, UploadsModule],
  providers: [CleanupRepository, OrphanImageCleanupService, CleanupSchedulerService],
})
export class CleanupModule {}
