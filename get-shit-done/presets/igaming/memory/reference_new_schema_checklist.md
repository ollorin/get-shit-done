---
name: new-postgresql-schema-3-step-checklist
description: "Adding a new non-public Postgres schema requires config.toml + a grants migration + schema()-qualified RPC calls, or you hit 42501/42883 errors"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

Skipping any step causes 42501/42883 errors and test failures (caused 37 failures in the KYC
phase, March 2026).

1. **config.toml** — add the schema to BOTH `schemas` and `extra_search_path` in
   `apps/api/supabase/config.toml`
2. **Grants migration** — create a migration:
   `GRANT USAGE ON SCHEMA myschema TO authenticator, anon, service_role;`
3. **Edge function callers** — use `supabase.schema('myschema' as never).rpc(...)` for all RPCs in
   that schema

Full details: `.claude/rules/database.md` (New PostgreSQL Schema Checklist) and
`.claude/rules/edge-functions.md` (Non-Public Schema RPC Calls).
