-- HICAS exposes data only through the NestJS API. Supabase Data API roles must
-- never read or mutate the application schema directly.
DO $hicas$
DECLARE
  api_role text;
  app_table text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', api_role);

      FOREACH app_table IN ARRAY ARRAY[
        '_prisma_migrations',
        'users',
        'password_credentials',
        'auth_identities',
        'oauth_transactions',
        'sessions',
        'mfa_totp_methods',
        'mfa_challenges',
        'mfa_enrollment_grants',
        'mfa_recovery_codes',
        'verification_tokens',
        'security_events',
        'audit_logs',
        'addresses',
        'categories',
        'products',
        'product_images',
        'inventory',
        'inventory_transactions',
        'carts',
        'cart_items',
        'orders',
        'order_items',
        'order_status_history'
      ]
      LOOP
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          app_table,
          api_role
        );
      END LOOP;

      -- Keep future Prisma-created objects private by default as well.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$hicas$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- RLS is a second boundary if a Data API grant is accidentally restored later.
-- The Prisma connection owns these tables and therefore retains normal access.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_totp_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_enrollment_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
