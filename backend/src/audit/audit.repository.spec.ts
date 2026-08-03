import { AuditAction } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { AuditRepository } from './audit.repository';

const actorId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const auditId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-08-03T00:00:00.000Z');

function auditRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: auditId,
    actorId,
    action: AuditAction.ORDER_STATUS_CHANGED,
    entityType: 'ORDER',
    entityId,
    beforeData: { status: 'PENDING' },
    afterData: { status: 'CONFIRMED' },
    ipAddress: '127.0.0.1',
    requestId: 'request-id',
    createdAt,
    actor: { id: actorId, email: 'admin@example.com', fullName: 'Admin' },
    ...overrides,
  };
}

describe(AuditRepository.name, () => {
  it('uses indexed equality filters and stable pagination ordering', async () => {
    const findMany = jest.fn().mockResolvedValue([auditRecord()]);
    const count = jest.fn().mockResolvedValue(1);
    const repository = new AuditRepository({
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      auditLog: { findMany, count },
    } as unknown as DatabaseService);

    const result = await repository.list({
      page: 2,
      limit: 10,
      action: AuditAction.ORDER_STATUS_CHANGED,
      actorId,
      entityType: ' ORDER ',
      entityId,
    });

    expect(result).toMatchObject({
      data: [
        {
          id: auditId,
          actor: { id: actorId, email: 'admin@example.com' },
          beforeData: { status: 'PENDING' },
        },
      ],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: AuditAction.ORDER_STATUS_CHANGED,
          actorId,
          entityType: 'ORDER',
          entityId,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        action: AuditAction.ORDER_STATUS_CHANGED,
        actorId,
        entityType: 'ORDER',
        entityId,
      },
    });
  });

  it('redacts sensitive keys recursively before returning an audit snapshot', async () => {
    const findMany = jest.fn().mockResolvedValue([
      auditRecord({
        beforeData: {
          status: 'PENDING',
          passwordHash: 'never-return-this',
          nested: { totpSecret: 'never-return-this-either' },
        },
        afterData: { recoveryCodes: ['not-a-real-code'] },
      }),
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const repository = new AuditRepository({
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      auditLog: { findMany, count },
    } as unknown as DatabaseService);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.data[0]?.beforeData).toEqual({
      status: 'PENDING',
      passwordHash: '[REDACTED]',
      nested: { totpSecret: '[REDACTED]' },
    });
    expect(result.data[0]?.afterData).toEqual({ recoveryCodes: '[REDACTED]' });
  });
});
