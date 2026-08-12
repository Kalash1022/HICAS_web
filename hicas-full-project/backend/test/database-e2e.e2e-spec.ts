import { shouldRunDatabaseE2e } from './database-e2e';

const localEnvironment = {
  RUN_DATABASE_E2E: '1',
  DATABASE_URL: 'postgresql://hicas:hicas@localhost:5432/hicas?schema=public',
  DIRECT_URL: 'postgresql://hicas:hicas@localhost:5432/hicas?schema=public',
};

describe('database E2E safety guard', () => {
  it('requires explicit opt-in and local PostgreSQL URLs', () => {
    expect(shouldRunDatabaseE2e({ ...localEnvironment, RUN_DATABASE_E2E: 'true' })).toBe(false);
    expect(shouldRunDatabaseE2e(localEnvironment)).toBe(true);
  });

  it('rejects a remote database URL', () => {
    expect(
      shouldRunDatabaseE2e({
        ...localEnvironment,
        DIRECT_URL: 'postgresql://user:password@db.example.test:5432/hicas',
      }),
    ).toBe(false);
  });
});
