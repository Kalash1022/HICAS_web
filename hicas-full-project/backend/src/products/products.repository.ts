import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, ProductStatus } from '@prisma/client';

import type { RequestContext } from '../auth/auth.types';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../database/database.service';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type {
  AdminProductDetail,
  AdminProductSummary,
  ProductImageMutationResult,
  ProductMutationResult,
} from './products.types';
import type { PublicProductDetail, PublicProductSummary } from './public-products.types';
import { MAX_PRODUCT_IMAGE_COUNT } from '../uploads/image-processing.service';

type ProductRecord = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  price: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  };
  inventory: {
    quantity: number;
    reservedQuantity: number;
    version: number;
    updatedAt: Date;
  } | null;
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    sortOrder: number;
    isPrimary: boolean;
    createdAt: Date;
  }>;
};

interface ExistingProduct {
  id: string;
  categoryId: string;
  price: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  status: ProductStatus;
}

interface PublicProductRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  createdAt: Date;
  category: {
    id: string;
    name: string;
    slug: string;
  };
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    sortOrder: number;
    isPrimary: boolean;
  }>;
}

interface PublicProductIdRow {
  id: string;
}

interface CountRow {
  total: number;
}

function knownRequestErrorCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function duplicateKind(
  error: Prisma.PrismaClientKnownRequestError,
): 'duplicate-sku' | 'duplicate-slug' {
  const target = error.meta?.target;
  const text = Array.isArray(target)
    ? target.filter((item): item is string => typeof item === 'string').join(',')
    : typeof target === 'string'
      ? target
      : '';
  return text.toLowerCase().includes('sku') ? 'duplicate-sku' : 'duplicate-slug';
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListProductsQueryDto): Promise<PaginatedResult<AdminProductSummary>> {
    const search = input.search?.trim();
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [products, total] = await this.database.$transaction([
      this.database.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: this.summarySelect(),
      }),
      this.database.product.count({ where }),
    ]);

    return {
      data: products.map((product) => this.toSummary(product)),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  async find(productId: string): Promise<AdminProductDetail | null> {
    const product = await this.database.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: this.detailSelect(),
    });
    return product ? this.toDetail(product) : null;
  }

  async listPublic(
    input: ListPublicProductsQueryDto,
  ): Promise<PaginatedResult<PublicProductSummary>> {
    const filter = this.publicProductSqlFilter(input);
    const offset = (input.page - 1) * input.limit;
    const productIdRows = await this.database.$queryRaw<PublicProductIdRow[]>(Prisma.sql`
      SELECT p.id
      FROM products AS p
      INNER JOIN categories AS c ON c.id = p.category_id
      WHERE ${filter}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${input.limit}
      OFFSET ${offset}
    `);
    const countRows = await this.database.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::integer AS "total"
      FROM products AS p
      INNER JOIN categories AS c ON c.id = p.category_id
      WHERE ${filter}
    `);
    const total = countRows[0]?.total ?? 0;
    const productIds = productIdRows.map((row) => row.id);
    if (productIds.length === 0) {
      return this.paginatedPublicProducts([], input, total);
    }

    const products = await this.database.product.findMany({
      where: {
        ...this.publicVisibilityWhere(),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        id: { in: productIds },
      },
      select: this.publicSummarySelect(),
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    const data = productIds.flatMap((productId) => {
      const product = productsById.get(productId);
      return product ? [this.toPublicSummary(product)] : [];
    });
    return this.paginatedPublicProducts(data, input, total);
  }

  async findPublicBySlug(slug: string): Promise<PublicProductDetail | null> {
    const product = await this.database.product.findFirst({
      where: {
        ...this.publicVisibilityWhere(),
        slug,
      },
      select: this.publicDetailSelect(),
    });
    return product ? this.toPublicDetail(product) : null;
  }

  async create(input: {
    actorId: string;
    dto: CreateProductDto;
    request: RequestContext;
    requestId: string;
  }): Promise<ProductMutationResult> {
    if (
      input.dto.compareAtPrice !== null &&
      input.dto.compareAtPrice !== undefined &&
      new Prisma.Decimal(input.dto.compareAtPrice).lessThan(new Prisma.Decimal(input.dto.price))
    ) {
      return { kind: 'invalid-price' };
    }
    try {
      return await this.database.$transaction(async (transaction) => {
        const category = await transaction.category.findUnique({
          where: { id: input.dto.categoryId },
          select: { id: true },
        });
        if (!category) {
          return { kind: 'category-not-found' };
        }

        const product = await transaction.product.create({
          data: {
            categoryId: category.id,
            name: input.dto.name,
            slug: input.dto.slug,
            sku: input.dto.sku,
            description: input.dto.description ?? null,
            price: input.dto.price,
            compareAtPrice: input.dto.compareAtPrice ?? null,
            status: ProductStatus.DRAFT,
            createdById: input.actorId,
            inventory: {
              create: {
                quantity: 0,
                reservedQuantity: 0,
              },
            },
          },
          select: this.detailSelect(),
        });
        await transaction.auditLog.create({
          data: {
            actorId: input.actorId,
            action: AuditAction.PRODUCT_CREATED,
            entityType: 'PRODUCT',
            entityId: product.id,
            afterData: this.auditSnapshot(product),
            ipAddress: input.request.ipAddress,
            requestId: input.requestId,
          },
        });
        return { kind: 'updated', product: this.toDetail(product) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: duplicateKind(error) };
      }
      if (knownRequestErrorCode(error) === 'P2003') {
        return { kind: 'category-not-found' };
      }
      if (knownRequestErrorCode(error) === 'P2000') {
        return { kind: 'invalid-price' };
      }
      throw error;
    }
  }

  async update(input: {
    actorId: string;
    productId: string;
    dto: UpdateProductDto;
    request: RequestContext;
    requestId: string;
  }): Promise<ProductMutationResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.product.findFirst({
          where: { id: input.productId, deletedAt: null },
          select: {
            id: true,
            categoryId: true,
            price: true,
            compareAtPrice: true,
            status: true,
          },
        });
        if (!existing) {
          return { kind: 'not-found' };
        }

        const categoryId = input.dto.categoryId ?? existing.categoryId;
        const category = await transaction.category.findUnique({
          where: { id: categoryId },
          select: { id: true, isActive: true },
        });
        if (!category) {
          return { kind: 'category-not-found' };
        }

        const effectivePrice = new Prisma.Decimal(input.dto.price ?? existing.price);
        const effectiveCompareAtPrice =
          input.dto.compareAtPrice === undefined
            ? existing.compareAtPrice
            : input.dto.compareAtPrice === null
              ? null
              : new Prisma.Decimal(input.dto.compareAtPrice);
        if (effectiveCompareAtPrice?.lessThan(effectivePrice)) {
          return { kind: 'invalid-price' };
        }

        const effectiveStatus = input.dto.status ?? existing.status;
        if (effectiveStatus === ProductStatus.ACTIVE) {
          const [imageCount, inventory] = await Promise.all([
            transaction.productImage.count({ where: { productId: existing.id } }),
            transaction.inventory.findUnique({
              where: { productId: existing.id },
              select: { productId: true },
            }),
          ]);
          const reasons = [
            ...(category.isActive ? [] : ['CATEGORY_INACTIVE']),
            ...(imageCount > 0 ? [] : ['IMAGE_REQUIRED']),
            ...(inventory ? [] : ['INVENTORY_MISSING']),
          ];
          if (reasons.length > 0) {
            return { kind: 'cannot-activate', reasons };
          }
        }

        const before = this.auditSnapshotFromExisting(existing);
        const product = await transaction.product.update({
          where: { id: existing.id },
          data: {
            ...(input.dto.categoryId === undefined ? {} : { categoryId }),
            ...(input.dto.name === undefined ? {} : { name: input.dto.name }),
            ...(input.dto.slug === undefined ? {} : { slug: input.dto.slug }),
            ...(input.dto.sku === undefined ? {} : { sku: input.dto.sku }),
            ...(input.dto.description === undefined ? {} : { description: input.dto.description }),
            ...(input.dto.price === undefined ? {} : { price: input.dto.price }),
            ...(input.dto.compareAtPrice === undefined
              ? {}
              : { compareAtPrice: input.dto.compareAtPrice }),
            ...(input.dto.status === undefined ? {} : { status: input.dto.status }),
          },
          select: this.detailSelect(),
        });
        await transaction.auditLog.create({
          data: {
            actorId: input.actorId,
            action: AuditAction.PRODUCT_UPDATED,
            entityType: 'PRODUCT',
            entityId: product.id,
            beforeData: before,
            afterData: this.auditSnapshot(product),
            ipAddress: input.request.ipAddress,
            requestId: input.requestId,
          },
        });
        return { kind: 'updated', product: this.toDetail(product) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: duplicateKind(error) };
      }
      if (knownRequestErrorCode(error) === 'P2003') {
        return { kind: 'category-not-found' };
      }
      if (knownRequestErrorCode(error) === 'P2025') {
        return { kind: 'not-found' };
      }
      if (knownRequestErrorCode(error) === 'P2000') {
        return { kind: 'invalid-price' };
      }
      throw error;
    }
  }

  async softDelete(input: {
    actorId: string;
    productId: string;
    request: RequestContext;
    requestId: string;
    now: Date;
  }): Promise<ProductMutationResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.product.findFirst({
          where: { id: input.productId, deletedAt: null },
          select: this.detailSelect(),
        });
        if (!existing) {
          return { kind: 'not-found' };
        }

        const product = await transaction.product.update({
          where: { id: existing.id },
          data: { deletedAt: input.now },
          select: this.detailSelect(),
        });
        await transaction.auditLog.create({
          data: {
            actorId: input.actorId,
            action: AuditAction.PRODUCT_UPDATED,
            entityType: 'PRODUCT',
            entityId: product.id,
            beforeData: this.auditSnapshot(existing),
            afterData: { ...this.auditSnapshot(product), deletedAt: input.now.toISOString() },
            ipAddress: input.request.ipAddress,
            requestId: input.requestId,
          },
        });
        return { kind: 'updated', product: this.toDetail(product) };
      });
    } catch (error) {
      if (knownRequestErrorCode(error) === 'P2025') {
        return { kind: 'not-found' };
      }
      throw error;
    }
  }

  async attachImage(input: {
    actorId: string;
    productId: string;
    url: string;
    storageKey: string;
    altText?: string;
    sortOrder?: number;
    isPrimary?: boolean;
    request: RequestContext;
    requestId: string;
  }): Promise<ProductImageMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM products
        WHERE id = ${input.productId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return { kind: 'product-not-found' };
      }

      const [imageCount, highestSortOrder] = await Promise.all([
        transaction.productImage.count({ where: { productId: input.productId } }),
        transaction.productImage.aggregate({
          where: { productId: input.productId },
          _max: { sortOrder: true },
        }),
      ]);
      if (imageCount >= MAX_PRODUCT_IMAGE_COUNT) {
        return { kind: 'max-images' };
      }

      const isPrimary = imageCount === 0 || input.isPrimary === true;
      if (isPrimary) {
        await transaction.productImage.updateMany({
          where: { productId: input.productId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const image = await transaction.productImage.create({
        data: {
          productId: input.productId,
          url: input.url,
          storageKey: input.storageKey,
          altText: input.altText ?? null,
          sortOrder: input.sortOrder ?? (highestSortOrder._max.sortOrder ?? -1) + 1,
          isPrimary,
        },
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
          createdAt: true,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: AuditAction.PRODUCT_UPDATED,
          entityType: 'PRODUCT',
          entityId: input.productId,
          afterData: {
            action: 'IMAGE_ADDED',
            imageId: image.id,
            imageCount: imageCount + 1,
          },
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });
      return { kind: 'attached', image };
    });
  }

  async deleteImage(input: {
    actorId: string;
    productId: string;
    imageId: string;
    request: RequestContext;
    requestId: string;
  }): Promise<ProductImageMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string; status: ProductStatus }>>`
        SELECT id, status
        FROM products
        WHERE id = ${input.productId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      const lockedProduct = locked[0];
      if (!lockedProduct) {
        return { kind: 'product-not-found' };
      }

      const image = await transaction.productImage.findFirst({
        where: { id: input.imageId, productId: input.productId },
        select: { id: true, storageKey: true, isPrimary: true },
      });
      if (!image) {
        return { kind: 'image-not-found' };
      }

      const imageCount = await transaction.productImage.count({
        where: { productId: input.productId },
      });
      if (lockedProduct.status === ProductStatus.ACTIVE && imageCount <= 1) {
        return { kind: 'active-product-image-required' };
      }

      await transaction.productImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const nextImage = await transaction.productImage.findFirst({
          where: { productId: input.productId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (nextImage) {
          await transaction.productImage.update({
            where: { id: nextImage.id },
            data: { isPrimary: true },
          });
        }
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: AuditAction.PRODUCT_UPDATED,
          entityType: 'PRODUCT',
          entityId: input.productId,
          afterData: { action: 'IMAGE_REMOVED', imageId: image.id },
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });
      return { kind: 'deleted', storageKey: image.storageKey };
    });
  }

  private summarySelect() {
    return {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      sku: true,
      description: true,
      price: true,
      compareAtPrice: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: { id: true, name: true, slug: true, isActive: true },
      },
      inventory: {
        select: { quantity: true, reservedQuantity: true, version: true, updatedAt: true },
      },
      images: {
        where: { isPrimary: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
          createdAt: true,
        },
      },
    } satisfies Prisma.ProductSelect;
  }

  private publicSummarySelect() {
    return {
      id: true,
      name: true,
      slug: true,
      price: true,
      compareAtPrice: true,
      createdAt: true,
      category: {
        select: { id: true, name: true, slug: true },
      },
      images: {
        where: { isPrimary: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
        },
      },
    } satisfies Prisma.ProductSelect;
  }

  private publicDetailSelect() {
    return {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      compareAtPrice: true,
      createdAt: true,
      category: {
        select: { id: true, name: true, slug: true },
      },
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
        },
      },
    } satisfies Prisma.ProductSelect;
  }

  private detailSelect() {
    return {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      sku: true,
      description: true,
      price: true,
      compareAtPrice: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: { id: true, name: true, slug: true, isActive: true },
      },
      inventory: {
        select: { quantity: true, reservedQuantity: true, version: true, updatedAt: true },
      },
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
          createdAt: true,
        },
      },
    } satisfies Prisma.ProductSelect;
  }

  private toSummary(product: ProductRecord): AdminProductSummary {
    const { images, ...common } = this.toCommon(product);
    return {
      ...common,
      primaryImage: images[0] ?? null,
    };
  }

  private toDetail(product: ProductRecord): AdminProductDetail {
    return this.toCommon(product);
  }

  private toPublicSummary(product: PublicProductRecord): PublicProductSummary {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      category: product.category,
      primaryImage: product.images[0] ?? null,
      createdAt: product.createdAt,
    };
  }

  private toPublicDetail(product: PublicProductRecord): PublicProductDetail {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description ?? null,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      category: product.category,
      images: product.images,
      createdAt: product.createdAt,
    };
  }

  private publicVisibilityWhere(): Prisma.ProductWhereInput {
    return {
      status: ProductStatus.ACTIVE,
      deletedAt: null,
      category: { is: { isActive: true } },
    };
  }

  private publicProductSqlFilter(input: ListPublicProductsQueryDto): Prisma.Sql {
    const search = input.search?.trim();
    const categoryFilter =
      input.categoryId === undefined
        ? Prisma.empty
        : Prisma.sql`AND p.category_id = ${input.categoryId}::uuid`;
    const searchFilter =
      search === undefined || search.length === 0
        ? Prisma.empty
        : Prisma.sql`
            AND (
              p.name ILIKE ${`%${escapeLikePattern(search)}%`} ESCAPE '\\'
              OR p.sku ILIKE ${`%${escapeLikePattern(search)}%`} ESCAPE '\\'
            )
          `;

    return Prisma.sql`
      p.status = ${ProductStatus.ACTIVE}::product_status
      AND p.deleted_at IS NULL
      AND c.is_active = TRUE
      ${categoryFilter}
      ${searchFilter}
    `;
  }

  private paginatedPublicProducts(
    data: PublicProductSummary[],
    input: ListPublicProductsQueryDto,
    total: number,
  ): PaginatedResult<PublicProductSummary> {
    return {
      data,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  private toCommon(product: ProductRecord): AdminProductDetail {
    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      description: product.description,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      category: product.category,
      inventory: product.inventory,
      images: product.images,
    };
  }

  private auditSnapshot(product: ProductRecord): Prisma.InputJsonObject {
    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      status: product.status,
      imageCount: product.images.length,
    };
  }

  private auditSnapshotFromExisting(product: ExistingProduct): Prisma.InputJsonObject {
    return {
      id: product.id,
      categoryId: product.categoryId,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      status: product.status,
    };
  }
}
