import { HttpStatus, Injectable } from '@nestjs/common';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import { ProductsRepository } from './products.repository';
import type { PublicProductDetail, PublicProductSummary } from './public-products.types';

@Injectable()
export class PublicProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  list(query: ListPublicProductsQueryDto): Promise<PaginatedResult<PublicProductSummary>> {
    return this.repository.listPublic(query);
  }

  async getBySlug(slug: string): Promise<PublicProductDetail> {
    const product = await this.repository.findPublicBySlug(slug);
    if (!product) {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'PRODUCT_NOT_FOUND',
        'Product not found.',
      );
    }
    return product;
  }
}
