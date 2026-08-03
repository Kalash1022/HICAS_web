import { CategoriesRepository } from './categories.repository';
import { PublicCategoriesService } from './public-categories.service';

describe(PublicCategoriesService.name, () => {
  it('returns the active storefront category projection without requiring an authenticated actor', async () => {
    const repository = {
      listPublic: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Shirts',
          slug: 'shirts',
          description: 'Shirts and tops',
          sortOrder: 10,
        },
      ]),
    } as unknown as jest.Mocked<CategoriesRepository>;
    const service = new PublicCategoriesService(repository);

    await expect(service.list()).resolves.toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Shirts',
        slug: 'shirts',
        description: 'Shirts and tops',
        sortOrder: 10,
      },
    ]);
  });
});
