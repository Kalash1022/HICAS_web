import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AddressesModule } from './addresses/addresses.module';
import { AdministrationModule } from './administration/administration.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CartsModule } from './carts/carts.module';
import { CategoriesModule } from './categories/categories.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AccessTokenGuard } from './common/guards/access-token.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ApplicationConfigModule } from './config/application-config.module';
import { createLoggerParams } from './config/logger.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ApplicationConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createLoggerParams,
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    CartsModule,
    OrdersModule,
    UploadsModule,
    NotificationsModule,
    AuditModule,
    AdministrationModule,
    CleanupModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
