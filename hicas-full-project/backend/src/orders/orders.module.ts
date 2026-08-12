import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AddressesModule } from '../addresses/addresses.module';
import { CartsModule } from '../carts/carts.module';
import { DatabaseModule } from '../database/database.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdminOrdersController } from './admin-orders.controller';
import { CheckoutRateLimiterService } from './checkout-rate-limiter.service';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [ConfigModule, DatabaseModule, AddressesModule, CartsModule, InventoryModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [CheckoutRateLimiterService, OrdersRepository, OrdersService],
})
export class OrdersModule {}
