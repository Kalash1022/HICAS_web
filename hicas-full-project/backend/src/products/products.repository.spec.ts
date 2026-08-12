import { AuditAction, Prisma, ProductStatus } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { ProductsRepository } from './products.repository';

const actorId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-25T00:00:00.000Z');

function productRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: productId,
    categoryId,
    name: 'Cotton shirt',
    slug: 'cotton-shirt',
    sku: 'COTTON-001',
    description: null,
    price: new Prisma.Decimal('199000'),
    compareAtPrice: null,
    status: ProductStatus.DRAFT,
    createdAt: now,
    updatedAt: now,
    category: { id: categoryId, name: 'Shirts', slug: 'shirts', isActive: true },
    inventory: { quantity: 0, reservedQuantity: 0, version: 0, updatedAt: now },
    images: [],
    ...overrides,
  };
}

describe(ProductsRepository.name, () => {
  it('uses escaped parameterized ILIKE search while preserving storefront visibility and stable ordering', async () => {
    const queryRaw = jest
      .fn<Promise<unknown[]>, [Prisma.Sql]>()
      .mockResolvedValueOnce([{ id: productId }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const findMany = jest.fn().mockResolvedValue([
      productRecord({
        status: ProductStatus.ACTIVE,
        images: [
          {
            id: 'image-id',
            url: 'https://cdn.example.com/product.webp',
            altText: 'Cotton shirt',
            sortOrder: 0,
            isPrimary: true,
          },
        ],
      }),
    ]);
    const repository = new ProductsRepository({
      $queryRaw: queryRaw,
      product: { findMany },
    } as unknown as DatabaseService);

    const result = await repository.listPublic({
      page: 1,
      limit: 10,
      search: 'cotton%_\\',
      sort: '-createdAt',
    });

    expect(result).toMatchObject({
      data: [
        {
          id: productId,
          name: 'Cotton shirt',
          price: '199000.00',
          primaryImage: { id: 'image-id' },
        },
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    expect(result.data[0]).not.toHaveProperty('sku');
    expect(result.data[0]).not.toHaveProperty('inventory');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
          deletedAt: null,
          category: { is: { isActive: true } },
          id: { in: [productId] },
        },
      }),
    );

    const firstQuery = queryRaw.mock.calls[0]?.[0];
    expect(firstQuery).toBeDefined();
    const sql = firstQuery as Prisma.Sql;
    expect(sql.strings.join(' ')).toContain('ILIKE');
    expect(sql.strings.join(' ')).toContain('ESCAPE');
    expect(sql.values).toContain('%cotton\\%\\_\\\\%');
  });

  it('returns only a visible ACTIVE product when resolving a public slug', async () => {
    const findFirst = jest.fn().mockResolvedValue(
      productRecord({
        status: ProductStatus.ACTIVE,
        images: [
          {
            id: 'image-id',
            url: 'https://cdn.example.com/product.webp',
            altText: 'Cotton shirt',
            sortOrder: 0,
            isPrimary: true,
          },
        ],
      }),
    );
    const repository = new ProductsRepository({
      product: { findFirst },
    } as unknown as DatabaseService);

    const result = await repository.findPublicBySlug('cotton-shirt');

    expect(result).toMatchObject({
      id: productId,
      slug: 'cotton-shirt',
      images: [{ id: 'image-id' }],
    });
    expect(result).not.toHaveProperty('sku');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
          deletedAt: null,
          category: { is: { isActive: true } },
          slug: 'cotton-shirt',
        },
      }),
    );
  });

  it('rejects a compare-at price below the selling price before opening a transaction', async () => {
    const database = {
      $transaction: jest.fn(),
    };
    const repository = new ProductsRepository(database as unknown as DatabaseService);

    await expect(
      repository.create({
        actorId,
        dto: {
          categoryId,
          name: 'Cotton shirt',
          slug: 'cotton-shirt',
          sku: 'COTTON-001',
          price: '199000',
          compareAtPrice: '198000',
        },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual({ kind: 'invalid-price' });

    expect(database.$transaction.mock.calls).toHaveLength(0);
  });

  it('creates a DRAFT product, zero inventory, and audit record in one transaction', async () => {
    const created = productRecord();
    const transaction = {
      category: { findUnique: jest.fn().mockResolvedValue({ id: categoryId }) },
      product: { create: jest.fn().mockResolvedValue(created) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new ProductsRepository(database);

    await expect(
      repository.create({
        actorId,
        dto: {
          categoryId,
          name: 'Cotton shirt',
          slug: 'cotton-shirt',
          sku: 'COTTON-001',
          price: '199000',
        },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      product: { status: ProductStatus.DRAFT, inventory: { quantity: 0, reservedQuantity: 0 } },
    });

    expectFirstCallToMatch(transaction.product.create, {
      data: {
        status: ProductStatus.DRAFT,
        inventory: { create: { quantity: 0, reservedQuantity: 0 } },
      },
    });
    expectFirstCallToMatch(transaction.auditLog.create, {
      data: { action: AuditAction.PRODUCT_CREATED, actorId, entityId: productId },
    });
  });

  it('does not allow a product to become ACTIVE without at least one image', async () => {
    const existing = productRecord();
    const transaction = {
      product: { findFirst: jest.fn().mockResolvedValue(existing), update: jest.fn() },
      category: { findUnique: jest.fn().mockResolvedValue({ id: categoryId, isActive: true }) },
      productImage: { count: jest.fn().mockResolvedValue(0) },
      inventory: { findUnique: jest.fn().mockResolvedValue({ productId }) },
      auditLog: { create: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new ProductsRepository(database);

    await expect(
      repository.update({
        actorId,
        productId,
        dto: { status: ProductStatus.ACTIVE },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual({ kind: 'cannot-activate', reasons: ['IMAGE_REQUIRED'] });

    expect(transaction.product.update.mock.calls).toHaveLength(0);
  });

  it('does not remove the final image from an ACTIVE product', async () => {
    const deleteImage = jest.fn();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: productId, status: ProductStatus.ACTIVE }]),
      productImage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'image-id',
          storageKey: 'products/product/image.webp',
          isPrimary: true,
        }),
        count: jest.fn().mockResolvedValue(1),
        delete: deleteImage,
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new ProductsRepository(database);

    await expect(
      repository.deleteImage({
        actorId,
        productId,
        imageId: 'image-id',
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual({ kind: 'active-product-image-required' });

    expect(deleteImage).not.toHaveBeenCalled();
  });
});

function expectFirstCallToMatch(
  mock: { mock: { calls: unknown[][] } },
  expected: Record<string, unknown>,
): void {
  expect(mock.mock.calls[0]?.[0]).toMatchObject(expected);
}
