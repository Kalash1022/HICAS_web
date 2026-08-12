import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { requestContextFromRequest } from '../auth/utilities/request-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { getOrCreateRequestId } from '../common/middleware/request-id';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrdersService } from './orders.service';
import type { OrderDetail, OrderSummary, OrderView } from './orders.types';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders owned by the current user' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderSummary>> {
    return this.orders.listOwn(actor, query);
  }

  @Get(':orderNumber')
  @ApiOperation({ summary: 'Get an order owned by the current user' })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
  ): Promise<OrderDetail> {
    return this.orders.getOwn(actor, orderNumber);
  }

  @Post()
  @ApiOperation({ summary: 'Create a COD order from selected cart items' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A client-generated key used to safely retry the same checkout request.',
    schema: { type: 'string', maxLength: 255 },
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'A new order was created.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'A previous identical checkout was replayed.',
  })
  async checkout(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrderView> {
    const result = await this.orders.checkout({
      actor,
      dto,
      idempotencyKey,
      request: requestContextFromRequest(request),
    });
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.order;
  }

  @Post(':orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending order owned by the current user' })
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelOrderDto = {},
    @Req() request: Request,
  ): Promise<OrderView> {
    return this.orders.cancelOwn({
      actor,
      orderNumber,
      dto,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }
}
