import { UserRole } from '@prisma/client';
import { Readable } from 'node:stream';

import type { ImageProcessingService } from '../uploads/image-processing.service';
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
  let storage: jest.Mocked<ObjectStorageService>;
  let deleteObject: jest.Mock;
  let service: ProductImagesService;

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      attachImage: jest.fn(),
      deleteImage: jest.fn(),
    } as unknown as jest.Mocked<ProductsRepository>;
    deleteObject = jest.fn();
    storage = {
      uploadWebp: jest.fn(),
      delete: deleteObject,
    } as unknown as jest.Mocked<ObjectStorageService>;
    service = new ProductImagesService(
      repository,
      {
        optimizeImage: jest.fn(),
        optimizeProductImage: jest.fn(),
      } as unknown as ImageProcessingService,
      storage,
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

  it('keeps the final image on an active product and leaves object storage untouched', async () => {
    repository.deleteImage.mockResolvedValue({ kind: 'active-product-image-required' });

    await expect(
      service.delete({
        actor,
        productId: '22222222-2222-4222-8222-222222222222',
        imageId: '33333333-3333-4333-8333-333333333333',
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PRODUCT_ACTIVE_IMAGE_REQUIRED' },
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
