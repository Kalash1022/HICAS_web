import { HttpStatus, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { RequestContext } from '../auth/auth.types';
import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import { ProductsRepository } from './products.repository';
import type {
  AdminProductDetail,
  AdminProductSummary,
  ProductMutationResult,
} from './products.types';

@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  list(
    actor: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<PaginatedResult<AdminProductSummary>> {
    this.assertCatalogManager(actor);
    return this.repository.list(query);
  }

  async get(actor: AuthenticatedUser, productId: string): Promise<AdminProductDetail> {
    this.assertCatalogManager(actor);
    const product = await this.repository.find(productId);
    if (!product) {
      this.throwNotFound();
    }
    return product;
  }

  async create(input: {
    actor: AuthenticatedUser;
    dto: CreateProductDto;
    request: RequestContext;
    requestId: string;
  }): Promise<AdminProductDetail> {
    this.assertCatalogManager(input.actor);
    return this.unwrapMutation(
      await this.repository.create({
        actorId: input.actor.id,
        dto: input.dto,
        request: input.request,
        requestId: input.requestId,
      }),
    );
  }

  async update(input: {
    actor: AuthenticatedUser;
    productId: string;
    dto: UpdateProductDto;
    request: RequestContext;
    requestId: string;
  }): Promise<AdminProductDetail> {
    this.assertCatalogManager(input.actor);
    return this.unwrapMutation(
      await this.repository.update({
        actorId: input.actor.id,
        productId: input.productId,
        dto: input.dto,
        request: input.request,
        requestId: input.requestId,
      }),
    );
  }

  async softDelete(input: {
    actor: AuthenticatedUser;
    productId: string;
    request: RequestContext;
    requestId: string;
  }): Promise<{ deleted: true }> {
    this.assertCatalogManager(input.actor);
    this.unwrapMutation(
      await this.repository.softDelete({
        actorId: input.actor.id,
        productId: input.productId,
        request: input.request,
        requestId: input.requestId,
        now: new Date(),
      }),
    );
    return { deleted: true };
  }

  private unwrapMutation(result: ProductMutationResult): AdminProductDetail {
    if (result.kind === 'updated') {
      return result.product;
    }
    if (result.kind === 'not-found') {
      this.throwNotFound();
    }
    if (result.kind === 'category-not-found') {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'PRODUCT_CATEGORY_NOT_FOUND',
        'The selected category was not found.',
      );
    }
    if (result.kind === 'duplicate-slug') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'PRODUCT_SLUG_CONFLICT',
        'A product with this slug already exists.',
      );
    }
    if (result.kind === 'duplicate-sku') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'PRODUCT_SKU_CONFLICT',
        'A product with this SKU already exists.',
      );
    }
    if (result.kind === 'invalid-price') {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'PRODUCT_INVALID_PRICE',
        'compareAtPrice must be greater than or equal to price.',
      );
    }
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'PRODUCT_CANNOT_ACTIVATE',
      'The product does not meet the requirements for activation.',
      { reasons: result.reasons },
    );
  }

  private assertCatalogManager(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.STAFF && actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage the catalog.',
      );
    }
  }

  private throwNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
}
