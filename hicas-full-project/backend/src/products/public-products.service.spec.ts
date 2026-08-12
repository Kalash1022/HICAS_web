import { ProductsRepository } from './products.repository';
import { PublicProductsService } from './public-products.service';

describe(PublicProductsService.name, () => {
  let repository: jest.Mocked<ProductsRepository>;
  let service: PublicProductsService;

  beforeEach(() => {
    repository = {
      listPublic: jest.fn(),
      findPublicBySlug: jest.fn(),
    } as unknown as jest.Mocked<ProductsRepository>;
    service = new PublicProductsService(repository);
  });

  it('returns a hidden or missing product as the same not-found response', async () => {
    repository.findPublicBySlug.mockResolvedValue(null);

    await expect(service.getBySlug('hidden-product')).rejects.toMatchObject({
      status: 404,
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  it('forwards supported storefront pagination and sort filters without authentication', async () => {
    repository.listPublic.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });

    await expect(
      service.list({ page: 1, limit: 10, search: 'shirt', sort: '-createdAt' }),
    ).resolves.toMatchObject({ data: [] });

    expect(repository.listPublic.mock.calls).toEqual([
      [{ page: 1, limit: 10, search: 'shirt', sort: '-createdAt' }],
    ]);
  });
});
