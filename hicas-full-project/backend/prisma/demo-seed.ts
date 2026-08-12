import { Prisma, PrismaClient, ProductStatus, UserRole, UserStatus } from '@prisma/client';

const DEMO_SEED_CONFIRMATION = 'LOCAL_HICAS_DEMO';
const DEMO_SEED_ADVISORY_LOCK_ID = 8246119;
const FIXTURE_TIMESTAMP = new Date('2026-01-15T08:00:00.000Z');
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

const DEMO_STAFF_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const DEMO_CART_ID = '00000000-0000-4000-8000-000000009001';

type DemoSeedEnvironment = Readonly<Record<string, string | undefined>>;

export interface DemoSeedConfiguration {
  directUrl: string;
}

export type DemoSeedResult = 'seeded' | 'skipped';

export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = DemoSeedError.name;
  }
}

function requireEnvironmentValue(environment: DemoSeedEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new DemoSeedError('Demo seed requires ' + name + '.');
  }

  return value;
}

function requireLocalHicasDatabaseUrl(environment: DemoSeedEnvironment, name: string): string {
  const value = requireEnvironmentValue(environment, name);
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new DemoSeedError('Demo seed requires a valid PostgreSQL URL in ' + name + '.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  if (
    (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
    !LOCAL_DATABASE_HOSTS.has(hostname) ||
    databaseName !== 'hicas'
  ) {
    throw new DemoSeedError(
      'Demo seed is allowed only for the local PostgreSQL database named hicas.',
    );
  }

  return value;
}

export function readDemoSeedConfiguration(
  environment: DemoSeedEnvironment,
): DemoSeedConfiguration | null {
  if (environment.DEMO_SEED_ENABLED !== 'true') {
    return null;
  }

  if (environment.NODE_ENV !== 'development') {
    throw new DemoSeedError('Demo seed is allowed only when NODE_ENV is development.');
  }
  if (environment.DEMO_SEED_CONFIRM !== DEMO_SEED_CONFIRMATION) {
    throw new DemoSeedError(
      'Demo seed requires DEMO_SEED_CONFIRM=LOCAL_HICAS_DEMO before it can write data.',
    );
  }

  requireLocalHicasDatabaseUrl(environment, 'DATABASE_URL');
  const directUrl = requireLocalHicasDatabaseUrl(environment, 'DIRECT_URL');

  return { directUrl };
}

const DEMO_USERS = [
  {
    id: DEMO_STAFF_ID,
    email: 'demo.catalog.staff@hicas.local',
    emailNormalized: 'demo.catalog.staff@hicas.local',
    fullName: 'Demo Catalog Staff',
    phone: '0901000001',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: DEMO_CUSTOMER_ID,
    email: 'demo.customer@hicas.local',
    emailNormalized: 'demo.customer@hicas.local',
    fullName: 'Demo Customer',
    phone: '0901000002',
    birthDate: new Date('1993-04-12T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'demo.dianne@hicas.local',
    emailNormalized: 'demo.dianne@hicas.local',
    fullName: 'Dianne Russell',
    phone: '0901000003',
    birthDate: new Date('1992-05-16T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'demo.leslie@hicas.local',
    emailNormalized: 'demo.leslie@hicas.local',
    fullName: 'Leslie Alexander',
    phone: '0901000004',
    birthDate: new Date('1989-11-03T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    email: 'demo.wade@hicas.local',
    emailNormalized: 'demo.wade@hicas.local',
    fullName: 'Wade Warren',
    phone: '0901000005',
    birthDate: new Date('1990-08-21T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    email: 'demo.jane@hicas.local',
    emailNormalized: 'demo.jane@hicas.local',
    fullName: 'Jane Cooper',
    phone: '0901000006',
    birthDate: new Date('1995-01-28T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000007',
    email: 'demo.bessie@hicas.local',
    emailNormalized: 'demo.bessie@hicas.local',
    fullName: 'Bessie Cooper',
    phone: '0901000007',
    birthDate: new Date('1987-09-07T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000008',
    email: 'demo.arlene@hicas.local',
    emailNormalized: 'demo.arlene@hicas.local',
    fullName: 'Arlene McCoy',
    phone: '0901000008',
    birthDate: new Date('1991-02-10T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000009',
    email: 'demo.pending@hicas.local',
    emailNormalized: 'demo.pending@hicas.local',
    fullName: 'Liam Martinez',
    phone: '0901000009',
    role: UserRole.CUSTOMER,
    status: UserStatus.PENDING,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000000010',
    email: 'demo.blocked@hicas.local',
    emailNormalized: 'demo.blocked@hicas.local',
    fullName: 'Cody Fisher',
    phone: '0901000010',
    role: UserRole.CUSTOMER,
    status: UserStatus.BLOCKED,
    emailVerifiedAt: FIXTURE_TIMESTAMP,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.UserCreateManyInput[];

const DEMO_CATEGORIES = [
  {
    id: '00000000-0000-4000-8000-000000001001',
    name: 'Hàng mới',
    slug: 'demo-hang-moi',
    description: 'Danh mục demo dành cho sản phẩm mới.',
    sortOrder: 10,
    isActive: true,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000001002',
    name: 'Phụ kiện',
    slug: 'demo-phu-kien',
    description: 'Danh mục demo dành cho phụ kiện.',
    sortOrder: 20,
    isActive: true,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000001003',
    name: 'Ngừng bán',
    slug: 'demo-ngung-ban',
    description: 'Danh mục demo không hiển thị ở storefront.',
    sortOrder: 30,
    isActive: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.CategoryCreateManyInput[];

const DEMO_PRODUCTS = [
  {
    id: '00000000-0000-4000-8000-000000002001',
    categoryId: '00000000-0000-4000-8000-000000001001',
    name: 'Sổ tay bìa da mini',
    slug: 'demo-so-tay-bia-da-mini',
    sku: 'DEMO-001',
    description: 'Sản phẩm nháp để kiểm thử màn hình quản trị.',
    price: 189000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000002002',
    categoryId: '00000000-0000-4000-8000-000000001001',
    name: 'Bình giữ nhiệt HICAS',
    slug: 'demo-binh-giu-nhiet-hicas',
    sku: 'DEMO-002',
    description: 'Sản phẩm nháp để kiểm thử tồn kho và giỏ hàng.',
    price: 349000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000002003',
    categoryId: '00000000-0000-4000-8000-000000001002',
    name: 'Túi tote canvas',
    slug: 'demo-tui-tote-canvas',
    sku: 'DEMO-003',
    description: 'Sản phẩm nháp không có ảnh minh họa.',
    price: 219000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000002004',
    categoryId: '00000000-0000-4000-8000-000000001002',
    name: 'Tai nghe Bluetooth Lite',
    slug: 'demo-tai-nghe-bluetooth-lite',
    sku: 'DEMO-004',
    description: 'Sản phẩm nháp để kiểm thử giá tiền định dạng VND.',
    price: 699000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000002005',
    categoryId: '00000000-0000-4000-8000-000000001003',
    name: 'Đèn bàn cảm ứng',
    slug: 'demo-den-ban-cam-ung',
    sku: 'DEMO-005',
    description: 'Sản phẩm nháp thuộc danh mục không hoạt động.',
    price: 459000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000002006',
    categoryId: '00000000-0000-4000-8000-000000001002',
    name: 'Bàn phím cơ mini',
    slug: 'demo-ban-phim-co-mini',
    sku: 'DEMO-006',
    description: 'Sản phẩm nháp để kiểm thử phân trang danh sách.',
    price: 890000,
    status: ProductStatus.DRAFT,
    createdById: DEMO_STAFF_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.ProductCreateManyInput[];

const DEMO_INVENTORY = [
  {
    productId: '00000000-0000-4000-8000-000000002001',
    quantity: 50,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    productId: '00000000-0000-4000-8000-000000002002',
    quantity: 30,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    productId: '00000000-0000-4000-8000-000000002003',
    quantity: 40,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    productId: '00000000-0000-4000-8000-000000002004',
    quantity: 20,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    productId: '00000000-0000-4000-8000-000000002005',
    quantity: 25,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    productId: '00000000-0000-4000-8000-000000002006',
    quantity: 45,
    reservedQuantity: 0,
    version: 0,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.InventoryCreateManyInput[];

const DEMO_CART = [
  {
    id: DEMO_CART_ID,
    userId: DEMO_CUSTOMER_ID,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.CartCreateManyInput[];

const DEMO_CART_ITEMS = [
  {
    id: '00000000-0000-4000-8000-000000009101',
    cartId: DEMO_CART_ID,
    productId: '00000000-0000-4000-8000-000000002001',
    quantity: 2,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
  {
    id: '00000000-0000-4000-8000-000000009102',
    cartId: DEMO_CART_ID,
    productId: '00000000-0000-4000-8000-000000002002',
    quantity: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.CartItemCreateManyInput[];

const DEMO_ADDRESSES = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    userId: DEMO_CUSTOMER_ID,
    recipientName: 'Demo Customer',
    phone: '0901000002',
    province: 'Hồ Chí Minh',
    district: 'Quận 1',
    ward: 'Phường Bến Nghé',
    street: '1 Demo Street',
    postalCode: '700000',
    isDefault: true,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  },
] satisfies Prisma.AddressCreateManyInput[];

function fixtureKeyMap<T extends { id: string }>(
  fixtures: readonly T[],
  getKey: (fixture: T) => string,
): ReadonlyMap<string, string> {
  return new Map(fixtures.map((fixture) => [fixture.id, getKey(fixture)]));
}

function assertMatchingFixtureRecords<T extends { id: string }>(
  records: readonly T[],
  expectedKeys: ReadonlyMap<string, string>,
  getKey: (record: T) => string,
  fixtureName: string,
): void {
  for (const record of records) {
    const expectedKey = expectedKeys.get(record.id);
    if (expectedKey === undefined || expectedKey !== getKey(record)) {
      throw new DemoSeedError(
        'Existing data conflicts with a reserved demo ' + fixtureName + ' identifier.',
      );
    }
  }
}

async function assertNoFixtureConflicts(transaction: Prisma.TransactionClient): Promise<void> {
  const existingUsers = await transaction.user.findMany({
    where: {
      OR: [
        { id: { in: DEMO_USERS.map((user) => user.id) } },
        { emailNormalized: { in: DEMO_USERS.map((user) => user.emailNormalized) } },
      ],
    },
    select: { id: true, emailNormalized: true },
  });
  assertMatchingFixtureRecords(
    existingUsers,
    fixtureKeyMap(DEMO_USERS, (user) => user.emailNormalized),
    (user) => user.emailNormalized,
    'user',
  );

  const existingCategories = await transaction.category.findMany({
    where: {
      OR: [
        { id: { in: DEMO_CATEGORIES.map((category) => category.id) } },
        { slug: { in: DEMO_CATEGORIES.map((category) => category.slug) } },
      ],
    },
    select: { id: true, slug: true },
  });
  assertMatchingFixtureRecords(
    existingCategories,
    fixtureKeyMap(DEMO_CATEGORIES, (category) => category.slug),
    (category) => category.slug,
    'category',
  );

  const existingProducts = await transaction.product.findMany({
    where: {
      OR: [
        { id: { in: DEMO_PRODUCTS.map((product) => product.id) } },
        { slug: { in: DEMO_PRODUCTS.map((product) => product.slug) } },
        { sku: { in: DEMO_PRODUCTS.map((product) => product.sku) } },
      ],
    },
    select: { id: true, slug: true, sku: true },
  });
  assertMatchingFixtureRecords(
    existingProducts,
    fixtureKeyMap(DEMO_PRODUCTS, (product) => product.slug + ':' + product.sku),
    (product) => product.slug + ':' + product.sku,
    'product',
  );

  const existingCarts = await transaction.cart.findMany({
    where: {
      OR: [{ id: { in: DEMO_CART.map((cart) => cart.id) } }, { userId: DEMO_CUSTOMER_ID }],
    },
    select: { id: true, userId: true },
  });
  assertMatchingFixtureRecords(
    existingCarts,
    fixtureKeyMap(DEMO_CART, (cart) => cart.userId),
    (cart) => cart.userId,
    'cart',
  );

  const existingCartItems = await transaction.cartItem.findMany({
    where: {
      OR: [
        { id: { in: DEMO_CART_ITEMS.map((item) => item.id) } },
        {
          cartId: DEMO_CART_ID,
          productId: { in: DEMO_CART_ITEMS.map((item) => item.productId) },
        },
      ],
    },
    select: { id: true, cartId: true, productId: true },
  });
  assertMatchingFixtureRecords(
    existingCartItems,
    fixtureKeyMap(DEMO_CART_ITEMS, (item) => item.cartId + ':' + item.productId),
    (item) => item.cartId + ':' + item.productId,
    'cart item',
  );

  const existingAddresses = await transaction.address.findMany({
    where: {
      OR: [
        { id: { in: DEMO_ADDRESSES.map((address) => address.id) } },
        { userId: DEMO_CUSTOMER_ID, isDefault: true },
      ],
    },
    select: { id: true, userId: true, isDefault: true },
  });
  assertMatchingFixtureRecords(
    existingAddresses,
    fixtureKeyMap(DEMO_ADDRESSES, (address) => address.userId + ':' + String(address.isDefault)),
    (address) => address.userId + ':' + String(address.isDefault),
    'address',
  );
}

async function acquireDemoSeedLock(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_SEED_ADVISORY_LOCK_ID})`;
}

export async function seedDemoFixtures(database: PrismaClient): Promise<void> {
  await database.$transaction(async (transaction) => {
    await acquireDemoSeedLock(transaction);
    await assertNoFixtureConflicts(transaction);

    await transaction.user.createMany({ data: DEMO_USERS, skipDuplicates: true });
    await transaction.category.createMany({ data: DEMO_CATEGORIES, skipDuplicates: true });
    await transaction.product.createMany({ data: DEMO_PRODUCTS, skipDuplicates: true });
    await transaction.inventory.createMany({ data: DEMO_INVENTORY, skipDuplicates: true });
    await transaction.cart.createMany({ data: DEMO_CART, skipDuplicates: true });
    await transaction.cartItem.createMany({ data: DEMO_CART_ITEMS, skipDuplicates: true });
    await transaction.address.createMany({ data: DEMO_ADDRESSES, skipDuplicates: true });
  });
}

export async function runDemoSeed(
  environment: DemoSeedEnvironment = process.env,
): Promise<DemoSeedResult> {
  const configuration = readDemoSeedConfiguration(environment);
  if (!configuration) {
    return 'skipped';
  }

  const database = new PrismaClient({
    datasources: {
      db: {
        url: configuration.directUrl,
      },
    },
  });

  try {
    await seedDemoFixtures(database);
    return 'seeded';
  } finally {
    await database.$disconnect();
  }
}

function printResult(result: DemoSeedResult): void {
  if (result === 'seeded') {
    process.stdout.write('[demo-seed] Local demo fixtures are ready.\n');
    return;
  }

  process.stdout.write('[demo-seed] Skipped because DEMO_SEED_ENABLED is not true.\n');
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof DemoSeedError) {
    return error.message;
  }

  return 'Unexpected demo-seed failure. Inspect protected local logs for details.';
}

export async function main(): Promise<void> {
  const result = await runDemoSeed();
  printResult(result);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write('[demo-seed] ' + safeFailureMessage(error) + '\n');
    process.exitCode = 1;
  });
}
