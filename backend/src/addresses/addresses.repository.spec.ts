import type { DatabaseService } from '../database/database.service';
import { AddressesRepository } from './addresses.repository';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const previousAddressId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-03T00:00:00.000Z');

function addressRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: addressId,
    userId,
    recipientName: 'Nguyen Van A',
    phone: '0901234567',
    province: 'Ho Chi Minh City',
    district: 'District 1',
    ward: 'Ben Nghe Ward',
    street: '12 Nguyen Hue Street',
    postalCode: '700000',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe(AddressesRepository.name, () => {
  it('lists only the current user addresses in stable newest-first order', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new AddressesRepository({
      address: { findMany },
    } as unknown as DatabaseService);

    await expect(repository.listForUser(userId)).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('serializes default creation through the user lock and demotes the old default atomically', async () => {
    const created = addressRecord();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
      address: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new AddressesRepository(database);

    await expect(
      repository.create({
        userId,
        dto: {
          recipientName: 'Nguyen Van A',
          phone: '0901234567',
          province: 'Ho Chi Minh City',
          district: 'District 1',
          ward: 'Ben Nghe Ward',
          street: '12 Nguyen Hue Street',
          isDefault: true,
        },
      }),
    ).resolves.toEqual({ kind: 'updated', address: created });

    expect(transaction.address.updateMany).toHaveBeenCalledWith({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    expectFirstCallToMatch(transaction.address.create, {
      data: { userId, isDefault: true, postalCode: null },
    });
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.address.updateMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('checks ownership before changing the default state or mutating an address', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: userId }])
        .mockResolvedValueOnce([]),
      address: {
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new AddressesRepository(database);

    await expect(
      repository.update({ userId, addressId, dto: { isDefault: true } }),
    ).resolves.toEqual({
      kind: 'not-found',
    });

    expect(transaction.address.updateMany).not.toHaveBeenCalled();
    expect(transaction.address.update).not.toHaveBeenCalled();
  });

  it('makes a selected owned address the only default in one transaction', async () => {
    const updated = addressRecord({ id: previousAddressId, isDefault: true });
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: userId }])
        .mockResolvedValueOnce([{ id: previousAddressId }]),
      address: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new AddressesRepository(database);

    await expect(
      repository.update({ userId, addressId: previousAddressId, dto: { isDefault: true } }),
    ).resolves.toEqual({ kind: 'updated', address: updated });

    expect(transaction.address.updateMany).toHaveBeenCalledWith({
      where: { userId, isDefault: true, id: { not: previousAddressId } },
      data: { isDefault: false },
    });
    expect(transaction.address.update).toHaveBeenCalledWith({
      where: { id: previousAddressId },
      data: { isDefault: true },
    });
  });

  it('allows explicitly clearing the default flag without selecting a replacement', async () => {
    const updated = addressRecord({ isDefault: false });
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: userId }])
        .mockResolvedValueOnce([{ id: addressId }]),
      address: {
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new AddressesRepository(database);

    await expect(
      repository.update({ userId, addressId, dto: { isDefault: false } }),
    ).resolves.toEqual({
      kind: 'updated',
      address: updated,
    });

    expect(transaction.address.updateMany).not.toHaveBeenCalled();
    expect(transaction.address.update).toHaveBeenCalledWith({
      where: { id: addressId },
      data: { isDefault: false },
    });
  });

  it('deletes only an address owned by the current user', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: userId }])
        .mockResolvedValueOnce([{ id: addressId }]),
      address: { delete: jest.fn().mockResolvedValue(addressRecord()) },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new AddressesRepository(database);

    await expect(repository.delete({ userId, addressId })).resolves.toEqual({ kind: 'deleted' });
    expect(transaction.address.delete).toHaveBeenCalledWith({ where: { id: addressId } });
  });

  it('reads the checkout shipping snapshot through the caller transaction without opening a nested transaction', async () => {
    const snapshot = {
      recipientName: 'Nguyen Van A',
      phone: '0901234567',
      province: 'Ho Chi Minh City',
      district: 'District 1',
      ward: 'Ben Nghe Ward',
      street: '12 Nguyen Hue Street',
      postalCode: '700000',
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([snapshot]),
    };
    const repository = new AddressesRepository({} as DatabaseService);

    await expect(
      repository.lockOwnedShippingSnapshot(transaction as never, { userId, addressId }),
    ).resolves.toEqual(snapshot);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

function expectFirstCallToMatch(
  mock: { mock: { calls: unknown[][] } },
  expected: Record<string, unknown>,
): void {
  expect(mock.mock.calls[0]?.[0]).toMatchObject(expected);
}
