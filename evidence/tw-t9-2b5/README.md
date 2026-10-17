# TW-T9.2b5 local smoke record

PG 16.15 (Homebrew) on :55433, throwaway cluster; roles as rls.yml (timeway_owner migrates, timeway_app NOSUPERUSER NOBYPASSRLS owns nothing).
prisma migrate deploy as timeway_owner incl. 20261016120000_tw_t9_2d_rls_core_tables (#58, 6c33eaa); no hand-written RLS SQL.
Run: DATABASE_URL=timeway_app DATABASE_POOL_MAX=1, yarn vitest run --config vitest.rls.config.mts
Gate JSON: {"total":20,"passed":20,"failed":0,"pending":0,"todo":0}; smoke file 6/6. Seed cleanup left 0 smoke users/orgs/bookings.
