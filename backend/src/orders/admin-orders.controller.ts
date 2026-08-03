import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { requestContextFromRequest } from '../auth/utilities/request-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { getOrCreateRequestId } from '../common/middleware/request-id';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';
import type { AdminOrderDetail, AdminOrderSummary, OrderView } from './orders.types';

@ApiTags('Administration - Orders')
@ApiBearerAuth('access-token')
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders for Staff and Administrators' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<AdminOrderSummary>> {
    return this.orders.listAdmin(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an administrative order detail' })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ): Promise<AdminOrderDetail> {
    return this.orders.getAdmin(actor, orderId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Apply an allowed COD order status transition' })
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() request: Request,
  ): Promise<OrderView> {
    return this.orders.updateStatus({
      actor,
      orderId,
      dto,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }
}
