import { isEmail } from 'class-validator';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

import { hashPassword, normalizeEmail } from '../src/auth/utilities/auth-crypto';

const INITIAL_ADMIN_PASSWORD_MIN_LENGTH = 8;
const INITIAL_ADMIN_PASSWORD_MAX_LENGTH = 128;
const INITIAL_ADMIN_FULL_NAME_MAX_LENGTH = 120;
const INITIAL_ADMIN_EMAIL_MAX_LENGTH = 254;
// This lock covers only the explicit one-time seed operation. It prevents two
// differently configured bootstrap jobs from both deciding they are first.
const INITIAL_ADMIN_ADVISORY_LOCK_ID = 8246118;

export interface InitialAdminBootstrapConfiguration {
  directUrl: string;
  email: string;
  emailNormalized: string;
  fullName: string;
  password: string;
}

export type InitialAdminBootstrapResult = 'created' | 'already-exists' | 'skipped';

export class InitialAdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = InitialAdminBootstrapError.name;
  }
}

type InitialAdminEnvironment = Readonly<Record<string, string | undefined>>;

function requireNonBlankEnvironmentValue(
  environment: InitialAdminEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new InitialAdminBootstrapError(
      `Initial Admin bootstrap requires ${name} when INITIAL_ADMIN_BOOTSTRAP_ENABLED=true.`,
    );
  }

  return value;
}

export function readInitialAdminBootstrapConfiguration(
  environment: InitialAdminEnvironment,
): InitialAdminBootstrapConfiguration | null {
  if (environment.INITIAL_ADMIN_BOOTSTRAP_ENABLED !== 'true') {
    return null;
  }

  // Seeding must not use DATABASE_URL: production runtime commonly points it at a
  // transaction-mode pooler, which is not suitable for Prisma administrative work.
  const directUrl = requireNonBlankEnvironmentValue(environment, 'DIRECT_URL');
  const email = requireNonBlankEnvironmentValue(environment, 'INITIAL_ADMIN_EMAIL').normalize(
    'NFKC',
  );
  const emailNormalized = normalizeEmail(email);
  const fullName = requireNonBlankEnvironmentValue(
    environment,
    'INITIAL_ADMIN_FULL_NAME',
  ).normalize('NFKC');
  const password = environment.INITIAL_ADMIN_PASSWORD;

  if (email.length > INITIAL_ADMIN_EMAIL_MAX_LENGTH || !isEmail(emailNormalized)) {
    throw new InitialAdminBootstrapError('INITIAL_ADMIN_EMAIL must be a valid email address.');
  }
  if (fullName.length === 0 || fullName.length > INITIAL_ADMIN_FULL_NAME_MAX_LENGTH) {
    throw new InitialAdminBootstrapError(
      `INITIAL_ADMIN_FULL_NAME must contain 1 to ${INITIAL_ADMIN_FULL_NAME_MAX_LENGTH} characters.`,
    );
  }
  if (
    typeof password !== 'string' ||
    password.trim().length === 0 ||
    password.length < INITIAL_ADMIN_PASSWORD_MIN_LENGTH ||
    password.length > INITIAL_ADMIN_PASSWORD_MAX_LENGTH
  ) {
    throw new InitialAdminBootstrapError(
      `INITIAL_ADMIN_PASSWORD must contain ${INITIAL_ADMIN_PASSWORD_MIN_LENGTH} to ${INITIAL_ADMIN_PASSWORD_MAX_LENGTH} characters.`,
    );
  }

  return {
    directUrl,
    email,
    emailNormalized,
    fullName,
    password,
  };
}

type InitialAdminUserStore = Pick<PrismaClient['user'], 'findFirst' | 'findUnique' | 'create'>;
type InitialAdminDatabase = Pick<PrismaClient, '$transaction'>;

async function findUserByNormalizedEmail(
  users: Pick<InitialAdminUserStore, 'findUnique'>,
  emailNormalized: string,
): Promise<{ role: UserRole; status: UserStatus; emailVerifiedAt: Date | null } | null> {
  return users.findUnique({
    where: { emailNormalized },
    select: {
      role: true,
      status: true,
      emailVerifiedAt: true,
    },
  });
}

async function hasActiveAdmin(users: Pick<InitialAdminUserStore, 'findFirst'>): Promise<boolean> {
  const activeAdmin = await users.findFirst({
    where: {
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: { not: null },
    },
    select: { id: true },
  });
  return activeAdmin !== null;
}

function isUsableActiveAdmin(user: {
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}): boolean {
  return (
    user.role === UserRole.ADMIN &&
    user.status === UserStatus.ACTIVE &&
    user.emailVerifiedAt !== null
  );
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

async function acquireInitialAdminLock(
  transaction: Pick<PrismaClient, '$executeRaw'>,
): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${INITIAL_ADMIN_ADVISORY_LOCK_ID})`;
}

export async function ensureInitialAdmin(
  database: InitialAdminDatabase,
  input: Omit<InitialAdminBootstrapConfiguration, 'directUrl' | 'password'> & {
    passwordHash: string;
    now?: Date;
  },
): Promise<Exclude<InitialAdminBootstrapResult, 'skipped'>> {
  try {
    return await database.$transaction(
      async (transaction): Promise<Exclude<InitialAdminBootstrapResult, 'skipped'>> => {
        await acquireInitialAdminLock(transaction);

        const existingUser = await findUserByNormalizedEmail(
          transaction.user,
          input.emailNormalized,
        );
        if (existingUser) {
          if (!isUsableActiveAdmin(existingUser)) {
            throw new InitialAdminBootstrapError(
              'The configured bootstrap email already belongs to a non-active-Admin account; no changes were made.',
            );
          }
        }

        if ((await hasActiveAdmin(transaction.user)) || existingUser) {
          return 'already-exists';
        }

        // The nested create is one database operation: it cannot leave an Admin user
        // without its PasswordCredential if the operation fails.
        await transaction.user.create({
          data: {
            email: input.email,
            emailNormalized: input.emailNormalized,
            fullName: input.fullName,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: input.now ?? new Date(),
            passwordCredential: {
              create: {
                passwordHash: input.passwordHash,
              },
            },
          },
        });
        return 'created';
      },
    );
  } catch (error) {
    // A concurrent bootstrap with the same email is safe because the unique index
    // chooses one creator. The loser re-reads and only accepts an active Admin;
    // it never mutates an already-created account.
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }

    return await database.$transaction(
      async (transaction): Promise<Exclude<InitialAdminBootstrapResult, 'skipped'>> => {
        await acquireInitialAdminLock(transaction);

        const racedUser = await findUserByNormalizedEmail(transaction.user, input.emailNormalized);
        if (racedUser && !isUsableActiveAdmin(racedUser)) {
          throw new InitialAdminBootstrapError(
            'The configured bootstrap email was claimed by an account that is not an active verified Admin; no changes were made.',
          );
        }
        if ((await hasActiveAdmin(transaction.user)) || racedUser) {
          return 'already-exists';
        }

        throw new InitialAdminBootstrapError(
          'The configured bootstrap email was claimed by an account that is not an active Admin; no changes were made.',
        );
      },
    );
  }
}

export async function runInitialAdminBootstrap(
  environment: InitialAdminEnvironment = process.env,
): Promise<InitialAdminBootstrapResult> {
  const configuration = readInitialAdminBootstrapConfiguration(environment);
  if (!configuration) {
    return 'skipped';
  }

  const database = new PrismaClient({
    datasources: {
      db: {
        url: configuration.directUrl,
      },
    },
  });

  try {
    const passwordHash = await hashPassword(configuration.password);
    return await ensureInitialAdmin(database, {
      email: configuration.email,
      emailNormalized: configuration.emailNormalized,
      fullName: configuration.fullName,
      passwordHash,
    });
  } finally {
    await database.$disconnect();
  }
}

function printResult(result: InitialAdminBootstrapResult): void {
  switch (result) {
    case 'created':
      process.stdout.write('[initial-admin-bootstrap] Created the initial active Admin account.\n');
      return;
    case 'already-exists':
      process.stdout.write(
        '[initial-admin-bootstrap] An active Admin already exists; no changes were made.\n',
      );
      return;
    case 'skipped':
      process.stdout.write(
        '[initial-admin-bootstrap] Skipped because INITIAL_ADMIN_BOOTSTRAP_ENABLED is not true.\n',
      );
  }
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof InitialAdminBootstrapError) {
    return error.message;
  }

  // Database driver errors can embed a connection string. Do not print arbitrary
  // error messages from a process that reads database credentials from the environment.
  return 'Unexpected bootstrap failure. Inspect protected deployment logs for details.';
}

export async function main(): Promise<void> {
  const result = await runInitialAdminBootstrap();
  printResult(result);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`[initial-admin-bootstrap] ${safeFailureMessage(error)}\n`);
    process.exitCode = 1;
  });
}
