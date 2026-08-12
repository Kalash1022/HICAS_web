import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  InventoryTransactionType,
  MfaTotpStatus,
  OrderStatus,
  Prisma,
  ProductStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { AccessTokenService } from '../src/auth/services/access-token.service';
import { DatabaseService } from '../src/database/database.service';
import { shouldRunDatabaseE2e } from './database-e2e';

const runDatabaseE2e = shouldRunDatabaseE2e();
const describeDatabase = runDatabaseE2e ? describe : describe.skip;

interface PrincipalFixture {
  id: string;
  email: string;
  token: string;
}

interface ProductFixture {
  id: string;
  categoryId: string;
  price: Prisma.Decimal;
  sku: string;
}

function setE2eConfigDefault(name: string, value: string): void {
  if (runDatabaseE2e && !process.env[name]?.trim()) {
    process.env[name] = value;
  }
}

setE2eConfigDefault('NODE_ENV', 'test');
setE2eConfigDefault('LOG_LEVEL', 'silent');
setE2eConfigDefault('FRONTEND_ORIGIN', 'http://localhost:5173');
setE2eConfigDefault('GOOGLE_CLIENT_ID', 'commerce-e2e-google-client');
setE2eConfigDefault('GOOGLE_CLIENT_SECRET', 'commerce-e2e-google-secret');
setE2eConfigDefault('GOOGLE_REDIRECT_URI', 'http://localhost:5173/auth/google/callback');
setE2eConfigDefault('OAUTH_TRANSACTION_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
setE2eConfigDefault(
  'JWT_ACCESS_SECRET',
  'commerce-e2e-only-jwt-access-secret-with-at-least-32-characters',
);
setE2eConfigDefault('MFA_ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
setE2eConfigDefault('MAIL_FROM', 'commerce-e2e@example.com');
setE2eConfigDefault('SMTP_HOST', 'localhost');
setE2eConfigDefault('S3_ENDPOINT', 'http://localhost:9000');
setE2eConfigDefault('S3_BUCKET', 'commerce-e2e');
setE2eConfigDefault('S3_ACCESS_KEY', 'commerce-e2e-access-key');
setE2eConfigDefault('S3_SECRET_KEY', 'commerce-e2e-secret-key');
setE2eConfigDefault('DEFAULT_SHIPPING_FEE_VND', '30000');

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected ' + label + ' to be an object');
  }

  return value as Record<string, unknown>;
}

function responseData(response: request.Response): Record<string, unknown> {
  return asRecord(asRecord(response.body as unknown, 'response body').data, 'response data');
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Expected ' + key + ' to be a non-empty string');
  }

  return value;
}

function expectErrorCode(response: request.Response, expectedCode: string): void {
  const body = asRecord(response.body as unknown, 'error response body');
  const error = asRecord(body.error, 'error response');
  expect(error.code).toBe(expectedCode);
}

describeDatabase('commerce checkout against PostgreSQL (e2e)', () => {
  jest.setTimeout(120_000);

  const fixtureTag = randomUUID();
  const fixtureUserIds = new Set<string>();
  const fixtureProductIds = new Set<string>();
  const fixtureCategoryIds = new Set<string>();

  let app: INestApplication | undefined;
  let database: DatabaseService | undefined;
  let accessTokens: AccessTokenService | undefined;
  let httpServer: Server;
  let expectedShippingFee = '30000.00';

  function requiredDatabase(): DatabaseService {
    if (!database) {
      throw new Error('Expected a connected database');
    }
    return database;
  }

  function requiredAccessTokens(): AccessTokenService {
    if (!accessTokens) {
      throw new Error('Expected an access token service');
    }
    return accessTokens;
  }

  async function createPrincipal(role: UserRole): Promise<PrincipalFixture> {
    const id = randomUUID();
    const email =
      'commerce-e2e-' + role.toLowerCase() + '-' + fixtureTag + '-' + id + '@example.test';
    const now = new Date();
    const databaseService = requiredDatabase();

    await databaseService.user.create({
      data: {
        id,
        email,
        emailNormalized: email,
        fullName: 'Commerce E2E ' + role,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: now,
      },
    });
    fixtureUserIds.add(id);

    if (role === UserRole.STAFF || role === UserRole.ADMIN) {
      await databaseService.mfaTotpMethod.create({
        data: {
          userId: id,
          secretEncrypted: 'commerce-e2e-not-used',
          status: MfaTotpStatus.ENABLED,
          enabledAt: now,
        },
      });
    }

    const sessionId = randomUUID();
    await databaseService.session.create({
      data: {
        id: sessionId,
        userId: id,
        tokenFamilyId: randomUUID(),
        refreshTokenHash: 'commerce-e2e-' + randomUUID(),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
      },
    });

    return {
      id,
      email,
      token: await requiredAccessTokens().sign({ userId: id, sessionId, role }),
    };
  }

  async function createAddress(customer: PrincipalFixture): Promise<string> {
    const id = randomUUID();
    await requiredDatabase().address.create({
      data: {
        id,
        userId: customer.id,
        recipientName: 'Commerce E2E Customer',
        phone: '0900000000',
        province: 'Ho Chi Minh City',
        district: 'District 1',
        ward: 'Ben Nghe Ward',
        street: '1 Commerce Test Street',
        postalCode: '700000',
        isDefault: true,
      },
    });
    return id;
  }

  async function createProduct(
    creator: PrincipalFixture,
    quantity: number,
    price: Prisma.Decimal = new Prisma.Decimal('120000.00'),
  ): Promise<ProductFixture> {
    const databaseService = requiredDatabase();
    const categoryId = randomUUID();
    const productId = randomUUID();
    const suffix = randomUUID().replaceAll('-', '');
    const slug = 'commerce-e2e-' + suffix;
    const sku = 'CE2E-' + suffix.slice(0, 16).toUpperCase();

    await databaseService.category.create({
      data: {
        id: categoryId,
        name: 'Commerce E2E Category',
        slug,
        sortOrder: 0,
        isActive: true,
      },
    });
    await databaseService.product.create({
      data: {
        id: productId,
        categoryId,
        name: 'Commerce E2E Product',
        slug: slug + '-product',
        sku,
        description: 'Isolated checkout fixture',
        price,
        status: ProductStatus.ACTIVE,
        createdById: creator.id,
      },
    });
    await databaseService.inventory.create({
      data: {
        productId,
        quantity,
        reservedQuantity: 0,
        version: 0,
      },
    });

    fixtureCategoryIds.add(categoryId);
    fixtureProductIds.add(productId);
    return { id: productId, categoryId, price, sku };
  }

  async function addCartItem(
    customer: PrincipalFixture,
    productId: string,
    quantity: number,
  ): Promise<string> {
    const response = await request(httpServer)
      .post('/api/v1/cart/items')
      .set('Authorization', 'Bearer ' + customer.token)
      .send({ productId, quantity })
      .expect(201);
    return requiredString(responseData(response), 'id');
  }

  async function createDirectCartItem(
    customer: PrincipalFixture,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const databaseService = requiredDatabase();
    const cart = await databaseService.cart.create({
      data: {
        id: randomUUID(),
        userId: customer.id,
      },
      select: { id: true },
    });
    await databaseService.cartItem.create({
      data: {
        id: randomUUID(),
        cartId: cart.id,
        productId,
        quantity,
      },
    });
  }

  async function cleanupFixtures(): Promise<void> {
    if (!database) {
      return;
    }

    const userIds = [...fixtureUserIds];
    const productIds = [...fixtureProductIds];
    const categoryIds = [...fixtureCategoryIds];
    if (userIds.length === 0 && productIds.length === 0 && categoryIds.length === 0) {
      return;
    }

    const orderIds = (
      await database.order.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      })
    ).map((order) => order.id);

    await database.$transaction(async (transaction) => {
      await transaction.auditLog.deleteMany({
        where: {
          OR: [{ actorId: { in: userIds } }, { entityId: { in: [...productIds, ...orderIds] } }],
        },
      });
      await transaction.inventoryTransaction.deleteMany({
        where: {
          OR: [{ productId: { in: productIds } }, { orderId: { in: orderIds } }],
        },
      });
      await transaction.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.order.deleteMany({ where: { id: { in: orderIds } } });
      await transaction.cart.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.address.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.productImage.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.inventory.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.product.deleteMany({ where: { id: { in: productIds } } });
      await transaction.category.deleteMany({ where: { id: { in: categoryIds } } });
      await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.mfaTotpMethod.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    });
  }

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();

    const connectedDatabase = app.get(DatabaseService);
    await connectedDatabase.ping();
    database = connectedDatabase;
    accessTokens = app.get(AccessTokenService);
    httpServer = app.getHttpServer() as Server;
    const shippingFee = app.get(ConfigService).getOrThrow<number>('DEFAULT_SHIPPING_FEE_VND');
    expectedShippingFee = new Prisma.Decimal(shippingFee).toFixed(2);
  });

  afterAll(async () => {
    try {
      await cleanupFixtures();
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('reserves inventory, snapshots checkout data, removes cart quantity, and replays safely', async () => {
    const staff = await createPrincipal(UserRole.STAFF);
    const customer = await createPrincipal(UserRole.CUSTOMER);
    const addressId = await createAddress(customer);
    const product = await createProduct(staff, 10);
    const cartItemId = await addCartItem(customer, product.id, 2);
    const idempotencyKey = 'commerce-e2e-' + randomUUID();
    const checkoutBody = {
      addressId,
      items: [{ productId: product.id, quantity: 1 }],
      customerNote: 'Commerce E2E checkout',
    };
    const expectedTotal = product.price.plus(new Prisma.Decimal(expectedShippingFee)).toFixed(2);

    const createdResponse = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customer.token)
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody)
      .expect(201);
    const createdOrder = responseData(createdResponse);
    const orderId = requiredString(createdOrder, 'id');
    const orderNumber = requiredString(createdOrder, 'orderNumber');
    expect(createdOrder).toMatchObject({
      id: orderId,
      orderNumber,
      status: OrderStatus.PENDING,
      paymentStatus: 'UNPAID',
      subtotal: product.price.toFixed(2),
      shippingFee: expectedShippingFee,
      totalAmount: expectedTotal,
      customerNote: 'Commerce E2E checkout',
      shippingSnapshot: {
        recipientName: 'Commerce E2E Customer',
        postalCode: '700000',
      },
    });
    expect(createdOrder.items).toEqual([
      expect.objectContaining({
        productId: product.id,
        productSku: product.sku,
        quantity: 1,
        unitPrice: product.price.toFixed(2),
        lineTotal: product.price.toFixed(2),
      }) as object,
    ]);

    const inventoryAfterCheckout = await requiredDatabase().inventory.findUnique({
      where: { productId: product.id },
      select: { quantity: true, reservedQuantity: true, version: true },
    });
    expect(inventoryAfterCheckout).toEqual({
      quantity: 10,
      reservedQuantity: 1,
      version: 1,
    });
    const cartAfterCheckout = await requiredDatabase().cart.findUnique({
      where: { userId: customer.id },
      select: { items: { select: { id: true, productId: true, quantity: true } } },
    });
    expect(cartAfterCheckout?.items).toEqual([
      { id: cartItemId, productId: product.id, quantity: 1 },
    ]);
    expect(
      await requiredDatabase().inventoryTransaction.findMany({
        where: { orderId, productId: product.id },
        select: {
          type: true,
          quantityDelta: true,
          reservedDelta: true,
          quantityAfter: true,
          reservedAfter: true,
        },
      }),
    ).toEqual([
      {
        type: InventoryTransactionType.RESERVE,
        quantityDelta: 0,
        reservedDelta: 1,
        quantityAfter: 10,
        reservedAfter: 1,
      },
    ]);

    const replayResponse = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customer.token)
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody)
      .expect(200);
    expect(responseData(replayResponse)).toMatchObject({ id: orderId, orderNumber });
    expect(
      await requiredDatabase().order.count({
        where: { userId: customer.id, idempotencyKey },
      }),
    ).toBe(1);

    const conflictResponse = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customer.token)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        ...checkoutBody,
        items: [{ productId: product.id, quantity: 2 }],
      })
      .expect(409);
    expectErrorCode(conflictResponse, 'IDEMPOTENCY_KEY_CONFLICT');

    const confirmationResponse = await request(httpServer)
      .patch('/api/v1/admin/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + staff.token)
      .send({ status: OrderStatus.CONFIRMED, note: 'Commerce E2E confirmation' })
      .expect(200);
    expect(responseData(confirmationResponse)).toMatchObject({
      id: orderId,
      status: OrderStatus.CONFIRMED,
      paymentStatus: 'UNPAID',
      paidAt: null,
    });

    const inventoryAfterConfirmation = await requiredDatabase().inventory.findUnique({
      where: { productId: product.id },
      select: { quantity: true, reservedQuantity: true, version: true },
    });
    expect(inventoryAfterConfirmation).toEqual({
      quantity: 9,
      reservedQuantity: 0,
      version: 2,
    });
    const transactionTypes = await requiredDatabase().inventoryTransaction.findMany({
      where: { orderId, productId: product.id },
      select: { type: true },
    });
    expect(transactionTypes.map((transaction) => transaction.type).sort()).toEqual([
      InventoryTransactionType.COMMIT,
      InventoryTransactionType.RESERVE,
    ]);
    expect(
      await requiredDatabase().auditLog.count({
        where: {
          actorId: staff.id,
          action: AuditAction.ORDER_STATUS_CHANGED,
          entityId: orderId,
        },
      }),
    ).toBe(1);
  });

  it('serializes concurrent checkout attempts and prevents overselling the last unit', async () => {
    const staff = await createPrincipal(UserRole.STAFF);
    const firstCustomer = await createPrincipal(UserRole.CUSTOMER);
    const secondCustomer = await createPrincipal(UserRole.CUSTOMER);
    const product = await createProduct(staff, 1);
    const [firstAddressId, secondAddressId] = await Promise.all([
      createAddress(firstCustomer),
      createAddress(secondCustomer),
    ]);
    await Promise.all([
      createDirectCartItem(firstCustomer, product.id, 1),
      createDirectCartItem(secondCustomer, product.id, 1),
    ]);

    const responses = await Promise.all([
      request(httpServer)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer ' + firstCustomer.token)
        .set('Idempotency-Key', 'commerce-e2e-race-' + randomUUID())
        .send({ addressId: firstAddressId, items: [{ productId: product.id, quantity: 1 }] }),
      request(httpServer)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer ' + secondCustomer.token)
        .set('Idempotency-Key', 'commerce-e2e-race-' + randomUUID())
        .send({ addressId: secondAddressId, items: [{ productId: product.id, quantity: 1 }] }),
    ]);
    const created = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedResponse = rejected[0];
    if (!rejectedResponse) {
      throw new Error('Expected one rejected checkout response');
    }
    expectErrorCode(rejectedResponse, 'PRODUCT_OUT_OF_STOCK');

    const inventory = await requiredDatabase().inventory.findUnique({
      where: { productId: product.id },
      select: { quantity: true, reservedQuantity: true, version: true },
    });
    expect(inventory).toEqual({ quantity: 1, reservedQuantity: 1, version: 1 });
    expect(
      await requiredDatabase().order.count({
        where: { userId: { in: [firstCustomer.id, secondCustomer.id] } },
      }),
    ).toBe(1);
    expect(
      await requiredDatabase().inventoryTransaction.count({
        where: { productId: product.id, type: InventoryTransactionType.RESERVE },
      }),
    ).toBe(1);
  });
});
