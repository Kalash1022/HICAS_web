import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';
import { PublicCategoriesController } from './public-categories.controller';
import { PublicCategoriesService } from './public-categories.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminCategoriesController, PublicCategoriesController],
  providers: [CategoriesRepository, CategoriesService, PublicCategoriesService],
})
export class CategoriesModule {}
