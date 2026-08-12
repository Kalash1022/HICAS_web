import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminProductsController } from './admin-products.controller';
import { ProductImagesService } from './product-images.service';
import { PublicProductsController } from './public-products.controller';
import { PublicProductsService } from './public-products.service';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [DatabaseModule, UploadsModule],
  controllers: [AdminProductsController, PublicProductsController],
  providers: [ProductsRepository, ProductsService, ProductImagesService, PublicProductsService],
})
export class ProductsModule {}
