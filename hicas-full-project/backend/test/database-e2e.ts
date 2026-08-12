const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

type Environment = Readonly<Record<string, string | undefined>>;

function isLocalPostgresUrl(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:') &&
      LOCAL_DATABASE_HOSTS.has(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Destructive database E2E tests remain opt-in and reject remote URLs. The
 * CI service and Docker Compose use localhost or the postgres service name.
 */
export function shouldRunDatabaseE2e(environment: Environment = process.env): boolean {
  return (
    environment.RUN_DATABASE_E2E === '1' &&
    isLocalPostgresUrl(environment.DATABASE_URL) &&
    isLocalPostgresUrl(environment.DIRECT_URL)
  );
}
