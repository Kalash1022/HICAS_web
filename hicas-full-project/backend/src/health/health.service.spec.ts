import { HttpStatus } from '@nestjs/common';

import type { DatabaseService } from '../database/database.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const ping = jest.fn<Promise<void>, []>();
  const service = new HealthService({ ping } as unknown as DatabaseService);

  beforeEach(() => {
    ping.mockReset();
  });

  it('reports liveness without querying the database', () => {
    expect(service.live()).toEqual({
      status: 'ok',
      timestamp: expect.any(String) as string,
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports readiness after the database responds', async () => {
    ping.mockResolvedValue();

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String) as string,
      checks: { database: 'up' },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized service-unavailable error when the database is down', async () => {
    ping.mockRejectedValue(new Error('connection detail must not leak'));

    await expect(service.ready()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
