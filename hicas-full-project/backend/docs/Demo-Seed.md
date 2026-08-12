# Local demo fixtures

The demo seed creates a small, repeatable dataset for development and UI testing.
It is a separate command from the one-time initial Admin bootstrap and is never
run when the NestJS application starts.

## Safety boundary

The command refuses to run unless all of these conditions are true:

- NODE_ENV is development.
- DEMO_SEED_ENABLED is true.
- DEMO_SEED_CONFIRM is exactly LOCAL_HICAS_DEMO.
- Both DATABASE_URL and DIRECT_URL use PostgreSQL on localhost, 127.0.0.1,
  ::1, or the local Docker service postgres.
- Both URLs select the database named hicas.

This means a Supabase URL, a remote PostgreSQL server, and a non-development
environment are blocked before Prisma creates a database client.

## Run locally

Start the local PostgreSQL service, migrate the local database, then set the
two explicit opt-in values in backend/.env:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://hicas:hicas@localhost:5432/hicas?schema=public
DIRECT_URL=postgresql://hicas:hicas@localhost:5432/hicas?schema=public
DEMO_SEED_ENABLED=true
DEMO_SEED_CONFIRM=LOCAL_HICAS_DEMO
```

Run:

```powershell
cd backend
npm.cmd run prisma:migrate:dev
npm.cmd run demo:seed
```

The command is idempotent: it only creates its fixed fixtures and never updates
or deletes existing records. If a reserved fixture ID, email, slug, SKU, cart,
or default address conflicts with unrelated data, it stops without making
changes.

## Fixture contents

- 10 users: one active STAFF user, seven active verified CUSTOMER users, one
  pending customer, and one blocked customer.
- 3 categories and 6 DRAFT products, each with inventory.
- One customer cart containing two products and one default delivery address.

The seed deliberately does not create an Admin account, login credentials,
MFA material, media objects, orders, payments, audit logs, or inventory
transactions. Products remain DRAFT because active products require real,
application-managed product images.

The existing frontend mock data remains independent from these database
fixtures. API integration should use this seed only after the relevant screens
are connected to backend endpoints.
