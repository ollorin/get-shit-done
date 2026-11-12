---
name: CI 124 test failures after v0.1.8 merge
description: Player login returns invalid credentials in CI after is_admin column removal. 862 passed, 124 failed. Root cause needs investigation of verify_password RPC and linked_auth_methods post-migration.
type: project
---

After merging v0.1.8 to main (squash merge), CI staging deploy fails with 124 integration test failures.

**Symptom:** `POST /login - successful login` fails. User registration succeeds but login returns invalid credentials. Invalid password and non-existent email tests PASS (they correctly return errors).

**What works:** User creation via `create_player_account_with_password` RPC works (setup step passes). The `is_admin` column IS dropped (Phase 106 test passes). 862 tests pass.

**What fails:** Any test that creates a player then tries to login. The password verification fails despite the user being created with a valid password hash.

**Root cause hypothesis:** The `create_player_account_with_password` function was recreated in migration `20260427000200` without the `p_is_admin` parameter. The new function body may not correctly insert into `player.linked_auth_methods` (the email hash lookup table used by the auth facade to find accounts by email). Without a linked_auth_methods row, the login email lookup fails with "account not found" which maps to the same generic "invalid credentials" error.

**How to apply:** When debugging this:
1. Check if `create_player_account_with_password` in migration 20260427000200 creates a `linked_auth_methods` row
2. Check if the `verify_password` RPC still works post-migration
3. Compare the function body before and after the is_admin removal
4. The original function (before Phase 106) created linked_auth_methods — the new one might not

**CI run:** <private-repo>/actions/runs/23180906709
**Branch:** main (commit cb850d46)
