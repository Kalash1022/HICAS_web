import type { DatabaseService } from '../database/database.service';
import { CategoriesRepository } from './categories.repository';

const categoryId = '22222222-2222-4222-8222-222222222222';

describe(CategoriesRepository.name, () => {
  it('lists only active storefront categories in configured display order', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new CategoriesRepository({
      category: { findMany },
    } as unknown as DatabaseService);

    await expect(repository.listPublic()).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        sortOrder: true,
      },
    });
  });

  it('refuses to delete a category that has ever had a product', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: categoryId }]),
      product: { count: jest.fn().mockResolvedValue(1) },
      category: { delete: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new CategoriesRepository(database);

    await expect(repository.delete(categoryId)).resolves.toEqual({ kind: 'not-empty' });

    expect(transaction.category.delete.mock.calls).toHaveLength(0);
  });
});
