import { UserStatus, VerificationTokenType } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { AuthRepository } from './auth.repository';

const userId = '0d9417bd-d8f8-43d7-9508-c82f8c99090f';
const tokenId = 'c5414142-bbe9-41cb-adfb-d67c81b78156';

describe(AuthRepository.name, () => {
  it('locks User before the verification token when consuming email verification', async () => {
    const events: string[] = [];
    const findUnique = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockImplementationOnce(() => {
        events.push('find-candidate');
        return Promise.resolve({
          id: tokenId,
          userId,
          type: VerificationTokenType.EMAIL_VERIFICATION,
        });
      })
      .mockImplementationOnce(() => {
        events.push('recheck-token');
        return Promise.resolve({
          id: tokenId,
          userId,
          type: VerificationTokenType.EMAIL_VERIFICATION,
          expiresAt: new Date('2026-07-24T00:00:00.000Z'),
          usedAt: null,
          user: {
            status: UserStatus.PENDING,
            emailVerifiedAt: null,
          },
        });
      });
    const updateToken = jest.fn((): Promise<void> => {
      events.push('consume-token');
      return Promise.resolve();
    });
    const updateUser = jest.fn((): Promise<void> => {
      events.push('activate-user');
      return Promise.resolve();
    });
    const repository = createRepository({
      findUnique,
      updateToken,
      updateUser,
      events,
    });

    await expect(
      repository.consumeEmailVerification(
        'email-verification-token-hash',
        new Date('2026-07-23T00:00:00.000Z'),
      ),
    ).resolves.toBe(true);

    expect(events).toEqual([
      'find-candidate',
      'lock-user',
      'lock-token',
      'recheck-token',
      'consume-token',
      'activate-user',
    ]);
  });

  it('rechecks a password-reset token after ordered locks and preserves single-use', async () => {
    const events: string[] = [];
    const findUnique = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockImplementationOnce(() => {
        events.push('find-candidate');
        return Promise.resolve({
          id: tokenId,
          userId,
          type: VerificationTokenType.PASSWORD_RESET,
        });
      })
      .mockImplementationOnce(() => {
        events.push('recheck-token');
        return Promise.resolve({
          id: tokenId,
          userId,
          type: VerificationTokenType.PASSWORD_RESET,
          expiresAt: new Date('2026-07-24T00:00:00.000Z'),
          usedAt: new Date('2026-07-22T00:00:00.000Z'),
          user: {
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        });
      });
    const updatePassword = jest.fn();
    const repository = createRepository({
      findUnique,
      updatePassword,
      events,
    });

    await expect(
      repository.resetPassword({
        tokenHash: 'password-reset-token-hash',
        passwordHash: 'replacement-password-hash',
        now: new Date('2026-07-23T00:00:00.000Z'),
      }),
    ).resolves.toBe(false);

    expect(events).toEqual(['find-candidate', 'lock-user', 'lock-token', 'recheck-token']);
    expect(updatePassword).not.toHaveBeenCalled();
  });
});

function createRepository(input: {
  findUnique: jest.Mock<Promise<unknown>, [unknown]>;
  events: string[];
  updateToken?: jest.Mock;
  updateUser?: jest.Mock;
  updatePassword?: jest.Mock;
}): AuthRepository {
  const queryRaw = jest.fn((strings: TemplateStringsArray): Promise<Array<{ id: string }>> => {
    const statement = strings.join(' ');
    if (statement.includes('FROM users')) {
      input.events.push('lock-user');
    } else if (statement.includes('FROM verification_tokens')) {
      input.events.push('lock-token');
    }
    return Promise.resolve([{ id: userId }]);
  });
  const transaction = {
    $queryRaw: queryRaw,
    verificationToken: {
      findUnique: input.findUnique,
      update: input.updateToken ?? jest.fn(),
    },
    user: {
      update: input.updateUser ?? jest.fn(),
    },
    passwordCredential: {
      updateMany: input.updatePassword ?? jest.fn(),
    },
  };
  const database = {
    $transaction: (operation: (client: typeof transaction) => Promise<unknown>): Promise<unknown> =>
      operation(transaction),
  } as unknown as DatabaseService;

  return new AuthRepository(database);
}
