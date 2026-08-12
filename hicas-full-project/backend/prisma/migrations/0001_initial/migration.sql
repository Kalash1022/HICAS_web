-- HICAS Commerce Lean MVP initial schema.
-- UUIDs are generated in PostgreSQL so inserts made outside Prisma remain safe.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING');
CREATE TYPE "auth_provider" AS ENUM ('GOOGLE');
CREATE TYPE "mfa_totp_status" AS ENUM ('PENDING', 'ENABLED');
CREATE TYPE "primary_auth_method" AS ENUM ('PASSWORD', 'GOOGLE');
CREATE TYPE "verification_token_type" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "security_event_type" AS ENUM (
  'LOGIN_FAILED',
  'PASSWORD_RESET',
  'MFA_CHANGED',
  'MFA_RECOVERY_CODE_USED',
  'MFA_RESET_BY_ADMIN'
);
CREATE TYPE "audit_action" AS ENUM (
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'INVENTORY_ADJUSTED',
  'ORDER_STATUS_CHANGED',
  'USER_BLOCKED',
  'USER_UNBLOCKED',
  'USER_ROLE_CHANGED',
  'USER_MFA_RESET'
);
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "inventory_transaction_type" AS ENUM (
  'IMPORT',
  'ADJUST',
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'RESTOCK'
);
CREATE TYPE "order_status" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPING',
  'COMPLETED',
  'CANCELLED'
);
CREATE TYPE "payment_method" AS ENUM ('COD');
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PAID');
CREATE TYPE "currency_code" AS ENUM ('VND');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "phone" TEXT,
  "avatar_url" TEXT,
  "birth_date" DATE,
  "role" "user_role" NOT NULL DEFAULT 'CUSTOMER',
  "status" "user_status" NOT NULL DEFAULT 'PENDING',
  "email_verified_at" TIMESTAMPTZ(3),
  "last_login_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized_key" UNIQUE ("email_normalized")
);

CREATE TABLE "password_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_credentials_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "password_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "auth_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" "auth_provider" NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "provider_email" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_identities_provider_account_key"
    UNIQUE ("provider", "provider_account_id"),
  CONSTRAINT "auth_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "oauth_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "state_hash" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "pkce_verifier_encrypted" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oauth_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_transactions_state_hash_key" UNIQUE ("state_hash"),
  CONSTRAINT "oauth_transactions_nonce_hash_key" UNIQUE ("nonce_hash")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "token_family_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "replaced_by_session_id" UUID,
  "ip_address" INET,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash"),
  CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sessions_replaced_by_session_id_fkey"
    FOREIGN KEY ("replaced_by_session_id") REFERENCES "sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "mfa_totp_methods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "secret_encrypted" TEXT NOT NULL,
  "status" "mfa_totp_status" NOT NULL DEFAULT 'PENDING',
  "setup_expires_at" TIMESTAMPTZ(3),
  "enabled_at" TIMESTAMPTZ(3),
  "last_used_time_step" BIGINT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_totp_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_totp_methods_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "mfa_totp_methods_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mfa_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "primary_method" "primary_auth_method" NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "ip_address" INET,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_challenges_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "mfa_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mfa_enrollment_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "primary_method" "primary_auth_method" NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_enrollment_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_enrollment_grants_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "mfa_enrollment_grants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mfa_recovery_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_recovery_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "verification_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "type" "verification_token_type" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verification_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "verification_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "security_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "type" "security_event_type" NOT NULL,
  "ip_address" INET,
  "user_agent" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" UUID,
  "action" "audit_action" NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "ip_address" INET,
  "request_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "addresses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "recipient_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "ward" TEXT NOT NULL,
  "street" TEXT NOT NULL,
  "postal_code" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "addresses_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_slug_key" UNIQUE ("slug")
);

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "description" TEXT,
  "price" NUMERIC(14,2) NOT NULL,
  "compare_at_price" NUMERIC(14,2),
  "status" "product_status" NOT NULL DEFAULT 'DRAFT',
  "created_by" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_slug_key" UNIQUE ("slug"),
  CONSTRAINT "products_sku_key" UNIQUE ("sku"),
  CONSTRAINT "products_price_nonnegative_ck" CHECK ("price" >= 0),
  CONSTRAINT "products_compare_price_ck"
    CHECK ("compare_at_price" IS NULL OR "compare_at_price" >= "price"),
  CONSTRAINT "products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "products_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "product_images" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "alt_text" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "product_images_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "inventory" (
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_pkey" PRIMARY KEY ("product_id"),
  CONSTRAINT "inventory_quantity_nonnegative_ck" CHECK ("quantity" >= 0),
  CONSTRAINT "inventory_reserved_nonnegative_ck" CHECK ("reserved_quantity" >= 0),
  CONSTRAINT "inventory_reserved_lte_quantity_ck"
    CHECK ("reserved_quantity" <= "quantity"),
  CONSTRAINT "inventory_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "carts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "carts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carts_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "carts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "cart_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cart_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_cart_id_product_id_key" UNIQUE ("cart_id", "product_id"),
  CONSTRAINT "cart_items_quantity_positive_ck" CHECK ("quantity" > 0),
  CONSTRAINT "cart_items_cart_id_fkey"
    FOREIGN KEY ("cart_id") REFERENCES "carts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cart_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_number" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "order_status" NOT NULL DEFAULT 'PENDING',
  "payment_method" "payment_method" NOT NULL DEFAULT 'COD',
  "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
  "paid_at" TIMESTAMPTZ(3),
  "subtotal" NUMERIC(14,2) NOT NULL,
  "shipping_fee" NUMERIC(14,2) NOT NULL,
  "discount_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(14,2) NOT NULL,
  "currency" "currency_code" NOT NULL DEFAULT 'VND',
  "shipping_snapshot" JSONB NOT NULL,
  "customer_note" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "idempotency_request_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_order_number_key" UNIQUE ("order_number"),
  CONSTRAINT "orders_user_id_idempotency_key_key"
    UNIQUE ("user_id", "idempotency_key"),
  CONSTRAINT "orders_subtotal_nonnegative_ck" CHECK ("subtotal" >= 0),
  CONSTRAINT "orders_shipping_fee_nonnegative_ck" CHECK ("shipping_fee" >= 0),
  CONSTRAINT "orders_discount_nonnegative_ck" CHECK ("discount_amount" >= 0),
  CONSTRAINT "orders_discount_lte_subtotal_ck"
    CHECK ("discount_amount" <= "subtotal"),
  CONSTRAINT "orders_total_formula_ck"
    CHECK ("total_amount" = "subtotal" + "shipping_fee" - "discount_amount"),
  CONSTRAINT "orders_cod_payment_lifecycle_ck"
    CHECK (
      (
        "payment_status" = 'PAID'
        AND "status" = 'COMPLETED'
        AND "paid_at" IS NOT NULL
      )
      OR
      (
        "payment_status" = 'UNPAID'
        AND "status" <> 'COMPLETED'
        AND "paid_at" IS NULL
      )
    ),
  CONSTRAINT "orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "product_id" UUID,
  "product_name" TEXT NOT NULL,
  "product_sku" TEXT NOT NULL,
  "product_image_url" TEXT,
  "unit_price" NUMERIC(14,2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "line_total" NUMERIC(14,2) NOT NULL,

  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_quantity_positive_ck" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_unit_price_nonnegative_ck" CHECK ("unit_price" >= 0),
  CONSTRAINT "order_items_line_total_nonnegative_ck" CHECK ("line_total" >= 0),
  CONSTRAINT "order_items_line_total_formula_ck"
    CHECK ("line_total" = "unit_price" * "quantity"),
  CONSTRAINT "order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "order_status_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "from_status" "order_status",
  "to_status" "order_status" NOT NULL,
  "changed_by" UUID,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_status_history_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_status_history_changed_by_fkey"
    FOREIGN KEY ("changed_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "inventory_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "order_id" UUID,
  "type" "inventory_transaction_type" NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "reserved_delta" INTEGER NOT NULL,
  "quantity_after" INTEGER NOT NULL,
  "reserved_after" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transactions_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_transactions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Required query and stable-pagination indexes.
CREATE INDEX "users_role_status_id_idx"
  ON "users" ("role", "status", "id");
CREATE INDEX "users_created_at_id_idx"
  ON "users" ("created_at" DESC, "id" DESC);

CREATE INDEX "auth_identities_user_id_idx"
  ON "auth_identities" ("user_id");

CREATE INDEX "oauth_transactions_expires_at_idx"
  ON "oauth_transactions" ("expires_at");

CREATE INDEX "sessions_user_id_revoked_at_idx"
  ON "sessions" ("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx"
  ON "sessions" ("expires_at");
CREATE INDEX "sessions_token_family_id_idx"
  ON "sessions" ("token_family_id");

CREATE INDEX "mfa_totp_methods_setup_expires_at_idx"
  ON "mfa_totp_methods" ("setup_expires_at");
CREATE INDEX "mfa_challenges_expires_at_idx"
  ON "mfa_challenges" ("expires_at");
CREATE INDEX "mfa_challenges_user_id_consumed_at_idx"
  ON "mfa_challenges" ("user_id", "consumed_at");
CREATE INDEX "mfa_enrollment_grants_expires_at_idx"
  ON "mfa_enrollment_grants" ("expires_at");
CREATE INDEX "mfa_enrollment_grants_user_state_idx"
  ON "mfa_enrollment_grants" ("user_id", "consumed_at", "revoked_at");
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx"
  ON "mfa_recovery_codes" ("user_id", "used_at");

CREATE INDEX "verification_tokens_expires_at_idx"
  ON "verification_tokens" ("expires_at");
CREATE INDEX "verification_tokens_user_type_used_at_idx"
  ON "verification_tokens" ("user_id", "type", "used_at");

CREATE INDEX "security_events_user_created_at_id_idx"
  ON "security_events" ("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX "audit_logs_created_at_id_idx"
  ON "audit_logs" ("created_at" DESC, "id" DESC);
CREATE INDEX "audit_logs_actor_id_idx"
  ON "audit_logs" ("actor_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx"
  ON "audit_logs" ("entity_type", "entity_id");

CREATE INDEX "addresses_user_id_idx"
  ON "addresses" ("user_id");
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("user_id")
  WHERE "is_default" = true;

CREATE INDEX "categories_is_active_sort_order_id_idx"
  ON "categories" ("is_active", "sort_order", "id");
CREATE INDEX "categories_created_at_id_idx"
  ON "categories" ("created_at" DESC, "id" DESC);

CREATE INDEX "products_category_status_deleted_at_idx"
  ON "products" ("category_id", "status", "deleted_at");
CREATE INDEX "products_status_deleted_created_id_idx"
  ON "products" ("status", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "products_created_by_idx"
  ON "products" ("created_by");

CREATE INDEX "product_images_product_id_sort_order_idx"
  ON "product_images" ("product_id", "sort_order");
CREATE UNIQUE INDEX "product_images_one_primary_per_product"
  ON "product_images" ("product_id")
  WHERE "is_primary" = true;

CREATE INDEX "cart_items_product_id_idx"
  ON "cart_items" ("product_id");

CREATE INDEX "orders_user_created_at_id_idx"
  ON "orders" ("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "orders_status_created_at_id_idx"
  ON "orders" ("status", "created_at" DESC, "id" DESC);

CREATE INDEX "order_items_order_id_idx"
  ON "order_items" ("order_id");
CREATE INDEX "order_items_product_id_idx"
  ON "order_items" ("product_id");

CREATE INDEX "order_status_history_order_created_id_idx"
  ON "order_status_history" ("order_id", "created_at" DESC, "id" DESC);
CREATE INDEX "order_status_history_changed_by_idx"
  ON "order_status_history" ("changed_by");

CREATE INDEX "inventory_transactions_product_created_id_idx"
  ON "inventory_transactions" ("product_id", "created_at" DESC, "id" DESC);
CREATE INDEX "inventory_transactions_order_id_idx"
  ON "inventory_transactions" ("order_id");
CREATE INDEX "inventory_transactions_created_by_idx"
  ON "inventory_transactions" ("created_by");
