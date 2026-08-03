import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CartService } from './carts.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import type { CartItemView, CartView } from './carts.types';

@ApiTags('Cart')
@ApiBearerAuth('access-token')
@Controller('cart')
export class CartsController {
  constructor(private readonly carts: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user cart with current product prices' })
  get(@CurrentUser() actor: AuthenticatedUser): Promise<CartView> {
    return this.carts.get(actor);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a public product to the current user cart' })
  @ApiResponse({ status: HttpStatus.CREATED })
  add(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AddCartItemDto): Promise<CartItemView> {
    return this.carts.add({ actor, dto });
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Set the absolute quantity for an owned cart item' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartItemView> {
    return this.carts.update({ actor, itemId, dto });
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an owned cart item' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ): Promise<{ deleted: true }> {
    return this.carts.delete({ actor, itemId });
  }
}
