import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole, type InventoryTransaction } from '@prisma/client';
import type { Request } from 'express';

import { requestContextFromRequest } from '../auth/utilities/request-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { getOrCreateRequestId } from '../common/middleware/request-id';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { ListInventoryTransactionsQueryDto } from './dto/list-inventory-transactions-query.dto';
import { InventoryService } from './inventory.service';
import type { InventoryAdjustmentResult } from './inventory.types';

@ApiTags('Administration - Inventory')
@ApiBearerAuth('access-token')
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller('admin/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post(':productId/adjustments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust inventory with optimistic locking' })
  @ApiResponse({ status: HttpStatus.OK })
  adjust(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<InventoryAdjustmentResult> {
    return this.inventory.adjust({
      actor,
      productId,
      dto,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Get(':productId/transactions')
  @ApiOperation({ summary: 'List append-only inventory transaction history' })
  listTransactions(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Query() query: ListInventoryTransactionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<InventoryTransaction>> {
    return this.inventory.listTransactions(actor, productId, query);
  }
}
