import { UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { DatabaseService } from '../database/database.service';
import { AddressesRepository } from './addresses.repository';
import { AddressesService } from './addresses.service';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const actor: AuthenticatedUser = {
  id: userId,
  email: 'customer@example.com',
  fullName: 'Customer',
  role: UserRole.CUSTOMER,
  sessionId: 'session-id',
};
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

describe(AddressesService.name, () => {
  let repository: jest.Mocked<AddressesRepository>;
  let service: AddressesService;

  beforeEach(() => {
    repository = {
      listForUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      lockOwnedShippingSnapshot: jest.fn(),
    } as unknown as jest.Mocked<AddressesRepository>;
    service = new AddressesService(repository);
  });

  it('uses the authenticated user as the list ownership boundary and never returns userId', async () => {
    repository.listForUser.mockResolvedValue([addressRecord()]);

    await expect(service.list(actor)).resolves.toEqual([
      {
        id: addressId,
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
      },
    ]);
    expect(repository.listForUser.mock.calls).toEqual([[userId]]);
  });

  it('uses the current user when creating an address', async () => {
    const dto = {
      recipientName: 'Nguyen Van A',
      phone: '0901234567',
      province: 'Ho Chi Minh City',
      district: 'District 1',
      ward: 'Ben Nghe Ward',
      street: '12 Nguyen Hue Street',
      isDefault: true,
    };
    repository.create.mockResolvedValue({ kind: 'updated', address: addressRecord() });

    await expect(service.create({ actor, dto })).resolves.toMatchObject({ id: addressId });

    expect(repository.create.mock.calls).toEqual([[{ userId, dto }]]);
  });

  it('does not disclose whether a foreign address exists', async () => {
    repository.update.mockResolvedValue({ kind: 'not-found' });

    await expect(
      service.update({ actor, addressId, dto: { street: 'Different street' } }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(repository.update.mock.calls).toEqual([
      [{ userId, addressId, dto: { street: 'Different street' } }],
    ]);
  });

  it('maps a default-address uniqueness backstop to a stable conflict response', async () => {
    repository.create.mockResolvedValue({ kind: 'default-conflict' });

    await expect(
      service.create({
        actor,
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
    ).rejects.toMatchObject({ status: 409, response: { code: 'ADDRESS_DEFAULT_CONFLICT' } });
  });

  it('gets an owned checkout snapshot through the caller transaction only', async () => {
    const transaction = {} as DatabaseService;
    const snapshot = {
      recipientName: 'Nguyen Van A',
      phone: '0901234567',
      province: 'Ho Chi Minh City',
      district: 'District 1',
      ward: 'Ben Nghe Ward',
      street: '12 Nguyen Hue Street',
      postalCode: '700000',
    };
    repository.lockOwnedShippingSnapshot.mockResolvedValue(snapshot);

    await expect(service.getOwnedShippingSnapshot(transaction, userId, addressId)).resolves.toEqual(
      snapshot,
    );
    expect(repository.lockOwnedShippingSnapshot.mock.calls).toEqual([
      [transaction, { userId, addressId }],
    ]);
  });

  it('rejects an unavailable checkout address before an order can be created', async () => {
    repository.lockOwnedShippingSnapshot.mockResolvedValue(null);

    await expect(
      service.getOwnedShippingSnapshot({} as DatabaseService, userId, addressId),
    ).rejects.toMatchObject({ status: 404, response: { code: 'ADDRESS_NOT_FOUND' } });
  });
});
