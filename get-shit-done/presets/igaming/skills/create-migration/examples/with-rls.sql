-- ============================================================================
-- Example: Complete RLS Migration Pattern
-- ============================================================================
-- This example shows the standard pattern for creating a player-owned table
-- with complete RLS policies. Based on actual migrations in this codebase.
--
-- Key patterns demonstrated:
-- 1. Table in domain schema (not public)
-- 2. RLS enabled with a service_role policy only (ADR-0014: no authenticated/anon policy)
-- 3. Own-row access through a SECURITY DEFINER function granted to service_role only
-- 4. Indexes for common query patterns
-- 5. Optional public view with INSTEAD OF triggers
-- ============================================================================

-- ============================================================================
-- Migration: Player backup codes table for 2FA recovery
-- Release: v1.0.0
-- Created: 2026-01-31
-- Author: Claude (GSD Executor)
-- ============================================================================

-- ============================================================================
-- ROLLBACK PLAN
-- ============================================================================
-- DROP FUNCTION IF EXISTS player.get_own_backup_codes(UUID);
-- DROP POLICY IF EXISTS backup_codes_service_role ON player.player_backup_codes;
-- DROP INDEX IF EXISTS idx_backup_codes_unused;
-- DROP INDEX IF EXISTS idx_backup_codes_player_account;
-- DROP TABLE IF EXISTS player.player_backup_codes CASCADE;

-- ============================================================================
-- RLS SECURITY CHECKLIST
-- ============================================================================
-- [x] Table has RLS enabled
-- [x] Service role policy for backend operations
-- [x] No policy for authenticated or anon (ADR-0014)
-- [x] Own-row read via SECURITY DEFINER function, EXECUTE granted to service_role only

-- ============================================================================
-- MIGRATION CONTENT
-- ============================================================================

-- 1. Create table in player schema (domain schema, not public)
CREATE TABLE IF NOT EXISTS player.player_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Owner reference
    player_account_id UUID NOT NULL REFERENCES player.player_accounts(id) ON DELETE CASCADE,

    -- Domain-specific columns
    code_hash TEXT NOT NULL,              -- HMAC-SHA256 hash (never store plain text)
    used_at TIMESTAMPTZ DEFAULT NULL,     -- NULL = unused, timestamp = consumed

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT backup_code_single_use CHECK (used_at IS NULL OR used_at >= created_at)
);

-- 2. Add table comment for documentation
COMMENT ON TABLE player.player_backup_codes IS
'Stores hashed backup codes for 2FA recovery. Codes are single-use.';

COMMENT ON COLUMN player.player_backup_codes.code_hash IS
'HMAC-SHA256 hash of the backup code (never store plain text codes)';

COMMENT ON COLUMN player.player_backup_codes.used_at IS
'NULL = code available, timestamp = when consumed (single-use enforcement)';

-- 3. Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_backup_codes_player_account
    ON player.player_backup_codes(player_account_id);

-- Partial index for faster unused code lookups
CREATE INDEX IF NOT EXISTS idx_backup_codes_unused
    ON player.player_backup_codes(player_account_id)
    WHERE used_at IS NULL;

-- 4. Enable Row Level Security (CRITICAL)
ALTER TABLE player.player_backup_codes ENABLE ROW LEVEL SECURITY;

-- 5. Service role policy (backend operations - verification, marking used)
--    Service role bypasses RLS but explicit policy is good practice
CREATE POLICY backup_codes_service_role
    ON player.player_backup_codes
    FOR ALL
    TO service_role
    USING (true);

-- 6. Own-row read: SECURITY DEFINER function, EXECUTE granted to service_role only.
--    The edge function calls it with the service client and checks the owner itself.
--    No policy for authenticated/anon: custom auth has no Supabase JWT to key a policy on.
CREATE OR REPLACE FUNCTION player.get_own_backup_codes(p_player_account_id UUID)
RETURNS SETOF player.player_backup_codes
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, player, pg_temp
AS $$
    SELECT * FROM player.player_backup_codes
    WHERE player_account_id = p_player_account_id
$$;

-- Note: No INSERT/UPDATE/DELETE path for players
-- Backup codes are managed by backend service only

-- 7. Grant permissions (service_role only; PUBLIC, anon and authenticated revoked)
REVOKE EXECUTE ON FUNCTION player.get_own_backup_codes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION player.get_own_backup_codes(UUID) TO service_role;
GRANT ALL ON player.player_backup_codes TO service_role;

-- ============================================================================
-- ALTERNATIVE PATTERN: Operator/admin access (no database role policy)
-- ============================================================================
-- Role gating happens in the edge function (handleOperatorSecureRequest with an
-- endpoint group and access level), not in a policy on authenticated. Operator
-- reads go through a service_role SECURITY DEFINER function as in step 6.

-- ============================================================================
-- ALTERNATIVE PATTERN: System-only (service role exclusive)
-- ============================================================================
-- For tables accessed only by backend services. Name the role explicitly:
-- a policy with no TO clause applies to PUBLIC, which includes anon.
--
-- CREATE POLICY system_only_all
--     ON schema.table_name
--     FOR ALL
--     TO service_role
--     USING (true)
--     WITH CHECK (true);

-- ============================================================================
-- KEY LEARNINGS FROM THIS CODEBASE
-- ============================================================================
--
-- 1. NEVER key a policy on auth.uid(), auth.jwt() or current_setting('app.*')
--    This project uses custom session auth (ADR-0014). Own-row access is a
--    SECURITY DEFINER function granted to service_role only.
--
-- 2. No policy TO authenticated or anon; RLS holds a service_role policy only
--
-- 3. Service role policy is required for backend operations
--    Even though service_role bypasses RLS, explicit policy is good practice
--
-- 4. Tables go in domain schemas (player, games_catalog, etc.)
--    Public schema is for views only (PostgREST access pattern)
--
-- 5. Run validation before commit:
--    deno run --allow-read apps/api/tools/validate-migration.ts <file>
--
-- ============================================================================
