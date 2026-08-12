import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CartsController } from './carts.controller';
import { CartsRepository } from './carts.repository';
import { CartService } from './carts.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CartsController],
  providers: [CartsRepository, CartService],
  exports: [CartService],
})
export class CartsModule {}
