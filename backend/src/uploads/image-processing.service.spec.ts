import sharp from 'sharp';

import { ImageProcessingService } from './image-processing.service';

describe(ImageProcessingService.name, () => {
  const service = new ImageProcessingService();

  it('checks magic bytes and converts a valid source to optimized WebP', async () => {
    const source = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const image = await service.optimizeProductImage(source);

    expect(image.contentType).toBe('image/webp');
    expect(image.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('rejects data that only pretends to be an image', async () => {
    await expect(service.optimizeProductImage(Buffer.from('not-an-image'))).rejects.toMatchObject({
      status: 400,
      response: { code: 'IMAGE_INVALID_FORMAT' },
    });
  });
});
