import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import { PublicProductsService } from './public-products.service';
import type { PublicProductDetail, PublicProductSummary } from './public-products.types';

@ApiTags('Storefront - Products')
@Public()
@Controller('products')
export class PublicProductsController {
  constructor(private readonly products: PublicProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products visible in the storefront catalog' })
  list(@Query() query: ListPublicProductsQueryDto): Promise<PaginatedResult<PublicProductSummary>> {
    return this.products.list(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a storefront product by slug' })
  getBySlug(@Param('slug') slug: string): Promise<PublicProductDetail> {
    return this.products.getBySlug(slug);
  }
}
