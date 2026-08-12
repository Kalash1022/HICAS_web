import { DemoSeedError, readDemoSeedConfiguration } from '../../prisma/demo-seed';

const localDatabaseUrl = 'postgresql://hicas:hicas@localhost:5432/hicas?schema=public';

const enabledEnvironment = {
  NODE_ENV: 'development',
  DEMO_SEED_ENABLED: 'true',
  DEMO_SEED_CONFIRM: 'LOCAL_HICAS_DEMO',
  DATABASE_URL: localDatabaseUrl,
  DIRECT_URL: localDatabaseUrl,
};

describe('local demo seed configuration', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(readDemoSeedConfiguration({})).toBeNull();
    expect(
      readDemoSeedConfiguration({
        ...enabledEnvironment,
        DEMO_SEED_ENABLED: 'TRUE',
      }),
    ).toBeNull();
  });

  it('accepts an explicitly confirmed local hicas database', () => {
    expect(readDemoSeedConfiguration(enabledEnvironment)).toEqual({
      directUrl: localDatabaseUrl,
    });
  });

  it('requires development mode and a deliberate confirmation', () => {
    expect(() =>
      readDemoSeedConfiguration({
        ...enabledEnvironment,
        NODE_ENV: 'production',
      }),
    ).toThrow('NODE_ENV is development');

    expect(() =>
      readDemoSeedConfiguration({
        ...enabledEnvironment,
        DEMO_SEED_CONFIRM: '',
      }),
    ).toThrow('DEMO_SEED_CONFIRM=LOCAL_HICAS_DEMO');
  });

  it('rejects remote or non-hicas database targets before constructing a client', () => {
    expect(() =>
      readDemoSeedConfiguration({
        ...enabledEnvironment,
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/hicas',
      }),
    ).toThrow(DemoSeedError);

    expect(() =>
      readDemoSeedConfiguration({
        ...enabledEnvironment,
        DIRECT_URL: 'postgresql://hicas:hicas@localhost:5432/not-hicas',
      }),
    ).toThrow('local PostgreSQL database named hicas');
  });
});
