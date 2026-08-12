import { Injectable } from '@nestjs/common';

/**
 * Coordinates one object key at a time inside the Lean MVP's single backend process.
 * A future multi-instance deployment needs a durable upload claim or distributed lock.
 */
@Injectable()
export class StorageObjectKeyLockService {
  private readonly queues = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let resolveCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(key, queued);
    await previous;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      resolveCurrent?.();
      void queued.then(() => {
        if (this.queues.get(key) === queued) {
          this.queues.delete(key);
        }
      });
    };
  }
}
