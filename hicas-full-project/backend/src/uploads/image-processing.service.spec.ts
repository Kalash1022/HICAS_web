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

  it('limits concurrent Sharp processing while transferring released slots to queued work', async () => {
    const concurrency = service as unknown as {
      activeProcesses: number;
      acquireProcessingSlot: () => Promise<() => void>;
    };
    const firstRelease = await concurrency.acquireProcessingSlot();
    const secondRelease = await concurrency.acquireProcessingSlot();
    let thirdRelease: (() => void) | undefined;
    const thirdSlot = concurrency.acquireProcessingSlot().then((release) => {
      thirdRelease = release;
    });

    await Promise.resolve();
    expect(thirdRelease).toBeUndefined();
    expect(concurrency.activeProcesses).toBe(2);

    firstRelease();
    await thirdSlot;
    expect(thirdRelease).toBeDefined();
    expect(concurrency.activeProcesses).toBe(2);

    secondRelease();
    thirdRelease?.();
    expect(concurrency.activeProcesses).toBe(0);
  });
});
