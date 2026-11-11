-- ============================================================================
-- Example: Complete RLS Migration Pattern
-- ============================================================================
-- This example shows the standard pattern for creating a player-owned table
-- with complete RLS policies. Based on actual migrations in this codebase.
--
-- Key patterns demonstrated:
-- 1. Table in domain schema (not public)
-- 2. RLS enabled with service role + player policies
-- 3. NULL checks in policies using current_setting()
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
-- DROP POLICY IF EXISTS backup_codes_player_view ON player.player_backup_codes;
-- DROP POLICY IF EXISTS backup_codes_service_role ON player.player_backup_codes;
-- DROP INDEX IF EXISTS idx_backup_codes_unused;
-- DROP INDEX IF EXISTS idx_backup_codes_player_account;
-- DROP TABLE IF EXISTS player.player_backup_codes CASCADE;

-- ============================================================================
-- RLS SECURITY CHECKLIST
-- ============================================================================
-- [x] Table has RLS enabled
-- [x] Service role policy for backend operations
-- [x] Player policy with NULL check via current_setting()
-- [x] Appropriate access scope (SELECT only for players)

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

-- 6. Player access policy (view own codes only)
--    Uses current_setting() for custom session auth (not auth.uid())
--    NULL check: current_setting returns empty string if not set, ::UUID cast fails safely
CREATE POLICY backup_codes_player_view
    ON player.player_backup_codes
    FOR SELECT
    TO authenticated
    USING (
        player_account_id = current_setting('app.current_user_id', true)::UUID
    );

-- Note: No INSERT/UPDATE/DELETE policies for players
-- Backup codes are managed by backend service only

-- 7. Grant permissions
GRANT ALL ON player.player_backup_codes TO service_role;
GRANT SELECT ON player.player_backup_codes TO authenticated;

-- ============================================================================
-- ALTERNATIVE PATTERN: Admin-only access
-- ============================================================================
-- For tables that only admins can access:
--
-- CREATE POLICY admin_only_access
--     ON schema.table_name
--     FOR ALL
--     TO authenticated
--     USING (
--         current_setting('app.current_user_role', TRUE) IN (
--             'operator_admin',
--             'operator_super_admin'
--         )
--     )
--     WITH CHECK (
--         current_setting('app.current_user_role', TRUE) IN (
--             'operator_admin',
--             'operator_super_admin'
--         )
--     );

-- ============================================================================
-- ALTERNATIVE PATTERN: System-only (service role exclusive)
-- ============================================================================
-- For tables accessed only by backend services:
--
-- CREATE POLICY system_only_insert
--     ON schema.table_name
--     FOR INSERT
--     WITH CHECK (true);  -- Service role only (bypasses RLS)
--
-- CREATE POLICY system_only_select
--     ON schema.table_name
--     FOR SELECT
--     USING (true);  -- Service role only

-- ============================================================================
-- KEY LEARNINGS FROM THIS CODEBASE
-- ============================================================================
--
-- 1. ALWAYS use current_setting() instead of auth.uid()
--    This project uses custom session auth, not Supabase JWT auth
--    Example: current_setting('app.current_user_id', true)::UUID
--
-- 2. The TRUE parameter in current_setting() prevents errors when unset
--    Returns empty string instead of raising exception
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
