import { StorageObjectKeyLockService } from './storage-object-key-lock.service';

describe(StorageObjectKeyLockService.name, () => {
  it('serializes work for the same object key while allowing the next holder to proceed', async () => {
    const locks = new StorageObjectKeyLockService();
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = locks.runExclusive('products/a/image.webp', () => {
      calls.push('first-start');
      return new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }).then(() => {
        calls.push('first-end');
      });
    });
    const second = locks.runExclusive('products/a/image.webp', () => {
      calls.push('second');
      return Promise.resolve();
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(calls).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not serialize unrelated object keys', async () => {
    const locks = new StorageObjectKeyLockService();
    const calls: string[] = [];

    await Promise.all([
      locks.runExclusive('products/a/image.webp', () => {
        calls.push('a');
        return Promise.resolve();
      }),
      locks.runExclusive('products/b/image.webp', () => {
        calls.push('b');
        return Promise.resolve();
      }),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining(['a', 'b']));
  });
});
