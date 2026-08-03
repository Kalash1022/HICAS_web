import { UserRole } from '@prisma/client';
import { Readable } from 'node:stream';

import { ObjectStorageService } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { ProductImagesService } from './product-images.service';
import { ProductsRepository } from './products.repository';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@example.com',
  fullName: 'Staff',
  role: UserRole.STAFF,
  sessionId: 'session-id',
};

function uploadFile(): Express.Multer.File {
  const buffer = Buffer.from('file');
  return {
    fieldname: 'image',
    originalname: 'image.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    stream: Readable.from(buffer),
    destination: '',
    filename: 'image.png',
    path: '',
    buffer,
  };
}

describe(ProductImagesService.name, () => {
  let repository: jest.Mocked<ProductsRepository>;
  let service: ProductImagesService;

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      attachImage: jest.fn(),
      deleteImage: jest.fn(),
    } as unknown as jest.Mocked<ProductsRepository>;
    service = new ProductImagesService(
      repository,
      { optimizeProductImage: jest.fn() },
      {
        uploadWebp: jest.fn(),
        delete: jest.fn(),
      } as unknown as ObjectStorageService,
      {
        runExclusive: jest.fn((_key: string, operation: () => Promise<unknown>) => operation()),
      } as unknown as StorageObjectKeyLockService,
    );
  });

  it('rejects a missing product before accepting an object upload', async () => {
    repository.find.mockResolvedValue(null);

    await expect(
      service.upload({
        actor,
        productId: '22222222-2222-4222-8222-222222222222',
        dto: {},
        file: uploadFile(),
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'PRODUCT_NOT_FOUND' } });
  });
});
