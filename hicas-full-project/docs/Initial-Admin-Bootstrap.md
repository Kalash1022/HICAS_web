# Initial Admin bootstrap

The backend has no hard-coded administrator. Create the first one with the explicit
Prisma seed command only; the NestJS application never reads or applies these values
at startup.

1. Apply the intended Prisma migrations first, using `DIRECT_URL`.
2. In the protected deployment environment, set all four values for a single command:

   ```dotenv
   INITIAL_ADMIN_BOOTSTRAP_ENABLED=true
   INITIAL_ADMIN_EMAIL=admin@example.com
   INITIAL_ADMIN_FULL_NAME=Initial Admin
   INITIAL_ADMIN_PASSWORD=<unique-password-of-8-to-128-characters>
   ```

3. From `backend`, run:

   ```powershell
   npm.cmd run prisma:seed
   ```

4. Remove or clear the four bootstrap variables immediately after a successful run.
   The new Admin must complete the existing MFA enrollment flow on its first login.

The seed requires `DIRECT_URL` and explicitly injects it into `PrismaClient`; it never
falls back to `DATABASE_URL`, which can be a transaction-mode pooler. It creates a
verified, `ACTIVE` Admin and its password credential in one nested database write. It
does not create a session, MFA record, or audit record.

The bootstrap acquires a transaction-scoped PostgreSQL advisory lock before it
checks for a verified `ACTIVE` Admin. Therefore two bootstrap jobs, even if configured with
different emails, cannot each create an initial Admin. If an active Admin is already
present, the command exits without changes. The normalized-email uniqueness
constraint remains a backstop against writers outside this command. A matching email
that already belongs to any other account state or role is a hard failure and is
never promoted or altered by the seed.
